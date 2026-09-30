-- ═══════════════════════════════════════════════════════════════════════════
-- A FUNCTION NOTHING CALLS IS REMOVED, NOT FENCED
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 64: CHUNK95_ANON_SURFACE_VERIFY item 1 has failed since
-- 2026-09-21 on one function — "anon can EXECUTE my_readable_test_ids() and no
-- class explains why". The note said to read the body before deciding.
--
-- Read 2026-09-30:
--
--   my_readable_test_ids()  SECURITY DEFINER, SETOF uuid: the tests the caller
--       may read. ACL {=X/postgres, postgres, service_role} — EXECUTE for
--       PUBLIC, and so for anon over PostgREST.
--
--   It has NO caller. can_read_test_row — which the tests_read policy calls —
--   names it only in a comment ("the student sitting it (my_readable_test_ids)"):
--   its logic was inlined there, argument by argument, so the predicate works
--   for a row that does not exist yet. Measured: no pg_depend row points at
--   it; no function body calls it once comments are stripped; no policy and no
--   view names it; nothing in src/ or supabase/functions/ calls it (the only
--   mentions are the generated types and the definer inventory).
--
-- So it is dead code behind a public door. It does not leak — for anon
-- auth.uid() is NULL and it answers no rows — but RULE 0 is plain about dead
-- code: it goes. Revoking the grant would have left a second, unused
-- statement of "which tests may this caller read" beside the one the policy
-- actually uses, for the next change to that rule to miss.
--
-- The generated types and supabase/definer-inventory.json drop it in the same
-- commit.
--
-- ROLLBACK: rollback/20261124000000_a_function_nothing_calls_is_removed.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.routines_pre_20261124000000 (
  object text PRIMARY KEY,
  definition text NOT NULL,
  acl text
);
ALTER TABLE public.routines_pre_20261124000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261124000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261124000000 IS
  'Rollback source for 20261124000000: my_readable_test_ids() as it was, with its ACL. No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261124000000 (object, definition, acl)
SELECT 'public.my_readable_test_ids()',
       pg_get_functiondef('public.my_readable_test_ids()'::regprocedure),
       (SELECT p.proacl::text FROM pg_proc p WHERE p.oid = 'public.my_readable_test_ids()'::regprocedure);

-- Refused, not assumed: anything that depends on it, calls it (comments
-- stripped), or names it in a policy or a view stops the drop.
DO $nobody$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_depend
   WHERE refobjid = 'public.my_readable_test_ids()'::regprocedure;
  IF _n <> 0 THEN RAISE EXCEPTION '% catalogue object(s) depend on my_readable_test_ids()', _n; END IF;

  SELECT count(*) INTO _n FROM pg_proc p
   WHERE p.oid <> 'public.my_readable_test_ids()'::regprocedure
     AND regexp_replace(p.prosrc, '--[^\n]*', '', 'g') ~ 'my_readable_test_ids';
  IF _n <> 0 THEN RAISE EXCEPTION '% function body(ies) call my_readable_test_ids()', _n; END IF;

  SELECT count(*) INTO _n FROM pg_policy
   WHERE coalesce(pg_get_expr(polqual, polrelid), '') || coalesce(pg_get_expr(polwithcheck, polrelid), '')
         LIKE '%my_readable_test_ids%';
  IF _n <> 0 THEN RAISE EXCEPTION '% policy(ies) name my_readable_test_ids()', _n; END IF;

  SELECT count(*) INTO _n FROM pg_views WHERE definition LIKE '%my_readable_test_ids%';
  IF _n <> 0 THEN RAISE EXCEPTION '% view(s) name my_readable_test_ids()', _n; END IF;
END
$nobody$;

DROP FUNCTION public.my_readable_test_ids();

-- ── THE PROOF ─────────────────────────────────────────────────────────────
--   1. It is gone, and the rollback source holds it.
--   2. The rule it restated is untouched: can_read_test_row still exists,
--      still SECURITY DEFINER, still granted to authenticated, and the
--      tests_read policy still calls it.
DO $proof$
BEGIN
  IF to_regprocedure('public.my_readable_test_ids()') IS NOT NULL THEN
    RAISE EXCEPTION 'my_readable_test_ids() still exists';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.routines_pre_20261124000000
                  WHERE object = 'public.my_readable_test_ids()' AND definition LIKE '%SECURITY DEFINER%') THEN
    RAISE EXCEPTION 'the rollback source did not keep the definition';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc p
                  WHERE p.oid = to_regprocedure('public.can_read_test_row(uuid,uuid,uuid)')
                    AND p.prosecdef
                    AND has_function_privilege('authenticated', p.oid, 'EXECUTE')) THEN
    RAISE EXCEPTION 'can_read_test_row is not the granted definer it was';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.tests'::regclass AND polname = 'tests_read'
                    AND pg_get_expr(polqual, polrelid) LIKE '%can_read_test_row%') THEN
    RAISE EXCEPTION 'tests_read no longer calls can_read_test_row';
  END IF;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261124000000_a_function_nothing_calls_is_removed')
ON CONFLICT (version) DO NOTHING;

COMMIT;
