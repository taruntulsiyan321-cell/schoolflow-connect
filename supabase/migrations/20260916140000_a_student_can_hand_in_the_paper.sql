-- ════════════════════════════════════════════════════════════════════════════
-- A student can hand in the paper (G13, KNOWN_ISSUES 23)
--
-- NO STUDENT COULD SUBMIT A CLASS TEST. Found 2026-09-09 by tier1-panels
-- driving the real browser end to end for the first time: the attempt screen
-- rendered the question, accepted the answer, and then sat on
-- /student/test/<id>/attempt for ever. The attempt row stayed in_progress.
--
-- ── WHY ────────────────────────────────────────────────────────────────────
--
--     rpc_test_submit(_attempt_id uuid, _answers jsonb)   -- pronargdefaults = 0
--
-- "_answers" had NO DEFAULT, so it was required. But nothing passes it:
-- TestAttempt.tsx saves each answer as it is chosen and then calls
-- TestService.submitAttempt(ctx, attemptId) with no answers at all, and the
-- service omits the parameter entirely rather than sending null --
--
--     ...(answers != null ? { _answers: answers } : {})
--
-- which is the documented repo pattern for an optional RPC argument (see the
-- supabase-generated-types-lose-nullability note). PostgREST then looked for a
-- one-argument rpc_test_submit, found none, and returned PGRST202. The page
-- caught it, raised a toast, and stayed put.
--
-- The generated types said so all along -- Args: { _answers: Json;
-- _attempt_id: string }, both required -- but testService casts the payload
-- "as never", so the compiler never got to object. That cast is why a
-- typecheck-clean tree shipped a dead submit button.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- "_answers" gets DEFAULT NULL. The body already expected it to be absent: it
-- has always read jsonb_array_elements(COALESCE(_answers, '[]'::jsonb)), so
-- the incremental-save path this page uses was the INTENDED one and only the
-- signature disagreed. Nothing else changes -- this migration re-states the
-- body verbatim from what was deployed, with the default added.
--
-- Grading does not depend on "_answers" either: the UPDATE that marks
-- is_correct reads test_answers, which the per-question saves already filled.
--
-- Rollback: supabase/migrations/rollback/
--           20260916140000_a_student_can_hand_in_the_paper.rollback.sql
-- Assertion: e2e-evidence/tier1-panels.spec.ts, the student attempt test --
--            which is what caught this, and now walks answer -> submit ->
--            result in the browser.
-- ════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.rpc_test_submit(_attempt_id uuid, _answers jsonb DEFAULT NULL)
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


REVOKE ALL ON FUNCTION public.rpc_test_submit(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_submit(uuid, jsonb) TO authenticated;

DO $verify$
DECLARE _ndef int; _nargs int;
BEGIN
  SELECT p.pronargdefaults, p.pronargs INTO _ndef, _nargs
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_test_submit';

  IF _nargs <> 2 THEN
    RAISE EXCEPTION 'verify: rpc_test_submit should take 2 arguments, takes %', _nargs;
  END IF;

  -- The whole point. Without a default, PostgREST cannot resolve the
  -- one-argument call the attempt screen makes.
  IF _ndef <> 1 THEN
    RAISE EXCEPTION 'verify: _answers still has no DEFAULT (pronargdefaults = %)', _ndef;
  END IF;

  -- The positive control: the body must still tolerate a null payload, or the
  -- default would resolve the call and then fail inside.
  IF (SELECT pg_get_functiondef(p.oid) FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'rpc_test_submit')
     NOT LIKE '%COALESCE(_answers%' THEN
    RAISE EXCEPTION 'verify: the body no longer guards a null _answers';
  END IF;

  RAISE NOTICE 'verify OK: _answers now defaults, and the body still COALESCEs it';
END
$verify$;
