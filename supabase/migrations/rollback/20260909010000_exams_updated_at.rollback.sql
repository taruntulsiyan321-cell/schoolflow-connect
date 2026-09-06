-- Rollback for 20260909010000_exams_updated_at.sql
--
-- Drops the trigger and the column.
--
-- WHAT ROLLING BACK COSTS YOU. `examRepository.setExamLocked` and
-- `setExamResultsPublished` both write `exams.updated_at`. Without the column
-- PostgREST answers PGRST204 and the UI shows "This feature isn't available
-- right now.", so finalising a sitting and publishing results become
-- unreachable again and `marks.results_published` can never be emitted.
--
-- Roll back only to restore the previous state deliberately. If the intent is
-- to remove the column for good, remove the two writes in
-- src/academic/repository/examRepository.ts in the same change -- otherwise the
-- code goes on writing a column that is not there.

BEGIN;

DROP TRIGGER IF EXISTS exams_set_updated ON public.exams;
ALTER TABLE public.exams DROP COLUMN IF EXISTS updated_at;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='exams' AND column_name='updated_at') THEN
    RAISE EXCEPTION 'ABORT: exams.updated_at still exists after rollback';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid
              WHERE c.relname='exams' AND t.tgname='exams_set_updated') THEN
    RAISE EXCEPTION 'ABORT: exams_set_updated still exists after rollback';
  END IF;
  RAISE NOTICE 'exams.updated_at removed (finalise and publish are unreachable again, as intended).';
END $verify$;

COMMIT;
