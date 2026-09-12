-- Rollback for 20260920070000.
--
-- Drops the list RPC. Both Tests screens then fall back to
-- `TestService.listForClass`, which cannot carry the subject (no such column on
-- `tests`), the question count (test_questions is closed to students), the
-- student's own attempt state, or the teacher's submitted count. The screens
-- that read those fields must be reverted with it.

DROP FUNCTION IF EXISTS public.rpc_test_list_for_class(uuid);
