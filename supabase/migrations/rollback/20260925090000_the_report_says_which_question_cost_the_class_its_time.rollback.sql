-- Rollback for 20260925090000. The function is additive: nothing read it before
-- this migration, so dropping it restores the previous behaviour exactly.
DROP FUNCTION IF EXISTS public.rpc_test_question_breakdown(uuid);
