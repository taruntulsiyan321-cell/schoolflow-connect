-- ROLLBACK for 20261030000000_a_session_is_as_long_as_its_questions_took.
--
-- READ THIS FIRST. This restores the DEFECT, not a neutral earlier state.
--
-- The forward migration filled practice_sessions.total_time_ms from each
-- session's own question_attempts. Clearing it again does not return the rows
-- to "unknown duration": it returns Analysis to computing duration from
-- finished_at - created_at, which on this database is a seeded 18-minute
-- constant on 240 of 284 sessions, and which is what made "which subject
-- takes you longest" an artefact of the fixture.
--
-- The 17 sessions written by the live finish path are NOT cleared: their
-- roll-up predates this migration and is the app's own measurement.
--
-- There is no way to distinguish a backfilled value from a live one by
-- inspection alone, because they are computed identically (that agreement is
-- what the forward migration verified). The cutoff below is therefore by
-- time: only sessions that finished before this migration ran, and that the
-- live path had left empty, are cleared. Adjust the timestamp if the
-- migration is applied at a different moment.

BEGIN;

UPDATE public.practice_sessions ps
SET total_time_ms = NULL
WHERE ps.finished_at < TIMESTAMPTZ '2026-09-17 00:00:00+00'
  AND ps.total_time_ms IS NOT NULL;

DO $$
BEGIN
  RAISE NOTICE 'total_time_ms cleared for pre-2026-09-17 sessions; Analysis is back on wall clock for them';
END $$;

COMMIT;
