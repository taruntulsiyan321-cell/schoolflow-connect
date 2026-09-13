-- Rollback for 20260924000000.
--
-- Drops rpc_student_recovery_queue.
--
-- READ THIS FIRST: the Recovery screen reads this function. Without it the
-- screen has no list, because rpc_student_chapter_states — the only other
-- read — returns chapter_state rows, and those exist only once a chapter has
-- already reached RECOVERY_TRIGGER_COUNT open mistakes. Measured on
-- 2026-09-13 that was one chapter in the entire database.
--
-- Roll this back only together with the client change that stopped calling it.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_student_recovery_queue();

COMMIT;
