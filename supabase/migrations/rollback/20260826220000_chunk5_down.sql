-- =====================================================================
-- REVERSE OF: 20260826220000_chunk5_homework.sql
--
-- IRREVERSIBLE PARTS, stated plainly:
--   * Dropping homework_answers, homework_completions and homework_questions
--     discards every graded answer and every closure report. There is no other
--     copy.
--   * Dropping topics discards the teacher-built taxonomy. The legacy
--     question_bank.topic strings are untouched, but they are not the same
--     thing and cannot rebuild it.
--   * homework.due_date returns to nullable, but rows that had a NULL before
--     Chunk 5 backfilled nothing (there were none), so no data is restored.
--
-- Restoring the is_late trigger means late submissions become computable
-- again — see docs/decisions.md D1.
-- =====================================================================

-- 1. Write-time rules added to existing tables.
DROP TRIGGER  IF EXISTS trg_homework_submission_lock ON public.homework_submissions;
DROP FUNCTION IF EXISTS public.tg_homework_submission_lock_at_due();

DROP POLICY   IF EXISTS homework_soft_delete_fence ON public.homework;
DROP FUNCTION IF EXISTS public.rpc_purge_deleted_homework();
DROP FUNCTION IF EXISTS public.rpc_close_homework(uuid, boolean);

-- Restore the is_late trigger the chunk stopped.
DROP TRIGGER IF EXISTS trg_homework_is_late ON public.homework_submissions;
CREATE TRIGGER trg_homework_is_late
  BEFORE INSERT OR UPDATE ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_homework_compute_is_late();

COMMENT ON COLUMN public.homework_submissions.is_late IS NULL;

-- 2. New tables, children first.
DROP TRIGGER  IF EXISTS trg_homework_answer_autograde ON public.homework_answers;
DROP FUNCTION IF EXISTS public.tg_homework_answer_autograde();

DROP TABLE IF EXISTS public.homework_answers;
DROP TABLE IF EXISTS public.homework_completions;
DROP TABLE IF EXISTS public.homework_questions;
DROP TABLE IF EXISTS public.topics;

-- 3. Columns homework gained.
DROP INDEX IF EXISTS public.homework_not_deleted_idx;
DROP INDEX IF EXISTS public.homework_due_date_idx;

ALTER TABLE public.homework ALTER COLUMN due_date DROP NOT NULL;

ALTER TABLE public.homework
  DROP COLUMN IF EXISTS deleted_by,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS closes_at,
  DROP COLUMN IF EXISTS submission_mode,
  DROP COLUMN IF EXISTS assigned_date,
  DROP COLUMN IF EXISTS topic,
  DROP COLUMN IF EXISTS chapter_id,
  DROP COLUMN IF EXISTS academic_year_id;

-- 4. Enumerated types (last — every column using them is gone by now).
DROP TYPE IF EXISTS public.homework_completion_status;
DROP TYPE IF EXISTS public.homework_submission_mode;

-- 5. Ledger.
DELETE FROM public.schema_migrations
 WHERE version = '20260826220000_chunk5_homework';
