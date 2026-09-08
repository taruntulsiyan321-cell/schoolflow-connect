-- ═══════════════════════════════════════════════════════════════════════════
-- A test question says what KIND it is, so `correct` can never mean two things
-- (KNOWN_ISSUES 16)
--
-- ── THE DECISION, AND WHAT DECIDED IT ────────────────────────────────────
--
-- Entry 16 offered three routes for pushing a question paper online and asked
-- for a choice. §10.24 makes it:
--
--   "**The app can only analyse what it holds as structured questions with
--    answers.**"
--
-- and its table gives full analysis and auto-grading to "MCQs in the app, with
-- answer key" alone; everything else is "Completion only". So the answer is the
-- entry's option (a) — **only MCQ sections are pushable online, written
-- sections are print-only** — which it called "cheapest, and honest".
--
-- ── SO WHY TOUCH THE SCHEMA AT ALL ───────────────────────────────────────
--
-- Because (a) on its own leaves the trap that entry 16 named. `test_questions`
-- has `correct jsonb` and NO format column, so the next person wiring the
-- hand-off finds a jsonb column that will happily hold a paragraph, and takes
-- route (c): the same column meaning "index of these options" or "a paragraph a
-- teacher marks by hand" depending on a format that is recorded nowhere. That
-- is the two-homes shape (G9) this codebase keeps finding, and it is cheapest
-- to prevent while there is no caller and nothing to migrate.
--
-- Measured before writing this: 576 rows, **0** with a NULL `options`, **0**
-- with a NULL `correct`, every `options` a jsonb array, and every `correct` a
-- jsonb STRING (never a number — it holds the answer text, not an index).
-- So all 576 are MCQ and the default below is right for every one of them.
--
-- ── THE ATTEMPT PATH REFUSES RATHER THAN TRUNCATES ───────────────────────
--
-- `rpc_test_questions_for_attempt` returns every question of a test and does
-- not look at format. A written question would arrive with `options` NULL and
-- render as an MCQ with no choices. Filtering it out silently would be worse:
-- the student would sit a shorter paper than the teacher set and nobody would
-- be told. It now RAISES, naming §10.24, so whoever builds the push-to-test
-- hand-off meets the decision immediately instead of shipping a paper that
-- quietly loses its written section.
--
-- Nothing can create a non-MCQ test question today — that is why this is safe
-- to make loud rather than lenient.
--
-- The per-question `marks numeric` already exists and needs nothing: it maps
-- cleanly whichever route a future hand-off takes. Only the answer did not.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.test_questions
  ADD COLUMN IF NOT EXISTS question_format text NOT NULL DEFAULT 'mcq',
  ADD COLUMN IF NOT EXISTS answer          text;

ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_question_format_check;
ALTER TABLE public.test_questions
  ADD CONSTRAINT test_questions_question_format_check
  CHECK (question_format IN ('mcq', 'short', 'long'));

-- The point of the whole migration: one shape or the other, never both, never
-- neither. `correct` may not hold a written answer, because `answer` exists.
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

COMMENT ON COLUMN public.test_questions.question_format IS
  'mcq | short | long. Only ''mcq'' is auto-markable and only ''mcq'' can be '
  'attempted online -- §10.24: "The app can only analyse what it holds as '
  'structured questions with answers." Written sections are print-only.';
COMMENT ON COLUMN public.test_questions.answer IS
  'The model answer for a short/long question, marked by a person. NEVER put it '
  'in `correct`: that column means "the correct option" and a column meaning two '
  'things depending on an unrecorded format is exactly what this pair prevents.';

-- ── the attempt path ──────────────────────────────────────────────────────
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

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only (rule 6). probe31 asserts the behaviour as the
-- student who owns the attempt (rule 7), including that an ordinary MCQ test
-- still serves — the positive control this migration could most easily break.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE _n int; _def text;
BEGIN
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema='public' AND table_name='test_questions'
     AND column_name IN ('question_format','answer');
  IF _n <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected question_format and answer, found % of them', _n;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.test_questions'::regclass
                    AND conname='test_questions_shape_matches_format') THEN
    RAISE EXCEPTION 'ABORT: the shape constraint is missing -- route (c) is possible again';
  END IF;

  -- Every existing row must satisfy it; the ADD would have failed otherwise,
  -- but a NOT VALID slip would not, so it is asserted rather than assumed.
  SELECT count(*) INTO _n FROM public.test_questions
   WHERE NOT (
     (question_format = 'mcq' AND options IS NOT NULL AND correct IS NOT NULL AND answer IS NULL)
     OR (question_format <> 'mcq' AND answer IS NOT NULL AND correct IS NULL)
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

  RAISE NOTICE 'test questions know their format; behaviour is asserted in probe31.';
END $verify$;
