-- ═══════════════════════════════════════════════════════════════════════════
-- A student receives the question's FORMAT, so the paper renders at all
-- (KNOWN_ISSUES 28, second half)
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- `QuestionRenderer` — the only component that draws a test question — branches
-- entirely on `q.kind`:
--
--     {(q.kind === "mcq" || q.kind === "multi") && ...options...}
--     {q.kind === "numerical" && <Input type="number" .../>}
--     {q.kind === "short" && <Textarea .../>}
--
-- and `rpc_test_questions_for_attempt` returns `id, order_index, question,
-- options, marks, chapter_id, chapter, concept`. **No format.** So `q.kind` is
-- `undefined` for every question a student is ever served, no branch matches,
-- and the paper renders as a list of stems with **no way to answer any of
-- them**.
--
-- The teacher half of the same defect is in `TestService.setQuestions`, which
-- sent a `kind` column `test_questions` does not have — PostgREST rejects the
-- whole insert with PGRST204, so no manually-built test ever saved its
-- questions in the first place. Both halves had to be wrong for neither to be
-- noticed: nothing could be saved, so nothing could be rendered.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- `question_format` (20260914050000) already carries exactly the vocabulary the
-- renderer wants — `mcq | multi | numerical | short | long` — so both paths now
-- speak it. This migration adds it to the two RPCs a student reads through.
--
-- WHAT IS STILL WITHHELD. `correct`, `answer` and `explanation` stay out of the
-- attempt path: a student receives the paper, not the answer key (G14). The
-- format is not part of the key — it is how the question is drawn — and
-- `options` was already returned, which gives away strictly more.
--
-- `rpc_test_submit`'s RESULT payload gains `question_format` too, for the same
-- reason: the review screen renders through the same component, and without the
-- format a student reviewing their own submitted paper sees their answers
-- vanish. It does NOT gain `answer`; a written question cannot be attempted
-- online at all (§10.24), so there is no result screen that needs it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- DROP first: adding a column to a RETURNS TABLE changes the function's row
-- type, and `CREATE OR REPLACE` refuses that with 42P13. The DROP and the
-- CREATE are in one transaction, so there is no window where the attempt path
-- does not exist.
DROP FUNCTION IF EXISTS public.rpc_test_questions_for_attempt(uuid);

CREATE OR REPLACE FUNCTION public.rpc_test_questions_for_attempt(_attempt_id uuid)
RETURNS TABLE(
  id uuid, order_index integer, question text, options jsonb,
  question_format text,
  marks numeric, chapter_id uuid, chapter text, concept text
)
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
  -- `question_format` IS present: it is how the question is drawn, not part of
  -- the key, and without it QuestionRenderer draws no input control at all.
  RETURN QUERY
    SELECT q.id, q.order_index, q.question, q.options,
           q.question_format,
           q.marks, q.chapter_id, q.chapter, q.concept
      FROM public.test_questions q
     WHERE q.test_id = _test
     ORDER BY q.order_index;
END;
$function$;

-- ── the result payload, so the review screen can draw too ─────────────────
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

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only (rule 6). probe32 asserts, as the student who owns
-- the attempt, that the format arrives AND that the key still does not.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE _a text; _s text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _a FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_test_questions_for_attempt';
  SELECT pg_get_functiondef(p.oid) INTO _s FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_test_submit';

  IF _a !~ 'question_format' THEN
    RAISE EXCEPTION 'ABORT: the attempt path still does not tell the student the format';
  END IF;
  IF _s !~ 'question_format' THEN
    RAISE EXCEPTION 'ABORT: the result payload still does not carry the format';
  END IF;

  -- The key must STAY out of the attempt path. This is the assertion that
  -- would catch someone "fixing" the renderer by returning everything.
  IF _a ~ 'q\.correct' OR _a ~ 'q\.answer' THEN
    RAISE EXCEPTION 'ABORT: the attempt path is returning the answer key to the student';
  END IF;
  IF _a !~ '10\.24' THEN
    RAISE EXCEPTION 'ABORT: the attempt path no longer refuses written questions';
  END IF;
  -- ...and the result payload must not leak the model answer either.
  IF _s ~ '''answer''' THEN
    RAISE EXCEPTION 'ABORT: rpc_test_submit is returning `answer`';
  END IF;

  RAISE NOTICE 'the format reaches the student; the key does not. probe32 asserts it as the caller.';
END $verify$;
