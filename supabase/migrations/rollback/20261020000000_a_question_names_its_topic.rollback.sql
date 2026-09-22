-- Rollback for 20261020000000_a_question_names_its_topic.sql
--
-- Only valid BEFORE 20261020010000 is applied: that migration drops the old
-- topic columns, and after it topic_id is the only record of a question's
-- topic. Roll that one back first.
--
-- Removes the link and the topics this migration created. Topics a teacher
-- added by hand (created_by IS NOT NULL) or that homework points at are kept:
-- they were not this migration's to delete.

BEGIN;

DROP INDEX IF EXISTS public.question_bank_topic_idx;
ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_topic_needs_chapter;
ALTER TABLE public.question_bank DROP CONSTRAINT IF EXISTS question_bank_topic_in_its_chapter_fkey;
ALTER TABLE public.question_bank DROP COLUMN IF EXISTS topic_id;

DELETE FROM public.topics t
 WHERE t.created_by IS NULL
   AND NOT EXISTS (SELECT 1 FROM public.homework h WHERE h.topic_id = t.id);

ALTER TABLE public.topics DROP CONSTRAINT IF EXISTS topics_id_chapter_key;

DELETE FROM public.schema_migrations WHERE version = '20261020000000_a_question_names_its_topic';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'question_bank' AND column_name = 'topic_id') THEN
    RAISE EXCEPTION 'rollback: question_bank.topic_id still exists';
  END IF;
  IF EXISTS (SELECT 1 FROM public.topics WHERE created_by IS NULL
              AND NOT EXISTS (SELECT 1 FROM public.homework h WHERE h.topic_id = topics.id)) THEN
    RAISE EXCEPTION 'rollback: migration-created topics remain';
  END IF;
END
$verify$;

COMMIT;
