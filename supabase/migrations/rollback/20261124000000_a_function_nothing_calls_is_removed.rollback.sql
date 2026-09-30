-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: my_readable_test_ids() back, with PUBLIC's EXECUTE
--
-- Recreates the function from the definition 20261124000000 saved in
-- public.routines_pre_20261124000000, and gives PUBLIC back the EXECUTE it
-- held (ACL {=X/postgres, postgres, service_role}). Note what you are
-- restoring: a function nothing calls, behind a public door, which the
-- anon-surface gate (CHUNK95_ANON_SURFACE_VERIFY item 1) reports again.
--
-- Undoes: 20261124000000_a_function_nothing_calls_is_removed.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE _def text;
BEGIN
  SELECT definition INTO _def FROM public.routines_pre_20261124000000
   WHERE object = 'public.my_readable_test_ids()';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'no saved definition in routines_pre_20261124000000 — cannot restore';
  END IF;
  EXECUTE _def;
END
$restore$;

GRANT EXECUTE ON FUNCTION public.my_readable_test_ids() TO PUBLIC;

DO $check$
BEGIN
  IF to_regprocedure('public.my_readable_test_ids()') IS NULL
     OR NOT has_function_privilege('anon', 'public.my_readable_test_ids()', 'EXECUTE') THEN
    RAISE EXCEPTION 'the function or its PUBLIC grant did not come back';
  END IF;
END
$check$;

DROP TABLE public.routines_pre_20261124000000;

DELETE FROM public.schema_migrations
 WHERE version = '20261124000000_a_function_nothing_calls_is_removed';

COMMIT;
