-- ROLLBACK 20260914070000_restore_attempt_path_grant — written 2026-09-22; the migration shipped without one.
--
-- Takes back the EXECUTE that migration gave on rpc_test_questions_for_attempt(uuid). THIS RESTORES THE DEFECT IT
-- FIXED: with no grant, no student can open a class test's questions, so no test can be sat. Roll back only together
-- with 20260914060000 (which recreated the function and lost the grant) or with a replacement grant in hand.
--
-- NOT REVERSED: the REVOKE from PUBLIC. EXECUTE for PUBLIC is exactly what the chunk 9.5 migrations removed from every
-- function; granting it back would reopen the function to anon, which nothing relied on.
REVOKE EXECUTE ON FUNCTION public.rpc_test_questions_for_attempt(uuid) FROM authenticated, service_role;

DO $check$
BEGIN
  IF has_function_privilege('authenticated', 'public.rpc_test_questions_for_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback: authenticated can still execute rpc_test_questions_for_attempt';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20260914070000_restore_attempt_path_grant';
