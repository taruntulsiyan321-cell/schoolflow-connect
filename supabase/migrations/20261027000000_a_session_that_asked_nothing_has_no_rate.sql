-- ════════════════════════════════════════════════════════════════════════════
-- A SESSION THAT ASKED NOTHING HAS NO RATE
-- ════════════════════════════════════════════════════════════════════════════
--
-- A GAP IN MY OWN BACKFILL, FOUND BY AUDITING THE WHOLE LOOP
--
-- 20261021000000 made accuracy `correct / answered`, and NULL rather than 0
-- when nothing was answered, because "a rate over zero questions is not zero,
-- it is absent". Its backfill recomputed every session FROM ITS ATTEMPTS:
--
--     WITH counted AS (SELECT ... FROM question_attempts GROUP BY session_id)
--     UPDATE practice_sessions ... FROM counted WHERE counted.session_id = id
--
-- A session with no attempt rows is not in `counted`, so it was never updated
-- and kept the 0 the old rule wrote. The one case the migration was written to
-- fix is the one case its backfill could not reach.
--
--   finished sessions with zero attempt rows        20
--   of those, carrying a fabricated rate            20
--   students affected                                3
--
-- These are the shells left by the practice outage 26fa45b fixed: the loader
-- 400'd on question_bank.topic, the session was auto-finished (20260925000000)
-- and kept its PLANNED question_count of 20 with nothing behind it. Reading
-- "0% accuracy" off one is a statement about a student who was never asked a
-- question.
--
-- WHAT THIS DOES NOT DO
--
-- question_count is left alone. It records what the session INTENDED to ask,
-- other code reads it as such, and rewriting history to pretend the session was
-- never planned would lose the evidence that the outage happened. The rate is
-- the part that makes a claim about the student, and it is the part removed.
--
-- _practice_session_attempted(correct, wrong, skipped) already exists for
-- exactly this distinction and is what the snapshot uses to keep shells out of
-- the session count; this puts the stored rate on the same footing.
--
-- ROLLBACK: supabase/migrations/rollback/20261027000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.practice_sessions ps
   SET accuracy = NULL
 WHERE ps.accuracy IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);

DO $check$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM public.practice_sessions ps
   WHERE ps.accuracy IS NOT NULL
     AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);
  IF _n > 0 THEN
    RAISE EXCEPTION '% session(s) with no attempts still carry a rate', _n;
  END IF;
END $check$;

COMMIT;
