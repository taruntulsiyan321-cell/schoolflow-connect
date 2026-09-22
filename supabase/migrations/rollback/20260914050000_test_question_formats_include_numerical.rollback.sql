-- ROLLBACK 20260914050000_test_question_formats_include_numerical — written 2026-09-22; the migration shipped without one.
--
-- Narrows test_questions back to the formats 20260914040000 allowed (mcq, short, long) with its shape rule, and puts
-- back rpc_test_questions_for_attempt as 040000 left it, verbatim. Roll back 20260914060000 first.
--
-- REFUSES rather than half-applies when a question already uses 'multi' or 'numerical': the old constraint forbids
-- them, and deleting a teacher's questions to make a rollback fit is not a rollback.
DO $precheck$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.test_questions WHERE question_format IN ('multi', 'numerical');
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback refused: % test question(s) use multi or numerical, which the 040000 constraint forbids', _n;
  END IF;
END
$precheck$;

ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_question_format_check;
ALTER TABLE public.test_questions
  ADD CONSTRAINT test_questions_question_format_check
  CHECK (question_format IN ('mcq', 'short', 'long'));

ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_shape_matches_format;
ALTER TABLE public.test_questions
  ADD CONSTRAINT test_questions_shape_matches_format
  CHECK (
    (question_format = 'mcq'
       AND options IS NOT NULL AND correct IS NOT NULL AND answer IS NULL)
    OR
    (question_format <> 'mcq'
       AND answer IS NOT NULL AND correct IS NULL)
  );

-- rpc_test_questions_for_attempt: verbatim from 20260914040000_test_questions_know_their_format.sql
CREATE OR REPLACE FUNCTION public.rpc_test_questions_for_attempt(_attempt_id uuid)
RETURNS TABLE(id uuid, order_index integer, question text, options jsonb, marks numeric, chapter_id uuid, chapter text, concept text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _test uuid; _owner uuid; _written int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT a.test_id, a.user_id INTO _test, _owner
    FROM public.test_attempts a WHERE a.id = _attempt_id;

  IF _test IS NULL THEN RAISE EXCEPTION 'no such attempt'; END IF;

  -- SECURITY DEFINER, so this is the only gate there is (G13).
  IF _owner <> _uid THEN RAISE EXCEPTION 'Not your attempt'; END IF;

  -- §10.24: only MCQs can be attempted in the app. REFUSE rather than filter —
  -- a silently shorter paper is a wrong mark nobody can see. KNOWN_ISSUES 16.
  SELECT count(*) INTO _written
    FROM public.test_questions q
   WHERE q.test_id = _test AND q.question_format <> 'mcq';
  IF _written > 0 THEN
    RAISE EXCEPTION
      'this paper has % written question(s) and cannot be attempted online (§10.24: the app only auto-marks structured questions with answers)', _written
      USING ERRCODE = '22023';
  END IF;

  -- `correct`, `answer` and `explanation` are deliberately absent from the
  -- RETURNS list. A student receives the paper, not the answer key. The
  -- explanation follows at result time, from rpc_test_submit's return value.
  RETURN QUERY
    SELECT q.id, q.order_index, q.question, q.options,
           q.marks, q.chapter_id, q.chapter, q.concept
      FROM public.test_questions q
     WHERE q.test_id = _test
     ORDER BY q.order_index;
END;
$function$;


DO $check$
BEGIN
  IF (SELECT pg_get_constraintdef(oid) FROM pg_constraint
       WHERE conname = 'test_questions_question_format_check') ILIKE '%numerical%' THEN
    RAISE EXCEPTION 'rollback: the format constraint still admits numerical';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20260914050000_test_question_formats_include_numerical';
