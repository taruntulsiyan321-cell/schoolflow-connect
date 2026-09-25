-- ROLLBACK 20261096000000 — the constraints go and every recorded row is back
-- as it was: the two management questions untagged again, the Chemistry
-- questions and their mistake restored, their uploads as they were.
BEGIN;

ALTER TABLE public.student_mistakes DROP CONSTRAINT student_mistakes_private_filed;
ALTER TABLE public.student_capture_questions DROP CONSTRAINT student_capture_questions_filed;
ALTER TABLE public.student_upload_notes DROP CONSTRAINT student_upload_notes_filed;
ALTER TABLE public.student_upload_questions DROP CONSTRAINT student_upload_questions_filed;

UPDATE public.student_upload_questions q SET chapter_id = (c.payload->>'chapter_id')::uuid
  FROM public.untagged_cleanup_20261096 c
 WHERE c.kind = 'tagged' AND c.table_name = 'student_upload_questions' AND q.id = c.row_id;

INSERT INTO public.student_upload_questions
SELECT (jsonb_populate_record(NULL::public.student_upload_questions, payload)).*
  FROM public.untagged_cleanup_20261096 WHERE kind = 'deleted' AND table_name = 'student_upload_questions';
INSERT INTO public.student_mistakes
SELECT (jsonb_populate_record(NULL::public.student_mistakes, payload)).*
  FROM public.untagged_cleanup_20261096 WHERE kind = 'deleted' AND table_name = 'student_mistakes';

UPDATE public.student_uploads u
   SET status = c.payload->>'status', verdict = c.payload->>'verdict',
       refusal_reason = c.payload->>'refusal_reason', updated_at = (c.payload->>'updated_at')::timestamptz
  FROM public.untagged_cleanup_20261096 c
 WHERE c.kind = 'upload_marked' AND u.id = c.row_id;

DROP TABLE public.untagged_cleanup_20261096;

DELETE FROM public.schema_migrations WHERE version = '20261096000000_no_student_question_is_left_untagged';

COMMIT;
