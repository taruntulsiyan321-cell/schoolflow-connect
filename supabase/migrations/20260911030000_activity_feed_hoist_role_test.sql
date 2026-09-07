-- ═══════════════════════════════════════════════════════════════════════════
-- The activity feed still scanned, because the ROLE test was per-row too
--
-- ── WHAT 20260911020000 FIXED, AND WHAT IT MISSED ────────────────────────
--
-- That migration replaced the per-row `same_school(school_id)` with the
-- indexable `school_id IN (SELECT my_accessible_school_ids())`, which was
-- necessary and not sufficient. The timeout moved rather than went away:
--
--     ERROR: 57014 canceling statement due to statement timeout
--     CONTEXT: PL/pgSQL function current_auth_session_id() line 3
--              SQL function "active_membership_id" during startup
--              SQL function "has_role" statement 1
--              SQL statement "SELECT id FROM public.school_activity_feed
--                             ORDER BY created_at DESC LIMIT 6"
--
-- `has_role(auth.uid(), 'admin')` depends on nothing in the row — it is the
-- same answer for every one of the 9,134 — but written bare in a policy qual
-- PostgreSQL evaluates it as part of the scan, and each call runs
-- `active_membership_id()` and `current_auth_session_id()` underneath.
--
-- ── THE IDIOM THIS SCHEMA ALREADY USES ───────────────────────────────────
--
-- Wrapping a row-independent call in a scalar subquery — `(SELECT f())` —
-- makes the planner evaluate it ONCE as an InitPlan and reuse the result. It is
-- not a style preference here; `exams_read` is already written that way:
--
--     ((SELECT is_super_admin()) AND (SELECT super_admin_has_any_access()))
--
-- 20260911020000 carried that idiom for the super-admin branch it added and
-- left the three pre-existing `has_role` calls bare, which is why the scan
-- survived. This wraps the whole role test in one scalar subquery: one
-- evaluation per statement for the entire disjunction.
--
-- NOTHING ABOUT WHO MAY READ CHANGES. The predicate is the same boolean
-- expression; only its position moves, from the per-row qual into an InitPlan.
-- probe24 asserts the outcome for admin, teacher, student, a granted super
-- admin, an ungranted one, and across schools.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS activity_feed_select ON public.school_activity_feed;
CREATE POLICY activity_feed_select ON public.school_activity_feed
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    SELECT
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
      -- §10.20, still gated on a live, logged, expiring grant.
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
  )
);

DROP POLICY IF EXISTS activity_feed_select_family ON public.school_activity_feed;
CREATE POLICY activity_feed_select_family ON public.school_activity_feed
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    SELECT
      public.has_role(auth.uid(), 'student'::public.app_role)
      OR public.has_role(auth.uid(), 'parent'::public.app_role)
  )
);

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only; it runs as postgres and proves nothing about who
-- reads what (rule 6). probe24 asserts the behaviour as the caller (rule 7),
-- using the ORDER BY … LIMIT 6 shape that actually timed out rather than a
-- count(*), which a different plan can answer without ever sorting.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE _sel text; _fam text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _sel
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'school_activity_feed' AND p.polname = 'activity_feed_select';
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _fam
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'school_activity_feed' AND p.polname = 'activity_feed_select_family';

  IF _sel IS NULL OR _fam IS NULL THEN
    RAISE EXCEPTION 'ABORT: a policy this migration replaces is missing';
  END IF;

  -- A bare `has_role(` immediately after AND is the per-row form. Both policies
  -- must express the role test inside a scalar subquery instead.
  IF _sel !~ 'SELECT' OR _fam !~ 'SELECT' THEN
    RAISE EXCEPTION 'ABORT: the role test was not hoisted into a scalar subquery';
  END IF;

  -- ...and no role may have been lost in the rewrite.
  IF _sel !~ 'admin' OR _sel !~ 'principal' OR _sel !~ 'teacher'
     OR _sel !~ 'is_super_admin' OR _sel !~ 'super_admin_has_any_access' THEN
    RAISE EXCEPTION 'ABORT: a role was dropped from the staff read policy';
  END IF;
  IF _fam !~ 'student' OR _fam !~ 'parent' THEN
    RAISE EXCEPTION 'ABORT: a role was dropped from the family read policy';
  END IF;
  IF _sel !~ 'my_accessible_school_ids' OR _fam !~ 'my_accessible_school_ids' THEN
    RAISE EXCEPTION 'ABORT: a policy lost its tenancy term';
  END IF;

  RAISE NOTICE 'the activity feed role test is hoisted; behaviour is in probe24.';
END $verify$;
