-- Rollback for 20261029000000_a_session_summary_agrees_with_its_attempts.sql
--
-- PARTIAL BY NATURE, and it says so rather than pretending otherwise.
--
-- The forward migration replaced invented summary counts with counts taken
-- from question_attempts. The invented values were not recorded anywhere
-- before being overwritten, so they cannot be restored — and restoring them
-- would mean putting back numbers that disagree with the session's own
-- attempt rows, which is the defect, not a state worth returning to.
--
-- What CAN be undone is the second half: the shell sessions' question_count,
-- which was a fixed 20 per session (385 across 20 sessions) claiming questions
-- that were never asked. Even that is only restorable as "20 each", which is
-- what the loader planned, not what any student saw.
--
-- Re-introducing either half means:
--   * 240 sessions whose stored correct/skipped counts contradict their own
--     attempts, and an accuracy computed from counts that disagree with the
--     rate stored beside them;
--   * 20 finished sessions asserting 385 questions were put in front of
--     students who were shown none.

BEGIN;

UPDATE public.practice_sessions ps
   SET question_count = 20
 WHERE ps.finished_at IS NOT NULL
   AND ps.question_count = 0
   AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);

DO $noop$
BEGIN
  RAISE NOTICE 'shell question_count restored to the planned 20; seeded summary counts are not restorable — see header';
END $noop$;

COMMIT;
