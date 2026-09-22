-- Rollback for 20261020030000_a_stored_question_is_embedded.sql
--
-- Stops the embedding job and removes what it added. Vectors already written
-- by question-embedding-drain stay: they are valid vectors of the question
-- text, and search keeps working on them. Removing embedding_basis forgets
-- WHICH rows were re-embedded; a later re-run would treat every row as
-- unrecorded and embed it again, which costs a few cents and nothing else.
--
-- Undeploy (or leave idle) the question-embedding-drain edge function
-- separately; without the cron nothing calls it.

BEGIN;

SELECT cron.unschedule('embed-pending-questions')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'embed-pending-questions');

DROP FUNCTION IF EXISTS public.dispatch_question_embedding();

DELETE FROM public.recovery_constants WHERE key = 'EMBEDDING_BATCH_SIZE';

DROP INDEX IF EXISTS public.question_bank_embedding_refresh_idx;
ALTER TABLE public.question_bank DROP COLUMN IF EXISTS embedding_basis;

DELETE FROM public.schema_migrations WHERE version = '20261020030000_a_stored_question_is_embedded';

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'embed-pending-questions') THEN
    RAISE EXCEPTION 'rollback: the embedding cron job is still scheduled';
  END IF;
  IF to_regprocedure('public.dispatch_question_embedding()') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: dispatch_question_embedding still exists';
  END IF;
END
$verify$;

COMMIT;
