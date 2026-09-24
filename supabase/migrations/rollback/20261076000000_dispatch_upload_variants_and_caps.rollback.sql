-- Rollback 20261076000000 — restore bank-only dispatch from 680; drop keep-cap.

BEGIN;

-- Restore 680 dispatch (bank-sourced jobs only).
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
       AND (
         (q.source_question_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.question_bank qb
             WHERE qb.source_question_id = q.source_question_id
               AND qb.variant_tier = q.tier
               AND qb.is_active
               AND qb.replaced_by_question_id IS NULL))
         OR
         (q.source_upload_question_id IS NOT NULL AND EXISTS (
            SELECT 1 FROM public.question_bank qb
             WHERE qb.source_upload_question_id = q.source_upload_question_id
               AND qb.variant_tier = q.tier
               AND qb.is_active
               AND qb.replaced_by_question_id IS NULL))
       )
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

COMMENT ON FUNCTION public.dispatch_variant_generation() IS
  'Cron drain for variant generation. Resolves bank- and upload-sourced jobs from the BANK; dispatches bank-sourced jobs only until the generator accepts upload sources.';

DROP TRIGGER IF EXISTS student_uploads_keep_cap ON public.student_uploads;
DROP FUNCTION IF EXISTS public._student_uploads_enforce_keep_cap();

COMMIT;
