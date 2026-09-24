DROP INDEX IF EXISTS public.student_upload_questions_from_note_idx;

ALTER TABLE public.student_upload_questions
  DROP COLUMN IF EXISTS derived_from_note_id;
