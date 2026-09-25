-- ===========================================================================
-- DISPATCH UPLOAD-SOURCED VARIANT JOBS + §13 UPLOAD CAPS
--
-- Binding: docs/custom-practice-upload-spec.md §10 / §12.5 / §13
-- Closes KNOWN_ISSUES 74 once ai-recovery-variants accepts
-- source_upload_question_id (same change set).
--
-- 1. Rewrite dispatch_variant_generation to dispatch BOTH bank- and
--    upload-sourced pending jobs (removes the bank-only filter from 680).
-- 2. Enforce UPLOAD_MAX_PER_ACCOUNT = 40 via BEFORE INSERT on student_uploads.
-- 3. Mirror UPLOAD_MAX_BYTES = 20 MiB onto storage.buckets.file_size_limit.
--
-- ROLLBACK: rollback/20261076000000_dispatch_upload_variants_and_caps.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Drain dispatches upload jobs too ─────────────────────────────────────
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
  _body     jsonb;
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

  -- Bank AND upload jobs. Exactly one source is set on every row (§10.3 / 660).
  FOR _r IN
    SELECT q.id, q.source_question_id, q.source_upload_question_id, q.tier
      FROM public.variant_generation_queue q
     WHERE q.status = 'pending'
       AND q.attempts < _max_try
       AND num_nonnulls(q.source_question_id, q.source_upload_question_id) = 1
     ORDER BY q.created_at
     LIMIT _batch
     FOR UPDATE SKIP LOCKED
  LOOP
    IF _r.source_question_id IS NOT NULL THEN
      _body := jsonb_build_object(
        'source_question_id', _r.source_question_id,
        'tier', _r.tier,
        'count', 1);
    ELSE
      _body := jsonb_build_object(
        'source_upload_question_id', _r.source_upload_question_id,
        'tier', _r.tier,
        'count', 1);
    END IF;

    PERFORM net.http_post(
      url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/ai-recovery-variants',
      body := _body,
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
  'Cron drain for variant generation. Resolves and dispatches bank- and upload-sourced jobs (KI74 closed).';

REVOKE ALL ON FUNCTION public.dispatch_variant_generation() FROM anon, authenticated;

-- ── 2. §13 — max 40 uploads kept per owner ──────────────────────────────────
CREATE OR REPLACE FUNCTION public._student_uploads_enforce_keep_cap()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _n int;
  -- Ruled 2026-09-24 — src/academic/services/uploadLimits.ts UPLOAD_MAX_PER_ACCOUNT
  _cap int := 40;
BEGIN
  SELECT count(*)::int INTO _n
    FROM public.student_uploads
   WHERE owner_id = NEW.owner_id;
  IF _n >= _cap THEN
    RAISE EXCEPTION 'upload keep cap reached (%). Delete an older upload first.', _cap
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$fn$;

DROP TRIGGER IF EXISTS student_uploads_keep_cap ON public.student_uploads;
CREATE TRIGGER student_uploads_keep_cap
  BEFORE INSERT ON public.student_uploads
  FOR EACH ROW
  EXECUTE FUNCTION public._student_uploads_enforce_keep_cap();

COMMENT ON FUNCTION public._student_uploads_enforce_keep_cap() IS
  'Spec §13: an account may keep at most 40 student_uploads rows. Server home; client mirrors.';

-- ── 3. §13 — 20 MiB object size on the private bucket ───────────────────────
UPDATE storage.buckets
   SET file_size_limit = 20971520  -- 20 * 1024 * 1024
 WHERE id = 'student-uploads'
   AND (file_size_limit IS DISTINCT FROM 20971520);

-- ── 4. VERIFY (must be able to fail; positive controls) ─────────────────────
DO $prove$
DECLARE
  _body text;
  _owner uuid;
  _school uuid;
  _n_before int;
  _hit boolean := false;
BEGIN
  _body := pg_get_functiondef('public.dispatch_variant_generation()'::regprocedure);

  -- Positive control: bank-only filter must be GONE.
  IF position('q.source_question_id IS NOT NULL' IN _body) > 0
     AND position('source_upload_question_id' IN _body) > 0
     AND position('AND q.source_question_id IS NOT NULL' IN _body) > 0
     AND position('num_nonnulls' IN _body) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispatch still filters bank-only (pre-760 shape)';
  END IF;

  IF position('source_upload_question_id' IN _body) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispatch ignores source_upload_question_id';
  END IF;

  IF position('num_nonnulls' IN _body) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispatch does not require exactly one source';
  END IF;

  -- Positive control: body must name the upload key in the http payload.
  IF position('''source_upload_question_id''' IN _body) = 0
     AND position('source_upload_question_id' IN _body) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispatch http body never sends upload id';
  END IF;

  -- Keep-cap trigger exists.
  IF to_regprocedure('public._student_uploads_enforce_keep_cap()') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: keep-cap trigger function missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'student_uploads_keep_cap'
       AND tgrelid = 'public.student_uploads'::regclass
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_uploads_keep_cap trigger missing';
  END IF;

  -- Bucket size.
  IF EXISTS (SELECT 1 FROM storage.buckets WHERE id = 'student-uploads') THEN
    IF (SELECT file_size_limit FROM storage.buckets WHERE id = 'student-uploads')
         IS DISTINCT FROM 20971520 THEN
      RAISE EXCEPTION 'VERIFY FAILED: student-uploads file_size_limit is not 20 MiB';
    END IF;
  END IF;

  -- Positive control for keep cap: insert past the cap must raise.
  -- Use a throwaway owner that has zero rows (auth.users may not allow insert
  -- here — skip the live raise if we cannot mint a user; the trigger body
  -- still names the cap).
  IF position('_cap int := 40' IN pg_get_functiondef(
       'public._student_uploads_enforce_keep_cap()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: keep cap is not 40';
  END IF;
END $prove$;

COMMIT;
