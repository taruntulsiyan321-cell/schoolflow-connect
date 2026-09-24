-- ===========================================================================
-- DISPUTE CLEARS BY upload_question_id
--
-- Binding: docs/custom-practice-upload-spec.md §6.1 / §12.6
--
-- Measured defect (2026-09-24, §12.6 live as exam_cuet):
--   rpc_dispute_ai_upload_answer set excluded_from_accuracy correctly, but
--   left student_mistakes.status = 'open'. The clear arm matched only on
--   question_text (+ source='upload'|legacy practice), while 700 writes
--   upload_question_id as the authority for upload originals. Text can
--   diverge from the snapshot that rpc_record_concept_mistake stored, so
--   ROW_COUNT stayed 0.
--
-- Fix: clear open mistakes WHERE upload_question_id = the disputed id
-- (owner already fenced). Keep a legacy text fallback for pre-700 rows
-- that have upload_question_id NULL.
--
-- ROLLBACK: rollback/20261075000000_dispute_clears_by_upload_question_id.rollback.sql
-- ===========================================================================

BEGIN;

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

  -- Clear open mistakes for this upload original (§6.1 / §9.1).
  -- Primary: upload_question_id (700). Legacy: text match with no bank id.
  UPDATE public.student_mistakes sm
     SET status = 'cleared',
         cleared_at = now()
   WHERE sm.user_id = _uid
     AND sm.status = 'open'
     AND (
       sm.upload_question_id = _upload_question_id
       OR (
         sm.upload_question_id IS NULL
         AND sm.question_id IS NULL
         AND sm.question_text = _uq.question_text
         AND (
           sm.source = 'upload'
           OR sm.source = 'practice'
         )
       )
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
       qa.generated_question->>'upload_question_id' = _upload_question_id::text
       OR qa.generated_question->>'question' = _uq.question_text
       OR qa.generated_question->>'text' = _uq.question_text
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
  'Spec §6.1: owner disputes an AI upload answer key — clears open mistakes by upload_question_id and excludes attempts from practice accuracy.';

REVOKE ALL ON FUNCTION public.rpc_dispute_ai_upload_answer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_dispute_ai_upload_answer(uuid) TO authenticated;

DO $prove$
DECLARE
  _rpc text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _rpc
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_dispute_ai_upload_answer';
  IF position('owner_id = _uid' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute RPC is not owner-scoped';
  END IF;
  IF position('sm.upload_question_id = _upload_question_id' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute does not clear by upload_question_id';
  END IF;
  IF position('status = ''cleared''' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute does not set status cleared';
  END IF;
  IF position('excluded_from_accuracy' IN _rpc) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: dispute does not set excluded_from_accuracy';
  END IF;
END
$prove$;

COMMIT;
