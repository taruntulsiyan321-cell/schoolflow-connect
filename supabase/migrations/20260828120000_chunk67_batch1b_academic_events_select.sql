-- ---------------------------------------------------------------------
-- CHUNK 6.7 — BATCH 1b: the half the fence rewrite did not fix
--
-- G12: "Measure, then measure again. Never assume a fix landed."
--
-- Batch 1 rewrote academic_events' tenant fence. Re-measured immediately
-- after, the table had barely moved:
--
--   role        before batch 1     after batch 1 (fence rewritten)
--   admin           56.5 s              64.0 s
--   principal       85.2 s             113.9 s
--   teacher         53.4 s              67.4 s
--   parent          85.1 s             108.0 s
--   student         91.5 s             107.4 s
--
-- (The table also grew from 4,335 to 9,375 rows when the scale fixture was
-- seeded, so these are not directly comparable — which is exactly why the
-- number that matters is per candidate row, not the total.)
--
-- THE FINDING, and it changes the plan for the remaining 89 tables:
-- the RESTRICTIVE tenant fence was never the only per-row call. Every
-- permissive policy that has to answer "which school is this row in?" carries
-- the same shape, and permissive policies are OR'd, so a read pays all of them.
-- On this table the sole SELECT-granting policy was
--
--   is_principal_or_admin(auth.uid()) AND same_school(school_id)
--
-- which is TWO per-row function invocations. is_principal_or_admin takes _uid
-- as an argument, so Postgres re-invokes it per candidate row even though
-- auth.uid() is constant for the statement — the identical trap that made
-- can_read_mark cost 24.61 ms per row in Chunk 6.6.
--
-- Rewriting the fence alone would have left every one of the 90 tables still
-- broken. Reported here rather than discovered again on table 89.
--
-- ---------------------------------------------------------------------
-- EQUIVALENCE
--
--   is_principal_or_admin(u) = has_role(u,'admin') OR has_role(u,'principal')
--
-- and for u = auth.uid(), has_role(u, r) is
--
--   EXISTS(SELECT 1 FROM memberships m
--           WHERE m.id = active_membership_id() AND m.role = r AND m.status='active')
--   OR (is_super_admin() AND super_admin_has_any_access())
--
-- active_membership_id() is a single id, so that EXISTS is exactly
-- active_membership_role() = r. Hence
--
--   is_principal_or_admin(auth.uid())
--     = active_membership_role() IN ('admin','principal')
--       OR (is_super_admin() AND super_admin_has_any_access())
--
-- The super-admin arm is restated explicitly. Dispatching on the membership
-- role alone would silently revoke a super admin acting inside a granted
-- institution, because they hold no membership row of their own — the failure
-- mode the doc names, and the reason it is written out rather than assumed.
--
-- Every call on the left of the AND is argument-free and therefore constant
-- per statement. The only per-row work left is the hash probe against
-- my_accessible_school_ids().
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS academic_events_admin_select ON public.academic_events;

CREATE POLICY academic_events_admin_select ON public.academic_events
  FOR SELECT
  USING (
    (
      public.active_membership_role() IN ('admin', 'principal')
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
    AND school_id IN ( SELECT public.my_accessible_school_ids() )
  );


-- ---------------------------------------------------------------------
-- Prove it admits the same rows, per identity, per school.
--
-- Same reduction as batch 1: both predicates depend only on the caller and on
-- school_id, so agreement across every (identity x distinct school_id) pair
-- proves agreement across every row.
-- ---------------------------------------------------------------------

DO $prove$
DECLARE
  _acct  record;
  _sid   uuid;
  _old   boolean;
  _new   boolean;
  _fail  text := '';
  _pairs int := 0;
BEGIN
  FOR _acct IN
    SELECT * FROM (
      SELECT id, email FROM auth.users WHERE email LIKE '%@wisdomcampus.com'
      UNION ALL
      (SELECT p.id, '<profile with no school>'
         FROM public.profiles p WHERE p.school_id IS NULL LIMIT 1)
      UNION ALL
      SELECT NULL::uuid, '<anon: no jwt>'
    ) ids
  LOOP
    IF _acct.id IS NULL THEN
      PERFORM set_config('request.jwt.claims', NULL, true);
    ELSE
      PERFORM set_config('request.jwt.claims',
        json_build_object('sub', _acct.id, 'role', 'authenticated')::text, true);
    END IF;

    FOR _sid IN
      SELECT * FROM (SELECT id FROM public.schools UNION ALL SELECT NULL::uuid) sids
    LOOP
      _old := coalesce(public.is_principal_or_admin(auth.uid())
                       AND public.same_school(_sid), false);
      _new := coalesce(
                (public.active_membership_role() IN ('admin', 'principal')
                 OR (public.is_super_admin() AND public.super_admin_has_any_access()))
                AND (_sid IN (SELECT public.my_accessible_school_ids())), false);
      _pairs := _pairs + 1;

      IF _old IS DISTINCT FROM _new THEN
        _fail := _fail || format('[%s x school %s: was %s, now %s] ',
                                 _acct.email, coalesce(_sid::text, 'NULL'), _old, _new);
      END IF;
    END LOOP;
  END LOOP;

  PERFORM set_config('request.jwt.claims', NULL, true);

  IF _pairs = 0 THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1b: the equivalence proof compared nothing.';
  END IF;
  IF _fail <> '' THEN
    RAISE EXCEPTION
      'Chunk 6.7 batch 1b ABORTED — the rewritten select policy does not admit the same rows: %', _fail;
  END IF;

  RAISE NOTICE 'Chunk 6.7 batch 1b: select predicates agree on all % pairs.', _pairs;
END
$prove$;


-- ---------------------------------------------------------------------
-- The remaining policies on this table are already free: they are the
-- constant `false` write denials. Asserted so a later change cannot quietly
-- open a write path that this chunk's timing work never looks at.
-- ---------------------------------------------------------------------

DO $shape$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_policy p
   WHERE p.polrelid = 'public.academic_events'::regclass
     AND p.polpermissive
     AND p.polcmd IN ('a', 'w', 'd')
     AND coalesce(pg_get_expr(p.polqual, p.polrelid), 'false') <> 'false';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1b: % client write policy on academic_events is no longer a flat denial.', _n;
  END IF;

  SELECT count(*) INTO _n
    FROM pg_policy p
   WHERE p.polrelid = 'public.academic_events'::regclass
     AND coalesce(pg_get_expr(p.polqual, p.polrelid), '') LIKE '%same_school%';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1b: % policy on academic_events still calls same_school per row.', _n;
  END IF;
END
$shape$;
