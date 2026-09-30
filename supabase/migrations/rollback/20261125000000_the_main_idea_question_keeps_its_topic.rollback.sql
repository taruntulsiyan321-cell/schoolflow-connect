-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the main-idea question without a topic again
--
-- Puts back what 20261090000000 left: topic_id NULL on
-- a45db281-b60b-4bb2-b2c9-5654eedefde1. Only if it still names "Main idea" —
-- a later filing is not undone by this. Note what you are restoring: a
-- chaptered question with no topic, which rule 31 forbids and CHUNK2_VERIFY §5
-- reports as a failure.
--
-- Undoes: 20261125000000_the_main_idea_question_keeps_its_topic.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

UPDATE public.question_bank
   SET topic_id = NULL
 WHERE id = 'a45db281-b60b-4bb2-b2c9-5654eedefde1'
   AND topic_id = 'e3c430c9-a01c-46a7-a485-c805cca465c1';

DELETE FROM public.schema_migrations
 WHERE version = '20261125000000_the_main_idea_question_keeps_its_topic';

COMMIT;
