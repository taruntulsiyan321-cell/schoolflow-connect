-- Rollback 20261077000000_screen_capture_mistakes_are_private
-- Restores upload-only mistake XOR + 15-arg rpc_record_concept_mistake from 700.
-- Does NOT restore the pre-capture recovery plan body (re-apply 710 after rollback).

BEGIN;

DROP POLICY IF EXISTS student_capture_allowed_apps_owner ON public.student_capture_allowed_apps;
DROP TABLE IF EXISTS public.student_capture_allowed_apps;

-- Clear capture pointers before dropping FK column.
UPDATE public.student_mistakes SET capture_question_id = NULL WHERE capture_question_id IS NOT NULL;
DELETE FROM public.student_mistakes WHERE source = 'screen_capture';

DROP INDEX IF EXISTS public.student_mistakes_user_source_capture_q;
DROP INDEX IF EXISTS public.student_mistakes_capture_question_idx;

ALTER TABLE public.student_mistakes
  DROP CONSTRAINT IF EXISTS student_mistakes_question_xor_sources;

ALTER TABLE public.student_mistakes
  DROP COLUMN IF EXISTS capture_question_id;

ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_question_xor_upload CHECK (
    num_nonnulls(question_id, upload_question_id) <= 1
  );

ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_source_check;
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_source_check
  CHECK (source = ANY (ARRAY['test', 'battleground', 'exam', 'practice', 'upload']));

ALTER TABLE public.question_attempts DROP CONSTRAINT IF EXISTS question_attempts_source_check;
ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_source_check
  CHECK (source = ANY (ARRAY['battle', 'test', 'practice', 'mistake_book', 'upload']));

DROP POLICY IF EXISTS student_capture_questions_owner ON public.student_capture_questions;
DROP TABLE IF EXISTS public.student_capture_questions;

DROP FUNCTION IF EXISTS public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid
);

-- Caller must re-apply 20261070000000 / 20261071000000 bodies for the 15-arg
-- mistake writer and upload-only recovery plan.

COMMIT;
