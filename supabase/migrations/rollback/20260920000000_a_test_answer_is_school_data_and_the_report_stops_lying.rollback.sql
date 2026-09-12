-- Rollback for 20260920000000.
--
-- Restores the deployed body verbatim — the one from 20260916140000 — which
-- means RESTORING THE PURGE:
--
--     DELETE FROM public.test_answers WHERE attempt_id = _attempt_id;
--
-- With that statement back, `rpc_test_student_report` reports every question of
-- the paper as wrong with the student's own answer shown blank, the teacher's
-- weakest-topics ranking reads 100% wrong on every topic, the question review
-- on the result screen says the answers were never recorded, and
-- `average_seconds_per_question` is NULL again. It also restores the ambiguous
-- five-argument activity bump (silently swallowed), drops `time_spent_sec` back
-- to NULL, and stops stamping `test_marks.uploaded_at`.
--
-- Only run this if the durable-answers ruling is reversed.

CREATE OR REPLACE FUNCTION public.rpc_test_submit(_attempt_id uuid, _answers jsonb DEFAULT NULL::jsonb)
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
     -- a retake would insert the same mistake again, silently.
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
               -- Without this the REVIEW screen draws no control either, and a
               -- student looking at their own submitted paper sees their
               -- answers vanish. KNOWN_ISSUES 28.
               'question_format', q.question_format,
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
