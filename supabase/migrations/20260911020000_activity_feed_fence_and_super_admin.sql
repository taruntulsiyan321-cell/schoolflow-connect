-- ═══════════════════════════════════════════════════════════════════════════
-- The /admin index 500s for a super admin, and the cause is a full scan, not a
-- permission
--
-- ── WHAT WAS MEASURED ────────────────────────────────────────────────────
--
--     GET /rest/v1/school_activity_feed
--         ?select=id,action,created_at,actor_name
--         &school_id=eq.<school A>&order=created_at.desc&limit=6
--
--     super_admin -> 500 {"code":"57014","message":"canceling statement due to
--                         statement timeout"}
--     admin       -> 200 (rows)
--
-- This is the error banner KNOWN_ISSUES 17 describes. That entry attributed it
-- to the service layer refusing super_admin (`asOwnerRole` returning null), and
-- that WAS one cause — it is fixed separately. This is the other, and it is the
-- one that survives: a timeout, not a ForbiddenError.
--
-- ── WHY IT TIMES OUT ─────────────────────────────────────────────────────
--
-- Every policy on this table is written in terms of `same_school(school_id)`,
-- which takes the ROW's column as an argument. A function of the row cannot be
-- folded to a constant and cannot be answered from an index, so it is called
-- once per row — and the permissive policy then calls `has_role()` three more
-- times for each row that survives. `ORDER BY created_at DESC LIMIT 6` cannot
-- stop early when nothing matches, so it walks all 9,134 rows: roughly 36,000
-- SECURITY DEFINER calls, and the statement timeout arrives first.
--
-- An admin escapes it only by accident: `has_role(admin)` is true, six rows are
-- found immediately, and the scan stops. Any caller who matches NOTHING pays
-- the whole table. That is every super admin, and every account whose
-- `get_my_school_id()` is NULL — 42 of 62 accounts hold no role.
--
-- 20260911010000 made `same_school` cheaper INSIDE, which was worth doing, but
-- could not fix this: the call is still per row. The shape has to change.
--
-- ── THE FIX IS A PATTERN THIS SCHEMA ALREADY USES ────────────────────────
--
-- `school_id IN (SELECT my_accessible_school_ids())` is a set membership. The
-- set is computed ONCE per statement, the planner can use the index on
-- `school_id`, and for a caller whose set is empty the predicate is answered
-- without touching a row. 31 tenant fences are already written this way —
-- `exams`, `students`, `learning_resources` among them. 72 still use
-- `same_school`. This migration converts the one that is demonstrably timing
-- out; converting the other 71 is a separate, measured piece of work and is
-- recorded in KNOWN_ISSUES rather than smuggled in here.
--
-- ── AND THE SUPER ADMIN GETS THE READ §10.20 GIVES THEM ──────────────────
--
-- No permissive policy on this table admitted a super admin at all, so even a
-- granted one saw nothing. §10.20: "Unrestricted access to academic data, for
-- support." The branch added is the SAME one `exams_read` already carries —
-- `is_super_admin() AND super_admin_has_any_access()` — so access still
-- requires a live, logged, expiring grant. With no grant the set from
-- `my_accessible_school_ids()` is empty and they read nothing, quickly.
--
-- NOT A WIDENING FOR ANYONE ELSE. admin, principal, teacher, student and
-- parent keep exactly the predicates they had; only the tenancy term changes
-- shape, from a per-row function to the equivalent set membership.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The fence, as an indexable set ───────────────────────────────────────
DROP POLICY IF EXISTS school_activity_feed_tenant_fence ON public.school_activity_feed;
CREATE POLICY school_activity_feed_tenant_fence ON public.school_activity_feed
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING ((school_id IS NULL) OR (school_id IN (SELECT public.my_accessible_school_ids())))
WITH CHECK ((school_id IS NULL) OR (school_id IN (SELECT public.my_accessible_school_ids())));

-- ── Staff read, plus the granted super admin ─────────────────────────────
DROP POLICY IF EXISTS activity_feed_select ON public.school_activity_feed;
CREATE POLICY activity_feed_select ON public.school_activity_feed
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    -- §10.20, gated on a live grant exactly as exams_read gates it.
    OR ((SELECT public.is_super_admin()) AND (SELECT public.super_admin_has_any_access()))
  )
);

-- ── Family read, same tenancy shape, same roles ──────────────────────────
DROP POLICY IF EXISTS activity_feed_select_family ON public.school_activity_feed;
CREATE POLICY activity_feed_select_family ON public.school_activity_feed
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    public.has_role(auth.uid(), 'student'::public.app_role)
    OR public.has_role(auth.uid(), 'parent'::public.app_role)
  )
);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- Runs as `postgres`, bypassing RLS, so it proves nothing about who reads what
-- (rule 6). Shape only. That an admin, teacher, student and granted super admin
-- all still read the feed, that an ungranted super admin reads nothing WITHOUT
-- timing out, and that school B stays invisible, are asserted as the caller in
-- probe24 (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _fence text;
  _sel   text;
  _fam   text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _fence
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'school_activity_feed' AND p.polname = 'school_activity_feed_tenant_fence';
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _sel
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'school_activity_feed' AND p.polname = 'activity_feed_select';
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _fam
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'school_activity_feed' AND p.polname = 'activity_feed_select_family';

  IF _fence IS NULL OR _sel IS NULL OR _fam IS NULL THEN
    RAISE EXCEPTION 'ABORT: a policy this migration replaces is missing';
  END IF;

  -- The per-row call is the defect; it must be gone from all three.
  IF _fence ~ 'same_school' OR _sel ~ 'same_school' OR _fam ~ 'same_school' THEN
    RAISE EXCEPTION 'ABORT: a policy still calls same_school per row';
  END IF;
  IF _fence !~ 'my_accessible_school_ids' OR _sel !~ 'my_accessible_school_ids'
     OR _fam !~ 'my_accessible_school_ids' THEN
    RAISE EXCEPTION 'ABORT: a policy lost its tenancy term';
  END IF;

  -- The fence must stay RESTRICTIVE, or it becomes one more way IN.
  IF EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
     WHERE c.relname = 'school_activity_feed'
       AND p.polname = 'school_activity_feed_tenant_fence'
       AND p.polpermissive
  ) THEN
    RAISE EXCEPTION 'ABORT: the tenant fence is no longer RESTRICTIVE';
  END IF;

  -- Every role that could read before must still be named.
  IF _sel !~ 'admin' OR _sel !~ 'principal' OR _sel !~ 'teacher' THEN
    RAISE EXCEPTION 'ABORT: a staff role was dropped from the read policy';
  END IF;
  IF _fam !~ 'student' OR _fam !~ 'parent' THEN
    RAISE EXCEPTION 'ABORT: a family role was dropped from the read policy';
  END IF;
  -- ...and the super admin branch must be grant-gated, not bare.
  IF _sel !~ 'is_super_admin' OR _sel !~ 'super_admin_has_any_access' THEN
    RAISE EXCEPTION 'ABORT: the super admin branch is missing or is not gated on a live grant';
  END IF;

  RAISE NOTICE 'activity feed policies are set-based; behaviour is in probe24.';
END $verify$;
