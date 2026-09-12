-- Rollback for 20260920030000.
--
-- Removes the per-test leaderboard and its fence. The student's own position is
-- unaffected: `rpc_test_student_report` still returns `rank` and `class_size`,
-- which is what the panel showed before the 2026-09-12 ruling asked for a named
-- board. Any screen calling `rpc_test_leaderboard` will get PGRST202 after this.

DROP FUNCTION IF EXISTS public.rpc_test_leaderboard(uuid);
DROP FUNCTION IF EXISTS public.can_read_test_leaderboard(uuid);
