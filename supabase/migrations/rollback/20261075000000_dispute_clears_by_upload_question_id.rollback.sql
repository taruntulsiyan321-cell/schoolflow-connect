-- Rollback: 20261075000000_dispute_clears_by_upload_question_id
-- Restores the text-only clear arm from 20261065000000.

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

REVOKE ALL ON FUNCTION public.rpc_dispute_ai_upload_answer(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_dispute_ai_upload_answer(uuid) TO authenticated;
