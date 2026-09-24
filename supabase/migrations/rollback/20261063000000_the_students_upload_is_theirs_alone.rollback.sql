-- Rollback: 20261063000000_the_students_upload_is_theirs_alone
-- Restores question_attempts.source vocabulary without 'upload'.

BEGIN;

DROP POLICY IF EXISTS student_upload_notes_owner ON public.student_upload_notes;
DROP POLICY IF EXISTS student_upload_questions_owner ON public.student_upload_questions;
DROP POLICY IF EXISTS student_uploads_owner ON public.student_uploads;

DROP TABLE IF EXISTS public.student_upload_notes;
DROP TABLE IF EXISTS public.student_upload_questions;
DROP TABLE IF EXISTS public.student_uploads;

DROP POLICY IF EXISTS "student uploads read own" ON storage.objects;
DROP POLICY IF EXISTS "student uploads insert own" ON storage.objects;
DROP POLICY IF EXISTS "student uploads update own" ON storage.objects;
DROP POLICY IF EXISTS "student uploads delete own" ON storage.objects;

DELETE FROM storage.buckets WHERE id = 'student-uploads';

ALTER TABLE public.question_attempts DROP CONSTRAINT IF EXISTS question_attempts_source_check;
ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_source_check
  CHECK (source = ANY (ARRAY['battle', 'test', 'practice', 'mistake_book']));

COMMIT;
