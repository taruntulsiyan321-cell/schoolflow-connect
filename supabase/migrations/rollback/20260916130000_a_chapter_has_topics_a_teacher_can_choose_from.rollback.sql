-- ROLLBACK 20260916130000_a_chapter_has_topics_a_teacher_can_choose_from — written 2026-09-22; the migration shipped
-- without one.
--
-- Drops the two topic_group indexes and the column. IF EXISTS throughout: 20261020010000_the_old_topic_labels_leave_the_bank
-- retired the free-text topic labels in favour of question_bank.topic_id -> public.topics, so on a database that has run
-- it there may be nothing left of this to drop.
--
-- NOT RECOVERABLE: the classification scripts/classify-question-topics.mjs wrote into topic_group. It was derived from
-- `topic`, and the topics table is its successor; nothing reads topic_group now.
DROP INDEX IF EXISTS public.question_bank_chapter_topic_group_idx;
DROP INDEX IF EXISTS public.question_bank_subject_chapter_topic_group_idx;
ALTER TABLE public.question_bank DROP COLUMN IF EXISTS topic_group;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'question_bank' AND column_name = 'topic_group') THEN
    RAISE EXCEPTION 'rollback: question_bank.topic_group is still there';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20260916130000_a_chapter_has_topics_a_teacher_can_choose_from';
