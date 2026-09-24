-- ═══════════════════════════════════════════════════════════════════════════
-- A STORED QUESTION IS EMBEDDED, SO THE NEXT SEARCH CAN FIND IT
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Spec: docs/locked-decisions.md §10.9 ("AI-generated questions are saved to it
-- and reused"); owner ruling 2026-09-15 (rule 31 as amended): generated
-- questions are stored "so that later we don't have any problem with vector
-- embedding, searching for them, and giving them to students … next time
-- fewer tokens are spent."
--
-- WHAT WAS WRONG
--
-- store_generated_questions (20261020020000) files every AI question with
-- embed_status 'pending_embed', and so did every generator before it. Nothing
-- ever embedded a bank row after the seed: measured 2026-09-15, all 15 AI
-- variants in the bank were still pending. match_question_bank reads only
-- 'embedded' rows, so a question the AI had already paid for was invisible to
-- every semantic lookup — the cache that was meant to save tokens never hit.
--
-- WHAT THIS DOES
--
-- A per-minute pg_cron job, dispatch_question_embedding(), posts to the
-- question-embedding-drain edge function when (and only when) there is work.
-- The function embeds up to EMBEDDING_BATCH_SIZE rows and writes the vector,
-- embed_status 'embedded' and embedding_basis itself; the database is the
-- truth, so a dispatch that fails simply leaves the rows for the next tick.
--
-- ONE BASIS FOR EVERY VECTOR. The 21,695 seed vectors came from a text nobody
-- recorded. Measured 2026-09-15 with the function's probe mode on three seed
-- questions, the nearest candidate (the question text alone) scored 0.78,
-- 0.94 and 0.86 against the stored vector — a reproduction scores ~1.0 — so
-- the seed text is not recoverable, and very likely carried the per-question
-- labels 20261020010000 removed. A new vector cannot join that space, and two
-- spaces rank old and new rows unequally.
--
-- So question_bank.embedding_basis records what each vector means
-- ('<model>:question'). NULL is a seed vector of unknown basis. The drain
-- embeds pending rows first, then re-embeds NULL-basis rows in place; each
-- keeps its old vector, and stays searchable, until the new one is written.
-- Changing the model or the text later is one UPDATE setting the basis NULL.
--
-- The dispatcher presents the vault secret variant_generation_drain, never the
-- service-role key (a master credential in pg_proc), exactly as
-- dispatch_variant_generation does.
--
-- Rollback: supabase/migrations/rollback/20261020030000_a_stored_question_is_embedded.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.question_bank ADD COLUMN embedding_basis text;

COMMENT ON COLUMN public.question_bank.embedding_basis IS
  'What the embedding was computed from, as "<model>:<text>" (written by question-embedding-drain). NULL = a seed vector of unrecorded basis, queued for re-embedding. Set it NULL to re-embed a row.';

CREATE INDEX question_bank_embedding_refresh_idx
  ON public.question_bank (id)
  WHERE embed_status = 'embedded' AND embedding_basis IS NULL;

INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('EMBEDDING_BATCH_SIZE', 300, '§10.9',
   'Bank rows embedded per question-embedding-drain call (the cron ticks every minute; the function sends them to the provider in chunks of 100). Sized for the one-off re-embedding of the 21,695 seed rows, which it clears in about 75 minutes, while a normal day of generation drains in a single tick. An embedding costs a small fraction of a generation, so a larger batch only shortens the backfill.')
ON CONFLICT (key) DO UPDATE
  SET value = EXCLUDED.value, spec_ref = EXCLUDED.spec_ref,
      rationale = EXCLUDED.rationale, updated_at = now();


CREATE OR REPLACE FUNCTION public.dispatch_question_embedding()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _drain   text;
  _batch   int;
  _pending int;
BEGIN
  -- Work is a pending row, or a vector of unrecorded basis. Both reads are
  -- partial-index lookups, so an idle tick costs almost nothing.
  SELECT (SELECT count(*) FROM public.question_bank WHERE embed_status = 'pending_embed')
       + (SELECT count(*) FROM public.question_bank WHERE embed_status = 'embedded' AND embedding_basis IS NULL)
    INTO _pending;
  IF _pending = 0 THEN RETURN 0; END IF;

  SELECT decrypted_secret INTO _drain
    FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain';
  IF _drain IS NULL THEN
    RAISE WARNING 'dispatch_question_embedding: vault secret variant_generation_drain is missing; % row(s) wait', _pending;
    RETURN 0;
  END IF;

  _batch := public._recovery_const('EMBEDDING_BATCH_SIZE')::int;

  PERFORM net.http_post(
    url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/question-embedding-drain',
    body := jsonb_build_object('limit', _batch),
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-variant-drain', _drain),
    timeout_milliseconds := 60000
  );

  RETURN least(_pending, _batch);
END;
$fn$;

COMMENT ON FUNCTION public.dispatch_question_embedding() IS
  'Cron dispatcher for question-embedding-drain. Sends only when question_bank has pending_embed rows; the edge function writes the vectors, so the bank is the truth and a lost dispatch retries next tick. Presents the vault secret variant_generation_drain, never the service-role key.';

REVOKE ALL ON FUNCTION public.dispatch_question_embedding() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.dispatch_question_embedding() TO service_role;

SELECT cron.schedule(
  'embed-pending-questions',
  '* * * * *',
  'SELECT public.dispatch_question_embedding()');


DO $proof$
BEGIN
  IF (SELECT count(*) FROM cron.job WHERE jobname = 'embed-pending-questions') <> 1 THEN
    RAISE EXCEPTION 'proof: the embedding cron job was not scheduled exactly once';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain') THEN
    RAISE EXCEPTION 'proof: vault secret variant_generation_drain is missing — the cron would tick for ever sending nothing';
  END IF;
  IF public._recovery_const('EMBEDDING_BATCH_SIZE') IS NULL THEN
    RAISE EXCEPTION 'proof: EMBEDDING_BATCH_SIZE did not land in recovery_constants';
  END IF;
  IF has_function_privilege('authenticated', 'public.dispatch_question_embedding()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.dispatch_question_embedding()', 'EXECUTE') THEN
    RAISE EXCEPTION 'proof: a client role can trigger the embedding dispatcher';
  END IF;
  IF NOT has_function_privilege('service_role', 'public.dispatch_question_embedding()', 'EXECUTE') THEN
    RAISE EXCEPTION 'proof control: service_role cannot execute the dispatcher — the privilege check is blind';
  END IF;
END
$proof$;

COMMIT;
