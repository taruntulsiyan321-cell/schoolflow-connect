-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7.5 DB side, all four migrations together
--   20260829130000_chunk75a_test_schema
--   20260829140000_chunk75b_test_rpcs
--   20260829150000_chunk75a_fix_status_constraint
--   20260829160000_chunk75c_mistake_vocabulary
--
-- Reversed as one unit: the fix only repairs a constraint 7.5a created, and
-- the vocabulary migration exists so the RPCs can write a mistake at all.
-- Rolling back any one alone leaves a half-converged schema.
--
-- SAFE while DPP is still live. The whole point of 7.5's ordering is that the
-- DPP tables are dropped LAST, so at this point the Tests feature still runs
-- on dpps and nothing in the app reads what this removes.
--
-- LIMIT — test_marks rows written by rpc_test_submit are NOT removed. A mark
-- is school data and a real record of a student's performance; deleting marks
-- to undo a schema change would be the wrong trade. They are left in place,
-- and test_marks predates this chunk. Check before running if that matters:
--   SELECT count(*) FROM test_marks WHERE test_id IN (SELECT id FROM tests WHERE status = 'published');
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_test_submit(uuid, jsonb);
DROP FUNCTION IF EXISTS public.rpc_test_start(uuid);
DROP FUNCTION IF EXISTS public.rpc_test_questions_for_attempt(uuid);

-- Order matters: answers reference attempts and questions.
DROP TABLE IF EXISTS public.test_answers;
DROP TABLE IF EXISTS public.test_attempts;
DROP TABLE IF EXISTS public.test_questions;

-- student_mistakes.chapter_id: dropped WITH its data. Nothing read it before
-- this chunk (the readers all use the `chapter` text), so nothing regresses.
DROP INDEX IF EXISTS public.student_mistakes_chapter_idx;
ALTER TABLE public.student_mistakes DROP COLUMN IF EXISTS chapter_id;

-- The mistake vocabulary goes back to naming dpp. Rows migrated from 'dpp' to
-- 'test' are migrated back, so the restored CHECK can hold.
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_source_check;
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_assessment_type_check;

UPDATE public.student_mistakes SET source          = 'dpp' WHERE source = 'test';
UPDATE public.student_mistakes SET assessment_type = 'dpp' WHERE assessment_type = 'test';

ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_source_check
  CHECK (source = ANY (ARRAY['dpp', 'battleground', 'exam', 'practice']));
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_assessment_type_check
  CHECK (assessment_type = ANY (ARRAY['practice', 'dpp', 'battle']));

-- tests: back to two status states and no attempt config.
-- Any test left at 'published' is moved to 'draft' first, or the restored
-- constraint cannot be added.
UPDATE public.tests SET status = 'draft' WHERE status = 'published';

ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_status_check;
ALTER TABLE public.tests
  ADD CONSTRAINT tests_status_known
  CHECK (status = ANY (ARRAY['draft', 'submitted']));

ALTER TABLE public.tests
  DROP COLUMN IF EXISTS duration_sec,
  DROP COLUMN IF EXISTS passing_marks,
  DROP COLUMN IF EXISTS published_at;

COMMIT;
