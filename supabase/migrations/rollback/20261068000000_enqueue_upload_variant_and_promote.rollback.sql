-- Rollback: 20261068000000_enqueue_upload_variant_and_promote
--
-- Drops the enqueue RPC and provenance column. Restores store_generated_questions
-- / dispatch_variant_generation from 202610620 + 202610120 behavior by
-- re-applying those migrations' function bodies is out of scope here — this
-- rollback refuses if any bank row carries source_upload_question_id.

BEGIN;

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM public.question_bank
   WHERE source_upload_question_id IS NOT NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION
      'rollback refused: % question_bank row(s) reference source_upload_question_id',
      _n;
  END IF;
END $$;

DROP FUNCTION IF EXISTS public.rpc_enqueue_upload_variant_generation(uuid, smallint);

DROP INDEX IF EXISTS public.question_bank_source_upload_idx;

ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_one_variant_source;

ALTER TABLE public.question_bank
  DROP COLUMN IF EXISTS source_upload_question_id;

-- Restore prior drain (bank-only resolve). Re-create from 202610120 shape.
CREATE OR REPLACE FUNCTION public.dispatch_variant_generation()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _drain    text;
  _batch    int;
  _max_try  int;
  _sent     int := 0;
  _resolved int;
  _r        record;
BEGIN
  WITH done AS (
    UPDATE public.variant_generation_queue q
       SET status = 'done', resolved_at = now()
     WHERE q.status = 'pending'
       AND EXISTS (
         SELECT 1 FROM public.question_bank qb
          WHERE qb.source_question_id = q.source_question_id
            AND qb.variant_tier = q.tier
            AND qb.is_active
            AND qb.replaced_by_question_id IS NULL)
    RETURNING 1)
  SELECT count(*)::int INTO _resolved FROM done;

  _batch   := public._recovery_const('GENERATION_BATCH_SIZE')::int;
  _max_try := public._recovery_const('GENERATION_MAX_RETRIES')::int;

  UPDATE public.variant_generation_queue
     SET status = 'failed', resolved_at = now(),
         last_error = COALESCE(last_error, 'exhausted retries with no variant in the bank')
   WHERE status = 'pending' AND attempts >= _max_try;

  SELECT decrypted_secret INTO _drain
    FROM vault.decrypted_secrets WHERE name = 'variant_generation_drain';

  IF _drain IS NULL THEN
    RAISE WARNING 'dispatch_variant_generation: vault secret variant_generation_drain is missing; % job(s) wait',
      (SELECT count(*) FROM public.variant_generation_queue WHERE status = 'pending');
    RETURN 0;
  END IF;

  FOR _r IN
    SELECT q.id, q.source_question_id, q.tier
      FROM public.variant_generation_queue q
     WHERE q.status = 'pending'
       AND q.attempts < _max_try
       AND q.source_question_id IS NOT NULL
     ORDER BY q.created_at
     LIMIT _batch
     FOR UPDATE SKIP LOCKED
  LOOP
    PERFORM net.http_post(
      url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/ai-recovery-variants',
      body := jsonb_build_object(
        'source_question_id', _r.source_question_id,
        'tier', _r.tier,
        'count', 1),
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-variant-drain', _drain),
      timeout_milliseconds := 60000
    );

    UPDATE public.variant_generation_queue
       SET attempts = attempts + 1, dispatched_at = now()
     WHERE id = _r.id;

    _sent := _sent + 1;
  END LOOP;

  RETURN _sent;
END;
$fn$;

REVOKE ALL ON FUNCTION public.dispatch_variant_generation() FROM anon, authenticated;

COMMIT;
