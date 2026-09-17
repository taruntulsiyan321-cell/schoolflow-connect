-- ════════════════════════════════════════════════════════════════════════════
-- A SESSION SUMMARY AGREES WITH ITS ATTEMPTS
-- ════════════════════════════════════════════════════════════════════════════
--
-- LOOP_END_TO_END_VERIFY carried two populations it could not assert on. Both
-- are fixable from evidence rather than judgement, so neither should have been
-- left sitting in the report.
--
-- ── 1. THE SEEDED SESSIONS (240) ─────────────────────────────────────────────
--
-- practice_sessions.correct_count / skipped_count were written by the seeder,
-- not counted from what the session actually contains:
--
--   sessions                                  240
--   correct_count disagreeing with attempts   240   (every one)
--   skipped_count disagreeing                 160
--   question_count disagreeing                  0   (4800 declared = 4800 real)
--
-- So the attempt rows are real and complete; only the summary on top of them
-- was invented. 20261021000000 recomputed `accuracy` from attempts but left
-- the counts it divides, so the stored rate and the stored counts have been
-- telling two different stories.
--
-- Every count is recomputed from question_attempts, which is the record of
-- what was actually asked and answered. Nothing is deleted and no attempt is
-- touched.
--
-- ── 2. THE SHELL SESSIONS (20) ───────────────────────────────────────────────
--
-- Sessions finished with no attempt rows at all, left by loader failures —
-- 14 of them the weak-areas empty sessions (the defect weakAreaFilterSource
-- guards), the rest from the question_bank.topic outage 26fa45b fixed:
--
--   weak 14 · chapter 3 · bookmarked 2 · subject 1
--   questions they claim to have asked: 385
--   questions they actually asked:        0
--
-- 20261027000000 removed their fabricated 0% accuracy. This removes the other
-- half of the same claim: a question_count of 20 asserts twenty questions were
-- put in front of a student who was shown none, and any figure summed from
-- sessions rather than attempts inherits that.
--
-- question_count goes to 0 rather than the row being deleted. The session was
-- really started and really failed to fill — that is true history, and the
-- earlier reasoning for keeping it stands. What it may not do is claim
-- content. finished_at, accuracy (NULL) and the mode are untouched, so
-- `_practice_session_attempted` still identifies them exactly as before.
--
-- ROLLBACK: supabase/migrations/rollback/20261029000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1 ── the seeded summaries, recomputed from their own attempts
WITH counted AS (
  SELECT qa.session_id,
         count(*)::int                                                              AS attempts,
         count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped,false))::int AS correct,
         count(*) FILTER (WHERE COALESCE(qa.skipped,false))::int                     AS skipped
  FROM public.question_attempts qa
  GROUP BY qa.session_id
)
UPDATE public.practice_sessions ps
   SET correct_count = c.correct,
       wrong_count   = c.attempts - c.correct - c.skipped,
       skipped_count = c.skipped,
       question_count = c.attempts,
       score          = c.correct,
       accuracy = CASE WHEN (c.attempts - c.skipped) > 0
                       THEN round(100.0 * c.correct / (c.attempts - c.skipped), 2) END
  FROM counted c
 WHERE c.session_id = ps.id
   AND ps.finished_at IS NOT NULL
   AND (ps.correct_count <> c.correct
     OR ps.skipped_count <> c.skipped
     OR ps.question_count <> c.attempts);

-- 2 ── a session that asked nothing claims nothing
UPDATE public.practice_sessions ps
   SET question_count = 0
 WHERE ps.finished_at IS NOT NULL
   AND ps.question_count <> 0
   AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);

DO $check$
DECLARE _n int;
BEGIN
  -- every finished session's stored summary now equals its attempts
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  JOIN LATERAL (
    SELECT count(*)::int AS attempts,
           count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped,false))::int AS correct,
           count(*) FILTER (WHERE COALESCE(qa.skipped,false))::int AS skipped
    FROM public.question_attempts qa WHERE qa.session_id = ps.id
  ) a ON true
  WHERE ps.finished_at IS NOT NULL
    AND (ps.question_count <> a.attempts
      OR ps.correct_count  <> a.correct
      OR ps.skipped_count  <> a.skipped);
  IF _n > 0 THEN
    RAISE EXCEPTION '% finished session(s) still disagree with their attempts', _n;
  END IF;

  -- and no session claims questions it never asked
  SELECT count(*) INTO _n
  FROM public.practice_sessions ps
  WHERE ps.finished_at IS NOT NULL AND ps.question_count > 0
    AND NOT EXISTS (SELECT 1 FROM public.question_attempts qa WHERE qa.session_id = ps.id);
  IF _n > 0 THEN
    RAISE EXCEPTION '% shell session(s) still claim questions', _n;
  END IF;
END $check$;

COMMIT;
