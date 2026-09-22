-- A SESSION IS AS LONG AS ITS QUESTIONS TOOK.
--
-- ── WHAT WAS WRONG ──────────────────────────────────────────────────────────
--
-- Analysis shows study time in five places: "Study time total" on Overview,
-- "Total study time" and "Study time" on Activity & Speed, "Xh study time" on
-- every subject row, and the whole speed panel ("Average per question",
-- "Fastest subject", "Takes most time", "Time per question by subject").
--
-- Every one of them ultimately reads practice_sessions.total_time_ms, and
-- measured on production 2026-09-17:
--
--     finished sessions                       284
--     carrying total_time_ms                   17      <- 6%
--
-- So the browser fell back to wall clock, finished_at - created_at. That is
-- not study time: it is how long the row existed. And on this database it is
-- not even that, because 240 of those 284 sessions were seeded with exactly
-- 1080 wall seconds:
--
--     wall_sec = 1080  ->  240 sessions
--     wall_sec = 2     ->   17 sessions
--     (everything else)->   27 sessions
--
-- An 18-minute constant, per session, whatever it held. Divided by the
-- question count it becomes a per-question pace, so "which subject takes you
-- longest" was answering "which subject has fewest questions per session" —
-- an artefact of the fixture, rendered to the student as an insight about
-- their own learning.
--
-- ── WHAT THE DATABASE ACTUALLY KNOWS ────────────────────────────────────────
--
-- question_attempts.time_taken_ms is populated on 4,998 of 5,050 rows. The
-- app has been recording per-question time all along; only the per-session
-- roll-up was missing. rpc_finish_practice_session writes total_time_ms as
-- the sum of exactly those attempts, which this migration confirms rather
-- than assumes: of the 17 sessions that carry the column today, 17 equal
-- their own attempt sum and 0 disagree.
--
-- So the sum is not a new definition of session length. It is the existing
-- one, applied to the rows that predate it.
--
-- ── WHAT THIS DOES ──────────────────────────────────────────────────────────
--
-- Fills total_time_ms from the attempt record for every session that has
-- attempt timing and no roll-up. It does not touch a session that already
-- carries one, and it leaves NULL alone where nothing was measured — a
-- session nobody timed has no duration, and zero would claim it was instant.
--
-- This is the same correction 20261029000000 made to the counts: the summary
-- agrees with its own attempts, or it is not a summary of them.
--
-- SCOPE, MEASURED BEFORE APPLYING:
--     would fill          250
--     would correct         0   (nothing already stored disagrees)
--     already agree        17
--     no attempt timing     6   (left NULL)

BEGIN;

WITH per_session AS (
  SELECT session_id, SUM(time_taken_ms)::bigint AS ms
  FROM public.question_attempts
  WHERE session_id IS NOT NULL
    AND COALESCE(time_taken_ms, 0) > 0
  GROUP BY session_id
)
UPDATE public.practice_sessions ps
SET total_time_ms = per_session.ms
FROM per_session
WHERE per_session.session_id = ps.id
  AND COALESCE(ps.total_time_ms, 0) = 0
  AND per_session.ms > 0;

-- FAIL CLOSED. If the UPDATE matched nothing the migration has not done its
-- job, and a silent no-op is how a "fixed" defect survives into the next
-- session. Re-running after a successful apply is a no-op by design, so the
-- guard checks the END STATE — every session with attempt timing carries the
-- roll-up — not the number of rows this particular statement touched.
DO $$
DECLARE
  _unrolled int;
  _disagree int;
BEGIN
  SELECT count(*) INTO _unrolled
  FROM public.practice_sessions ps
  WHERE COALESCE(ps.total_time_ms, 0) = 0
    AND EXISTS (SELECT 1 FROM public.question_attempts qa
                 WHERE qa.session_id = ps.id AND COALESCE(qa.time_taken_ms, 0) > 0);

  SELECT count(*) INTO _disagree
  FROM public.practice_sessions ps
  JOIN (SELECT session_id, SUM(time_taken_ms)::bigint AS ms
          FROM public.question_attempts
         WHERE session_id IS NOT NULL AND COALESCE(time_taken_ms, 0) > 0
         GROUP BY session_id) a ON a.session_id = ps.id
  WHERE ps.total_time_ms IS DISTINCT FROM a.ms;

  IF _unrolled > 0 THEN
    RAISE EXCEPTION 'would have failed open: % session(s) still carry no roll-up despite having timed attempts', _unrolled;
  END IF;
  IF _disagree > 0 THEN
    RAISE EXCEPTION 'would have failed open: % session(s) disagree with their own attempt sum', _disagree;
  END IF;

  RAISE NOTICE 'every session with timed attempts now carries that sum as total_time_ms';
END $$;

COMMIT;
