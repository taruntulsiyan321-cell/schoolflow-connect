-- ---------------------------------------------------------------------
-- CHUNK 6.7 — BATCH 1c: hoist the identity calls out of the per-row filter
--
-- Third measurement on academic_events, because the second was not the end
-- either. G12: "Measure, then measure again."
--
--   before batch 1   53-91 s     fence called same_school() per row
--   after  batch 1   64-114 s    fence fixed; the SELECT policy still per-row
--   after  batch 1b  4.4-8.6 s   SELECT policy rewritten to argument-free calls
--
-- 8.6 s is still over the 8 s statement timeout and well over the 2 s this
-- chunk has to hit. What is left is subtler than the last two rounds:
--
-- active_membership_role(), is_super_admin() and super_admin_has_any_access()
-- take NO arguments and are STABLE, so their value cannot change during the
-- statement. Postgres still evaluates them ONCE PER ROW. Being argument-free
-- and STABLE is not sufficient for hoisting — the planner only lifts a
-- subexpression into a once-per-statement InitPlan when it is written as a
-- scalar subquery. `f()` is per row; `(SELECT f())` is per statement.
--
-- That is why the fence itself was already cheap after batch 1: `IN (SELECT
-- ...)` is a subquery, so it became a hashed SubPlan. The bare calls beside it
-- were not, and kept paying.
--
-- This pattern is already in this database, arrived at independently: two of
-- the soft-delete fences read `(SELECT has_role(auth.uid(), 'admin'))` while
-- three others read `has_role(auth.uid(), 'admin')`. Same predicate, one
-- hoisted and one not. Making it deliberate here so the remaining 89 tables
-- inherit the correct shape rather than the coin flip.
--
-- No predicate changes. Wrapping an expression in a scalar subquery cannot
-- change its value — a STABLE function returns the same answer for the whole
-- statement by definition, which is the property that makes the hoist legal.
-- The equivalence proof is re-run below regardless, because "cannot change"
-- is an argument and the gate is a measurement.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS academic_events_admin_select ON public.academic_events;

CREATE POLICY academic_events_admin_select ON public.academic_events
  FOR SELECT
  USING (
    (
      (SELECT public.active_membership_role()) IN ('admin', 'principal')
      OR (SELECT public.is_super_admin() AND public.super_admin_has_any_access())
    )
    AND school_id IN ( SELECT public.my_accessible_school_ids() )
  );


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
      -- The original predicate, as it stood before Chunk 6.7 touched this table.
      _old := coalesce(public.is_principal_or_admin(auth.uid())
                       AND public.same_school(_sid), false);
      -- The predicate now on the table, hoisted form included.
      _new := coalesce(
                ((SELECT public.active_membership_role()) IN ('admin', 'principal')
                 OR (SELECT public.is_super_admin() AND public.super_admin_has_any_access()))
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
    RAISE EXCEPTION 'Chunk 6.7 batch 1c: the equivalence proof compared nothing.';
  END IF;
  IF _fail <> '' THEN
    RAISE EXCEPTION 'Chunk 6.7 batch 1c ABORTED — hoisting changed what is visible: %', _fail;
  END IF;

  RAISE NOTICE 'Chunk 6.7 batch 1c: predicates agree on all % pairs after hoisting.', _pairs;
END
$prove$;
