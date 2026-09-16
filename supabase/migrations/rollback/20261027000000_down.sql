-- Rollback for 20261027000000_a_session_that_asked_nothing_has_no_rate.sql
--
-- Puts 0 back on sessions that asked nothing.
--
-- What this re-introduces: 20 finished sessions across 3 students, left as
-- shells by the practice outage, again report "0% accuracy" — a rate over zero
-- questions, which reads as a statement about a student who was never asked
-- one.

BEGIN;

UPDATE public.practice_sessions ps
   SET accuracy = 0
 WHERE ps.accuracy IS NULL
   AND ps.finished_at IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);

COMMIT;
