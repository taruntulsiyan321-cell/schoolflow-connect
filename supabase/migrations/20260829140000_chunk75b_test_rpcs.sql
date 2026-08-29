-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5b — the RPCs, and a hole 7.5a opened
--
-- ── First, the hole ───────────────────────────────────────────────────────
--
-- 7.5a gave test_questions this read policy:
--
--     CREATE POLICY test_questions_read ON public.test_questions
--       FOR SELECT TO authenticated
--       USING (school_id IN (SELECT public.my_accessible_school_ids()));
--
-- test_questions.correct holds the answer. That policy lets any authenticated
-- user in the institution SELECT it — including the student who is about to
-- sit the test. Open devtools, read the answers, take the test.
--
-- This is the same shape as the Battleground correct_index bug: the answer
-- shipped to the client before the answer was given. It was written into 7.5a
-- an hour ago with a comment promising a definer would withhold it, which is
-- not a fence — the comment does not run.
--
-- Closed here: direct SELECT on test_questions is narrowed to staff, and the
-- student path goes through rpc_test_questions_for_attempt, which returns
-- every column EXCEPT correct.
--
-- ── The three RPCs ────────────────────────────────────────────────────────
--
--   rpc_test_questions_for_attempt  the paper, without the answers
--   rpc_test_start                  one attempt per student per test
--   rpc_test_submit                 grade -> mark -> mistakes -> PURGE
--
-- rpc_test_submit is where §10.8's transient rule lands: it grades from
-- test_answers, writes the durable mark into test_marks, sends the WRONG
-- answers to student_mistakes with chapter_id, and then deletes the
-- per-question rows. What survives is the mark and the mistakes.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Close the answer leak ──────────────────────────────────────────────
DROP POLICY IF EXISTS test_questions_read ON public.test_questions;

CREATE POLICY test_questions_staff_read ON public.test_questions
  FOR SELECT TO authenticated
  USING (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR EXISTS (SELECT 1 FROM public.tests t
                WHERE t.id = test_id AND t.created_by = (SELECT auth.uid()))
  );

-- ── 2. The paper, without the answers ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_test_questions_for_attempt(_attempt_id uuid)
RETURNS TABLE (
  id uuid, order_index integer, question text, options jsonb,
  marks numeric, chapter_id uuid, chapter text, concept text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _test uuid; _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT a.test_id, a.user_id INTO _test, _owner
    FROM public.test_attempts a WHERE a.id = _attempt_id;

  IF _test IS NULL THEN RAISE EXCEPTION 'no such attempt'; END IF;

  -- SECURITY DEFINER, so this is the only gate there is (G13).
  IF _owner <> _uid THEN RAISE EXCEPTION 'Not your attempt'; END IF;

  -- `correct` and `explanation` are deliberately absent from the RETURNS
  -- list. A student receives the paper, not the answer key. The explanation
  -- follows at result time, from rpc_test_submit's return value.
  RETURN QUERY
    SELECT q.id, q.order_index, q.question, q.options,
           q.marks, q.chapter_id, q.chapter, q.concept
      FROM public.test_questions q
     WHERE q.test_id = _test
     ORDER BY q.order_index;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_test_questions_for_attempt(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_questions_for_attempt(uuid) TO authenticated;

-- ── 3. Start an attempt ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_test_start(_test_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid; _school uuid; _status text; _max numeric; _n int;
  _attempt uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT t.status, t.school_id, t.max_mark INTO _status, _school, _max
    FROM public.tests t WHERE t.id = _test_id AND t.deleted_at IS NULL;

  IF _school IS NULL THEN RAISE EXCEPTION 'no such test'; END IF;

  -- A student may only sit a PUBLISHED test. 'draft' is not yet a test and
  -- 'submitted' means the marks are already in.
  IF _status <> 'published' THEN
    RAISE EXCEPTION 'test is not open for attempts (status: %)', _status;
  END IF;

  -- The definer re-states the institution guarantee its own RLS would have
  -- enforced, because a definer body bypasses it.
  IF _school NOT IN (SELECT public.my_accessible_school_ids()) THEN
    RAISE EXCEPTION 'test is not in your institution';
  END IF;

  SELECT s.id INTO _sid FROM public.students s
   WHERE s.user_id = _uid AND s.school_id = _school AND s.deleted_at IS NULL
   ORDER BY s.created_at DESC LIMIT 1;

  SELECT count(*)::int INTO _n FROM public.test_questions q WHERE q.test_id = _test_id;
  IF _n = 0 THEN RAISE EXCEPTION 'test has no questions'; END IF;

  -- Idempotent: re-entering a test you already started resumes it rather than
  -- starting a second attempt, which is what the UNIQUE(test_id, user_id) on
  -- test_attempts is for.
  INSERT INTO public.test_attempts (test_id, student_id, user_id, school_id, max_score, total_count)
  VALUES (_test_id, _sid, _uid, _school, COALESCE(_max, _n), _n)
  ON CONFLICT (test_id, user_id) DO UPDATE SET test_id = EXCLUDED.test_id
  RETURNING id INTO _attempt;

  RETURN _attempt;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_test_start(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_start(uuid) TO authenticated;

-- ── 4. Submit: grade, mark, mistakes, purge ───────────────────────────────
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

REVOKE ALL ON FUNCTION public.rpc_test_submit(uuid, jsonb) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_test_submit(uuid, jsonb) TO authenticated;

COMMIT;
