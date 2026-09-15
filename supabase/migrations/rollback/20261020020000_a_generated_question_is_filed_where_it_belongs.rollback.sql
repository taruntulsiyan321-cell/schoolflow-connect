-- Rollback for 20261020020000_a_generated_question_is_filed_where_it_belongs.sql
--
-- Removes the door. Questions already stored through it stay: they are
-- ordinary bank rows with a topic, and deleting them would pull questions out
-- from under recovery sessions that were planned with them.
--
-- Roll back the callers first (ai-recovery-variants and any generator that
-- calls store_generated_questions), or they fail on a missing function.

BEGIN;

DROP FUNCTION IF EXISTS public.store_generated_questions(jsonb);
DROP FUNCTION IF EXISTS public._question_text_key(text);

DELETE FROM public.schema_migrations
 WHERE version = '20261020020000_a_generated_question_is_filed_where_it_belongs';

DO $verify$
BEGIN
  IF to_regprocedure('public.store_generated_questions(jsonb)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: store_generated_questions still exists';
  END IF;
END
$verify$;

COMMIT;
