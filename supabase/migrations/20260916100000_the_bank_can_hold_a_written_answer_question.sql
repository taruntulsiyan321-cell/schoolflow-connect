-- ═══════════════════════════════════════════════════════════════════════════
-- The question bank can hold a written-answer question (§5, §4.2a)
--
-- `question_bank.question_format` has admitted 'short' and 'long' since it was
-- created. `question_bank.options` and `question_bank.correct_index` have been
-- NOT NULL for just as long. The vocabulary anticipates a written answer and
-- the columns forbid one.
--
-- Measured as the caller, 2026-09-09, while building §5's write-back:
--
--   INSERT ... question_format='short', options NULL, correct_index NULL
--   -> null value in column "options" of relation "question_bank"
--      violates not-null constraint
--
-- So a generated short or long question could go onto a teacher's paper and
-- never into the bank, and the write-back had to report "the question bank
-- stores multiple-choice questions only" as a permanent fact rather than a
-- temporary one.
--
-- ── THE SHAPE RULE MOVES, IT DOES NOT DISAPPEAR ─────────────────────────
--
-- Dropping two NOT NULLs on a 21,696-row shared table would let an ANSWERLESS
-- question in — a question with no options, no key and no answer text, which
-- can never be marked and is worse than no question at all.
--
-- So the rule moves from "always have options and a key" to "have EITHER
-- options and a key, OR answer text". That is exactly the constraint
-- `question_paper_questions` already carries as `qpq_answer_shape`, and it is
-- deliberately the same shape here: a question that is storable on a paper
-- should be storable in the bank, and the two tables disagreeing about what a
-- complete question is would be the G9 two-homes defect in constraint form.
--
-- ── AND `answer` HAS TO EXIST TO BE CHECKED ─────────────────────────────
--
-- `question_bank` has no `answer` column at all — measured. `explanation` is
-- not it: an explanation says WHY, and §4.2a's "the correct answer must be
-- generated with the question" needs the WHAT. Added here.
--
-- ── WHAT THIS DOES NOT DO ───────────────────────────────────────────────
--
-- Not one existing row changes. All 21,696 carry options and a correct_index
-- and satisfy the new CHECK on the first branch, which is asserted below
-- before this commits rather than assumed.
--
-- Rollback: supabase/migrations/rollback/
--           20260916100000_the_bank_can_hold_a_written_answer_question.rollback.sql
-- Assertion: verification/caller-privileges/probe40.sql (claim 10 flips)
-- ═══════════════════════════════════════════════════════════════════════════

-- The WHAT, beside the existing WHY.
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS answer text;

COMMENT ON COLUMN public.question_bank.answer IS
  'The expected answer for a written-answer question (short / long). NULL for '
  'multiple choice, where the answer is correct_index into options. §4.2a: the '
  'correct answer is generated with the question, in every format.';

-- Two NOT NULLs become one either/or.
ALTER TABLE public.question_bank ALTER COLUMN options DROP NOT NULL;
ALTER TABLE public.question_bank ALTER COLUMN correct_index DROP NOT NULL;

ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_answer_shape;

ALTER TABLE public.question_bank
  ADD CONSTRAINT question_bank_answer_shape CHECK (
    (options IS NOT NULL AND correct_index IS NOT NULL)
    OR (answer IS NOT NULL AND length(btrim(answer)) > 0)
  );

COMMENT ON CONSTRAINT question_bank_answer_shape ON public.question_bank IS
  'Either options + correct_index (multiple choice), or non-empty answer text '
  '(short / long). Deliberately the same rule as qpq_answer_shape on '
  'question_paper_questions: a question storable on a paper is storable in the '
  'bank, and two tables disagreeing about what a complete question is would be '
  'the same fact in two homes.';

-- ── Proof, before this commits ───────────────────────────────────────────
DO $verify$
DECLARE _n int; _bad int;
BEGIN
  -- The column exists and the two NOT NULLs are gone.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='question_bank' AND column_name='answer'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: question_bank.answer was not added';
  END IF;

  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='question_bank'
     AND column_name IN ('options','correct_index') AND is_nullable = 'NO';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % of the two columns are still NOT NULL', _n;
  END IF;

  -- NOT ONE EXISTING ROW MAY BREAK. The constraint is already enforced by the
  -- ADD CONSTRAINT above, so this is belt and braces — but a silent behaviour
  -- change on 21,696 shared rows is exactly the thing worth asserting twice.
  SELECT count(*) INTO _bad
    FROM public.question_bank
   WHERE NOT ((options IS NOT NULL AND correct_index IS NOT NULL)
              OR (answer IS NOT NULL AND length(btrim(answer)) > 0));
  IF _bad <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % existing row(s) fail the new shape rule', _bad;
  END IF;

  -- ...and the reason there are none is that every row is multiple choice, not
  -- that the check is vacuous. A constraint nothing exercises is not a check.
  SELECT count(*) INTO _n
    FROM public.question_bank
   WHERE options IS NOT NULL AND correct_index IS NOT NULL;
  IF _n = 0 THEN
    RAISE EXCEPTION
      'ROLLED BACK: no row satisfies the multiple-choice branch — the check is '
      'passing on an empty set and proves nothing';
  END IF;

  -- The constraint must actually REFUSE an answerless question. Tested by
  -- trying one inside a savepoint, because a CHECK nobody has seen fire is a
  -- CHECK nobody knows works (G11).
  BEGIN
    INSERT INTO public.question_bank
      (subject, class_level, question, options, correct_index, answer, question_format)
    VALUES ('__verify__', 10, '__answerless__', NULL, NULL, NULL, 'short');
    RAISE EXCEPTION 'ROLLED BACK: an ANSWERLESS question was accepted';
  EXCEPTION
    WHEN check_violation THEN
      NULL;  -- correct: the shape rule refused it
    WHEN OTHERS THEN
      IF SQLERRM LIKE 'ROLLED BACK:%' THEN RAISE; END IF;
      RAISE EXCEPTION 'ROLLED BACK: the answerless insert failed for the WRONG reason: %', SQLERRM;
  END;

  RAISE NOTICE
    'question_bank now holds written answers: % multiple-choice rows unchanged, answerless still refused.', _n;
END $verify$;
