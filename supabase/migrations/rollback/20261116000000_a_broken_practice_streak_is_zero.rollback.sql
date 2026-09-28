-- Rollback of 20261116000000_a_broken_practice_streak_is_zero.sql
--
-- Removes the daily job and the function. The streaks it already zeroed stay
-- zero: the numbers they held were streaks that had broken, and there is no
-- honest value to put back. The writer (_progression_bump_study_streak) was
-- never changed and needs nothing restored.

BEGIN;

DO $cron$
BEGIN
  PERFORM cron.unschedule('reset-broken-study-streaks');
EXCEPTION WHEN OTHERS THEN
  NULL;   -- not scheduled
END
$cron$;

DROP FUNCTION IF EXISTS public.reset_broken_study_streaks();

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-broken-study-streaks') THEN
    RAISE EXCEPTION 'the reset job is still scheduled';
  END IF;
  IF to_regprocedure('public.reset_broken_study_streaks()') IS NOT NULL THEN
    RAISE EXCEPTION 'the reset function still exists';
  END IF;
END
$check$;

COMMIT;
