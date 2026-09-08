-- ═══════════════════════════════════════════════════════════════════════════
-- Correcting 20260914040000: "auto-markable" is not the same as "MCQ"
--
-- ── WHAT THE FIRST VERSION GOT WRONG ─────────────────────────────────────
--
-- 20260914040000 allowed `question_format IN ('mcq','short','long')` and made
-- everything that is not `mcq` a written, hand-marked question. Two things were
-- measured immediately afterwards that it should have been measured before:
--
--   1. `TestService.setQuestions` already emits FOUR kinds —
--      `mapKindToDb` returns `'mcq' | 'multi' | 'numerical' | 'short'` — and a
--      NUMERICAL question is auto-markable: `rpc_test_submit` grades by
--      `a.response = q.correct`, plain jsonb equality, and `{value: 3.14}`
--      compares perfectly well. Calling it "written" would have been wrong.
--
--   2. probe7 built a `test_questions` fixture with no `options` and no
--      `correct`, which the new constraint refused. That fixture was creating a
--      row the grader can never mark — `NULL = anything` is NULL, so it could
--      never be correct — so the constraint was right and the FIXTURE was
--      wrong. It has been given a real MCQ shape; it asserts nothing about the
--      question's contents, only that deleting a test takes its questions.
--
-- ── THE RULE, STATED PROPERLY ────────────────────────────────────────────
--
-- §10.24: "The app can only analyse what it holds as structured questions with
-- answers." The line is not MCQ-versus-rest, it is **auto-markable versus
-- hand-marked**:
--
--   mcq, multi   the answer is which option(s)   -> `correct`, `options` needed
--   numerical    the answer is a value           -> `correct`, no options needed
--   short, long  the answer is prose a person reads -> `answer`, never `correct`
--
-- The two columns still cannot both be populated, which was the whole point:
-- `correct` may never hold prose, so it can never mean two things depending on
-- a format that is recorded nowhere (G9, entry 16's route (c)).
--
-- `rpc_test_questions_for_attempt` refuses a paper containing short/long only.
-- A numerical question is served and graded like any other.
--
-- ── A DEFECT FOUND WHILE MEASURING THIS, AND NOT FIXED HERE ──────────────
--
-- `TestService.setQuestions` sends a `kind` column that `test_questions` does
-- not have, behind an `as never` cast — the same shape as KNOWN_ISSUES 11's
-- `school_id`, in a different table, and it means PostgREST rejects the insert
-- with PGRST204 before the database sees it. It also writes `correct` as
-- `{indexes:[i]}` while all 576 existing rows hold a bare jsonb string, so the
-- two disagree about what `correct` looks like even where the insert works.
-- That is its own defect with its own verification, logged as KNOWN_ISSUES 28
-- rather than folded into a ruling about formats.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_question_format_check;
ALTER TABLE public.test_questions
  ADD CONSTRAINT test_questions_question_format_check
  CHECK (question_format IN ('mcq', 'multi', 'numerical', 'short', 'long'));

ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_shape_matches_format;
ALTER TABLE public.test_questions
  ADD CONSTRAINT test_questions_shape_matches_format
  CHECK (
    -- Auto-marked: the key lives in `correct`, and prose does not.
    (question_format IN ('mcq', 'multi')
       AND options IS NOT NULL AND correct IS NOT NULL AND answer IS NULL)
    OR
    (question_format = 'numerical'
       AND correct IS NOT NULL AND answer IS NULL)
    OR
    -- Hand-marked: the model answer lives in `answer`, and `correct` is empty
    -- so nothing can grade it by equality and call that marking.
    (question_format IN ('short', 'long')
       AND answer IS NOT NULL AND correct IS NULL)
  );

COMMENT ON COLUMN public.test_questions.question_format IS
  'mcq | multi | numerical | short | long. The first three are auto-marked by '
  'rpc_test_submit (jsonb equality on `correct`); short and long are prose a '
  'person reads and can only be marked by hand, so §10.24 keeps them off the '
  'online attempt path entirely. Matches TestService.mapKindToDb''s vocabulary.';

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

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only (rule 6). probe31 asserts the behaviour as the
-- student who owns the attempt (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE _n int; _def text; _con text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _con FROM pg_constraint
   WHERE conrelid='public.test_questions'::regclass
     AND conname='test_questions_shape_matches_format';
  IF _con IS NULL THEN
    RAISE EXCEPTION 'ABORT: the shape constraint is missing -- route (c) is possible again';
  END IF;
  IF _con !~ 'numerical' THEN
    RAISE EXCEPTION 'ABORT: numerical is not handled -- an auto-markable format would be refused';
  END IF;

  -- Every existing row must satisfy it.
  SELECT count(*) INTO _n FROM public.test_questions
   WHERE NOT (
     (question_format IN ('mcq','multi') AND options IS NOT NULL AND correct IS NOT NULL AND answer IS NULL)
     OR (question_format = 'numerical' AND correct IS NOT NULL AND answer IS NULL)
     OR (question_format IN ('short','long') AND answer IS NOT NULL AND correct IS NULL)
   );
  IF _n > 0 THEN
    RAISE EXCEPTION 'ABORT: % existing row(s) violate the shape constraint', _n;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.proname='rpc_test_questions_for_attempt';
  IF _def !~ '10\.24' THEN
    RAISE EXCEPTION 'ABORT: the attempt path no longer refuses written questions';
  END IF;
  IF _def ~ 'q\.correct' OR _def ~ 'q\.answer' THEN
    RAISE EXCEPTION 'ABORT: the attempt path is returning the answer key to the student';
  END IF;
  IF _def !~ 'numerical' AND _def ~ '<> ''mcq''' THEN
    RAISE EXCEPTION 'ABORT: the attempt path still refuses everything that is not mcq';
  END IF;

  RAISE NOTICE 'auto-markable and hand-marked are distinguished; probe31 asserts the behaviour.';
END $verify$;
