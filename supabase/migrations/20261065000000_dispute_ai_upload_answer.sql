-- ===========================================================================
-- DISPUTE AN AI UPLOAD ANSWER
--
-- Binding: docs/custom-practice-upload-spec.md §6.1 / acceptance §12.6
--
-- §6.1: on an AI-answered upload question the student can say the key is
-- wrong. That clears the mistake it created and removes the attempt from
-- their accuracy.
--
-- Accuracy is pooled from question_attempts (20261022000000 / 20261023000000):
--   correct / answered, answered = NOT skipped.
-- Deleting attempts would strip them from every reader, but Signal Engine
-- §15.11 forbids discarding raw evidence. So attempts stay, marked
-- excluded_from_accuracy, and the three canonical accuracy readers omit them
-- the same way they already omit skips.
--
-- ROLLBACK: rollback/20261065000000_dispute_ai_upload_answer.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Exclusion flag on attempts ───────────────────────────────────────────
ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS excluded_from_accuracy boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.question_attempts.excluded_from_accuracy IS
  'Spec §6.1: disputed AI-upload attempt — retained for audit, omitted from practice accuracy.';

CREATE INDEX IF NOT EXISTS question_attempts_excluded_from_accuracy_idx
  ON public.question_attempts (user_id)
  WHERE excluded_from_accuracy = true;

-- ── 2. Canonical accuracy readers omit excluded attempts ────────────────────
-- Same substitution style as 20261022000000: refuse if the live body moved.

DO $exam$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = '_exam_readiness';
  IF _def IS NULL THEN RAISE EXCEPTION '_exam_readiness not found'; END IF;

  IF position('excluded_from_accuracy' IN _def) > 0 THEN
    RAISE NOTICE '_exam_readiness already omits excluded_from_accuracy';
    RETURN;
  END IF;

  _new := replace(_def,
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false)), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;',
    'SELECT round(100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false))
                / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false)), 0), 1)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;');

  IF _new = _def THEN
    RAISE EXCEPTION '_exam_readiness: accuracy anchor matched nothing — re-read live body';
  END IF;
  EXECUTE _new;
END $exam$;

DO $profile$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'refresh_student_academic_profile';
  IF _def IS NULL THEN RAISE EXCEPTION 'refresh_student_academic_profile not found'; END IF;

  IF position('excluded_from_accuracy' IN _def) > 0 THEN
    RAISE NOTICE 'refresh_student_academic_profile already omits excluded_from_accuracy';
    RETURN;
  END IF;

  _new := replace(_def,
    'SELECT coalesce(round(
           100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))
                 / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false)), 0), 2), 0)
  INTO _practice_avg
  FROM public.question_attempts
  WHERE _user IS NOT NULL AND user_id = _user;',
    'SELECT coalesce(round(
           100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false))
                 / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false) AND NOT COALESCE(excluded_from_accuracy, false)), 0), 2), 0)
  INTO _practice_avg
  FROM public.question_attempts
  WHERE _user IS NOT NULL AND user_id = _user;');

  IF _new = _def THEN
    RAISE EXCEPTION 'refresh_student_academic_profile: accuracy anchor matched nothing — re-read live body';
  END IF;
  EXECUTE _new;
END $profile$;

DO $analytics$
DECLARE
  _def text;
  _new text;
  _n int;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_student_practice_analytics';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_student_practice_analytics not found'; END IF;

  IF position('excluded_from_accuracy' IN _def) > 0 THEN
    RAISE NOTICE 'rpc_student_practice_analytics already omits excluded_from_accuracy';
    RETURN;
  END IF;

  -- Every roll-up reads question_attempts for this user. Gate excluded rows
  -- once at the WHERE so attempts / answered / accuracy all agree.
  _new := regexp_replace(
    _def,
    'FROM public\.question_attempts qa\s+WHERE qa\.user_id = _uid',
    E'FROM public.question_attempts qa\n        WHERE qa.user_id = _uid\n          AND NOT COALESCE(qa.excluded_from_accuracy, false)',
    'g'
  );

  IF _new = _def THEN
    RAISE EXCEPTION 'rpc_student_practice_analytics: attempt WHERE anchor matched nothing';
  END IF;

  _n := (length(_new) - length(replace(_new, 'excluded_from_accuracy', '')))
        / length('excluded_from_accuracy');
  IF _n < 4 THEN
    RAISE EXCEPTION 'rpc_student_practice_analytics: expected >=4 excluded filters, got %', _n;
  END IF;

  EXECUTE _new;
END $analytics$;

-- ── 3. Owner-scoped dispute RPC ─────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_dispute_ai_upload_answer(_upload_question_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _uq public.student_upload_questions%ROWTYPE;
  _cleared int := 0;
  _excluded int := 0;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  IF _upload_question_id IS NULL THEN
    RAISE EXCEPTION 'upload question id required';
  END IF;

  -- Owner fence: a non-owner sees "not found", never another account's row.
  SELECT * INTO _uq
    FROM public.student_upload_questions
   WHERE id = _upload_question_id
     AND owner_id = _uid;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'upload question not found';
  END IF;

  IF _uq.answer_source IS DISTINCT FROM 'ai' THEN
    RAISE EXCEPTION 'only AI-answered questions can be disputed';
  END IF;

  -- Clear open mistakes tied to this upload question (§6.1).
  -- After 20261067000000 source='upload'; before that, upload mistakes were
  -- filed as practice with question_id NULL. Match both by question text for
  -- this owner — bank mistakes carry a real question_id and are untouched.
  UPDATE public.student_mistakes sm
     SET status = 'cleared',
         cleared_at = now()
   WHERE sm.user_id = _uid
     AND sm.status = 'open'
     AND sm.question_text = _uq.question_text
     AND (
       sm.source = 'upload'
       OR (sm.source = 'practice' AND sm.question_id IS NULL)
     );
  GET DIAGNOSTICS _cleared = ROW_COUNT;

  -- Exclude matching upload attempts from accuracy (keep the rows).
  UPDATE public.question_attempts qa
     SET excluded_from_accuracy = true
   WHERE qa.user_id = _uid
     AND qa.source = 'upload'
     AND qa.source_id = _uq.upload_id
     AND NOT qa.excluded_from_accuracy
     AND (
       qa.generated_question->>'question' = _uq.question_text
       OR qa.generated_question->>'upload_question_id' = _upload_question_id::text
     );
  GET DIAGNOSTICS _excluded = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'upload_question_id', _upload_question_id,
    'cleared_mistakes', _cleared,
    'excluded_attempts', _excluded
  );
END;
$fn$;

COMMENT ON FUNCTION public.rpc_dispute_ai_upload_answer(uuid) IS
  'Spec §6.1: owner disputes an AI upload answer key — clears open mistakes and excludes attempts from practice accuracy.';

REVOKE ALL ON FUNCTION public.rpc_dispute_ai_upload_answer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_dispute_ai_upload_answer(uuid) TO authenticated;

-- ── 4. VERIFY (must be able to fail) ────────────────────────────────────────
DO $prove$
DECLARE
  _er text;
  _rp text;
  _pa text;
  _rpc text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = 'question_attempts'
       AND column_name = 'excluded_from_accuracy'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: question_attempts.excluded_from_accuracy missing';
  END IF;

  IF to_regprocedure('public.rpc_dispute_ai_upload_answer(uuid)') IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_dispute_ai_upload_answer(uuid) missing';
  END IF;

  IF NOT has_function_privilege(
    'authenticated',
    'public.rpc_dispute_ai_upload_answer(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: authenticated cannot execute rpc_dispute_ai_upload_answer';
  END IF;

  IF has_function_privilege(
    'anon',
    'public.rpc_dispute_ai_upload_answer(uuid)',
    'EXECUTE'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: anon can execute rpc_dispute_ai_upload_answer';
  END IF;

  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _rpc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_dispute_ai_upload_answer';
  IF position('owner_id = _uid' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute RPC is not owner-scoped';
  END IF;
  IF position('answer_source' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute RPC does not require AI answer_source';
  END IF;
  IF position('excluded_from_accuracy' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute RPC does not set excluded_from_accuracy';
  END IF;
  IF position('status = ''cleared''' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute RPC does not clear student_mistakes';
  END IF;

  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _er
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_exam_readiness';
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _rp
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'refresh_student_academic_profile';
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _pa
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_student_practice_analytics';

  IF position('excluded_from_accuracy' IN _er) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: _exam_readiness still counts excluded attempts';
  END IF;
  IF position('excluded_from_accuracy' IN _rp) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: refresh_student_academic_profile still counts excluded attempts';
  END IF;
  IF position('excluded_from_accuracy' IN _pa) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_student_practice_analytics still counts excluded attempts';
  END IF;

  -- Positive control: the column default must leave existing rows countable.
  IF EXISTS (
    SELECT 1 FROM public.question_attempts
     WHERE excluded_from_accuracy IS DISTINCT FROM false
     LIMIT 1
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'question_attempts'
       AND column_name = 'excluded_from_accuracy'
       AND column_default ILIKE '%false%'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: excluded_from_accuracy default is not false';
  END IF;
END $prove$;

COMMIT;
