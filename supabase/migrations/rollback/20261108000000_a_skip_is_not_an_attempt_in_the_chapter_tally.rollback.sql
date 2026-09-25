-- ROLLBACK of 20261108000000_a_skip_is_not_an_attempt_in_the_chapter_tally:
-- the tally writer and the dispute as they stood, and every recounted row back
-- to what it held.

BEGIN;

CREATE OR REPLACE FUNCTION public._write_chapter_tally(_session_id uuid)
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _n integer := 0;
BEGIN
  -- One row per DISTINCT chapter in the session. chapter_id from, in order:
  --   1. question_bank.chapter_id
  --   2. generated_question.chapter_id when it EXISTS in public.chapters
  --   3. student_upload_questions.chapter_id
  --   4. student_capture_questions.chapter_id
  -- Untagged private rows (null chapter_id) still do not tally.
  INSERT INTO public.chapter_tally (user_id, student_id, school_id, chapter_id, session_id, attempted, correct)
  SELECT ps.user_id, ps.student_id, ps.school_id, resolved.chapter_id, ps.id,
         count(*)::int,
         count(*) FILTER (WHERE qa.is_correct IS TRUE)::int
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    LEFT JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    LEFT JOIN public.student_upload_questions suq
      ON (qa.generated_question->>'upload_question_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND suq.id = (qa.generated_question->>'upload_question_id')::uuid
    LEFT JOIN public.student_capture_questions scq
      ON (qa.generated_question->>'capture_question_id') ~
           '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
     AND scq.id = (qa.generated_question->>'capture_question_id')::uuid
    CROSS JOIN LATERAL (
      SELECT COALESCE(
        qb.chapter_id,
        CASE
          WHEN (qa.generated_question->>'chapter_id') ~
                 '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
           AND EXISTS (
             SELECT 1 FROM public.chapters c
              WHERE c.id = (qa.generated_question->>'chapter_id')::uuid
           )
          THEN (qa.generated_question->>'chapter_id')::uuid
          ELSE NULL
        END,
        suq.chapter_id,
        scq.chapter_id
      ) AS chapter_id
    ) resolved
   WHERE qa.session_id = _session_id
     AND resolved.chapter_id IS NOT NULL
   GROUP BY ps.user_id, ps.student_id, ps.school_id, resolved.chapter_id, ps.id
  ON CONFLICT (session_id, chapter_id) DO UPDATE
    SET attempted = EXCLUDED.attempted,
        correct   = EXCLUDED.correct;

  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_dispute_ai_upload_answer(_upload_question_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
$function$;

UPDATE public.chapter_tally ct
   SET attempted = r.attempted, correct = r.correct
  FROM public.chapter_tally_recount_20261108 r
 WHERE r.tally_id = ct.id;

DROP TABLE public.chapter_tally_recount_20261108;

DELETE FROM public.schema_migrations WHERE version = '20261108000000_a_skip_is_not_an_attempt_in_the_chapter_tally';

COMMIT;
