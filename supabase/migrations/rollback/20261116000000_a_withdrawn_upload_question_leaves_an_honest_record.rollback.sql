-- ROLLBACK 20261116000000 — the trigger goes, and the rows it flagged are
-- counted again.
--
-- THIS RESTORES THE DEFECT: attempts on questions the product withdrew go back
-- to being counted in `effort.attempts` while remaining absent from by_chapter
-- and by_subject, so one number for one thing becomes two again.
--
-- It is exact for the flag and NOT exact for the empty subject: the forward
-- migration turned `subject = ''` into NULL on the same rows, and '' carried no
-- information to put back (it is what a client sent when it had none). Nothing
-- reads either value — both are absent from every per-subject grouping — so the
-- rollback leaves the NULL rather than inventing an empty string.

BEGIN;

DO $rollback$
DECLARE
  _n int;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
     WHERE t.tgrelid = 'public.student_upload_questions'::regclass
       AND t.tgname = 'upload_question_withdrawn') THEN
    RAISE EXCEPTION '20261116000000 was never applied here — there is nothing to roll back';
  END IF;

  SELECT count(*) INTO _n
    FROM public.question_attempts qa
   WHERE qa.source = 'upload'
     AND qa.excluded_from_accuracy
     AND NULLIF(qa.generated_question->>'upload_question_id', '') IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.student_upload_questions q
        WHERE q.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid);
  RAISE NOTICE 'counting % attempt(s) on withdrawn questions again', _n;
END
$rollback$;

DROP TRIGGER IF EXISTS upload_question_withdrawn ON public.student_upload_questions;
DROP FUNCTION IF EXISTS public.tg_upload_question_withdrawn();

-- Only the rows this migration could have flagged: an upload attempt whose
-- question is gone. A disputed answer's exclusion (§6.1, 20261065000000) is a
-- different decision by a different writer and is left alone — it is keyed on a
-- question that still exists.
UPDATE public.question_attempts qa
   SET excluded_from_accuracy = false
 WHERE qa.source = 'upload'
   AND qa.excluded_from_accuracy
   AND NULLIF(qa.generated_question->>'upload_question_id', '') IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.student_upload_questions q
      WHERE q.id = NULLIF(qa.generated_question->>'upload_question_id', '')::uuid);

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'tg_upload_question_withdrawn') THEN
    RAISE EXCEPTION 'the trigger function is still here';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20261116000000_a_withdrawn_upload_question_leaves_an_honest_record';

COMMIT;
