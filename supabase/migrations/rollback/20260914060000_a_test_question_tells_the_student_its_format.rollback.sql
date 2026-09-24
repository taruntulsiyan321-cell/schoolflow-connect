-- ROLLBACK 20260914060000_a_test_question_tells_the_student_its_format — written 2026-09-22; the migration shipped
-- without one.
--
-- Puts back rpc_test_questions_for_attempt as 20260914050000 left it (without the question_format column its row
-- carried) and rpc_test_submit as 20260829140000 left it, both verbatim. The attempt function's row type changes back,
-- which CREATE OR REPLACE refuses (42P13), so it is dropped first — and a DROP loses grants, so EXECUTE for
-- authenticated and service_role is given back exactly as it stood before (the loss 20260914070000 had to repair).
--
-- THIS RESTORES WHAT 060000 FIXED: the attempt screen can no longer tell a student which kind of question it is
-- showing, and rpc_test_submit marks every answer by equality, as it did then. Roll back 20260914070000 and every
-- later test migration first, newest first.
--
-- NOT REVERSED: answers already submitted and marked under the new function. They are the students' records.
DROP FUNCTION IF EXISTS public.rpc_test_questions_for_attempt(uuid);

-- rpc_test_questions_for_attempt: verbatim from 20260914050000_test_question_formats_include_numerical.sql
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

  -- §10.24: prose cannot be auto-marked, so a paper containing it cannot be
  -- sat in the app. REFUSE rather than filter — a silently shorter paper is a
  -- wrong mark nobody can see. Numerical and multi ARE auto-marked and pass.
  SELECT count(*) INTO _written
    FROM public.test_questions q
   WHERE q.test_id = _test AND q.question_format IN ('short', 'long');
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

-- rpc_test_submit: verbatim from 20260829140000_chunk75b_test_rpcs.sql
CREATE OR REPLACE FUNCTION public.rpc_test_submit(_attempt_id uuid, _answers jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _att record;
  _score numeric := 0; _correct int := 0; _total int := 0;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _att FROM public.test_attempts WHERE id = _attempt_id;
  IF _att IS NULL THEN RAISE EXCEPTION 'no such attempt'; END IF;
  IF _att.user_id <> _uid THEN RAISE EXCEPTION 'Not your attempt'; END IF;
  IF _att.status = 'submitted' THEN RAISE EXCEPTION 'already submitted'; END IF;

  -- Land the answers as working state, then grade them in place.
  INSERT INTO public.test_answers (attempt_id, question_id, school_id, response)
  SELECT _attempt_id, (e->>'question_id')::uuid, _att.school_id, e->'response'
    FROM jsonb_array_elements(COALESCE(_answers, '[]'::jsonb)) e
   WHERE (e->>'question_id') IS NOT NULL
  ON CONFLICT (attempt_id, question_id) DO UPDATE SET response = EXCLUDED.response;

  UPDATE public.test_answers a
     SET is_correct    = (a.response IS NOT NULL AND a.response = q.correct),
         marks_awarded = CASE WHEN a.response IS NOT NULL AND a.response = q.correct
                              THEN q.marks ELSE 0 END
    FROM public.test_questions q
   WHERE q.id = a.question_id AND a.attempt_id = _attempt_id;

  SELECT COALESCE(sum(a.marks_awarded), 0),
         count(*) FILTER (WHERE a.is_correct)::int,
         (SELECT count(*)::int FROM public.test_questions q WHERE q.test_id = _att.test_id)
    INTO _score, _correct, _total
    FROM public.test_answers a WHERE a.attempt_id = _attempt_id;

  -- The wrong ones become the mistake book, WITH chapter_id (7.5 item 2).
  -- Skipped questions count as wrong: an unanswered question is not a
  -- correct one, and the student needs it back.
  INSERT INTO public.student_mistakes (
    user_id, student_id, school_id, question_id, source, source_id,
    subject, chapter, chapter_id, concept, question_text, options,
    student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at, status, assessment_type
  )
  SELECT _uid, _att.student_id, _att.school_id, q.id, 'test', _att.test_id,
         COALESCE(cs.name, 'General'), q.chapter, q.chapter_id, q.concept,
         q.question, q.options, a.response, q.correct, q.explanation,
         1, now(), 'open', 'test'
    FROM public.test_questions q
    LEFT JOIN public.test_answers a ON a.question_id = q.id AND a.attempt_id = _attempt_id
    LEFT JOIN public.tests t ON t.id = q.test_id
    LEFT JOIN public.section_subjects ss ON ss.id = t.section_subject_id
    LEFT JOIN public.curriculum_subjects cs ON cs.id = ss.curriculum_subject_id
   WHERE q.test_id = _att.test_id
     AND COALESCE(a.is_correct, false) = false
     -- NOT EXISTS, not ON CONFLICT. student_mistakes carries only a PRIMARY
     -- KEY on a generated uuid — there is no unique constraint on
     -- (user_id, question_id) — so ON CONFLICT DO NOTHING can never fire and
     -- a retake would insert the same mistake again, silently. Batch 1 hit
     -- this and guarded the same way.
     AND NOT EXISTS (
       SELECT 1 FROM public.student_mistakes sm
        WHERE sm.user_id = _uid AND sm.question_id = q.id
     );

  -- A question got wrong AGAIN is not a new mistake, it is the same one
  -- recurring: bump the counter and re-open it if it had been cleared.
  UPDATE public.student_mistakes sm
     SET times_wrong  = sm.times_wrong + 1,
         last_wrong_at = now(),
         status       = 'open',
         cleared_at   = NULL
    FROM public.test_questions q
    LEFT JOIN public.test_answers a2 ON a2.question_id = q.id AND a2.attempt_id = _attempt_id
   WHERE q.test_id = _att.test_id
     AND sm.question_id = q.id
     AND sm.user_id = _uid
     AND sm.last_wrong_at < now()
     AND COALESCE(a2.is_correct, false) = false;

  UPDATE public.test_attempts
     SET status = 'submitted', submitted_at = now(),
         score = _score, correct_count = _correct, total_count = _total
   WHERE id = _attempt_id;

  -- The durable outcome. test_marks is the authority (§10.22): one mark per
  -- student per test.
  INSERT INTO public.test_marks (school_id, test_id, student_id, mark)
  SELECT _att.school_id, _att.test_id, _att.student_id, _score
   WHERE _att.student_id IS NOT NULL
  ON CONFLICT (test_id, student_id) DO UPDATE SET mark = EXCLUDED.mark;

  _result := jsonb_build_object(
    'attempt_id', _attempt_id,
    'score', _score,
    'max_score', _att.max_score,
    'correct_count', _correct,
    'total_count', _total,
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
               'id', q.id, 'order_index', q.order_index, 'question', q.question,
               'options', q.options, 'correct', q.correct,
               'explanation', q.explanation,
               'response', a.response,
               'is_correct', COALESCE(a.is_correct, false)
             ) ORDER BY q.order_index)
        FROM public.test_questions q
        LEFT JOIN public.test_answers a ON a.question_id = q.id AND a.attempt_id = _attempt_id
       WHERE q.test_id = _att.test_id), '[]'::jsonb)
  );

  -- §10.8 transient rule, and 7.5 verification item 3. The per-question rows
  -- were working state for grading. The mark is written, the mistakes are
  -- captured, and the result has already been built into _result above — so
  -- nothing downstream needs these rows, and they go.
  --
  -- Ordering matters: this must come AFTER _result is assembled, or the
  -- student's own result screen would come back empty.
  DELETE FROM public.test_answers WHERE attempt_id = _attempt_id;

  BEGIN
    PERFORM public._bump_academic_activity(_uid, 0, 0, 0, GREATEST(COALESCE(_att.time_spent_sec, 0) / 60, 1));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_test_submit(%): activity bump failed: %', _attempt_id, SQLERRM;
  END;

  RETURN _result;
END;
$function$;


REVOKE ALL ON FUNCTION public.rpc_test_questions_for_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_questions_for_attempt(uuid) TO authenticated, service_role;

DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc p
              WHERE p.oid = 'public.rpc_test_questions_for_attempt(uuid)'::regprocedure
                AND pg_get_function_result(p.oid) ILIKE '%question_format%') THEN
    RAISE EXCEPTION 'rollback: rpc_test_questions_for_attempt still returns question_format';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.rpc_test_questions_for_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'rollback: the recreated attempt function lost its grant';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20260914060000_a_test_question_tells_the_student_its_format';
