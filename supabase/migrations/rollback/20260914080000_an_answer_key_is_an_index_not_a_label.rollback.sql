-- Rollback for 20260914080000_an_answer_key_is_an_index_not_a_label.sql
--
-- Restores the loose constraint — the one that asserted only `correct IS NOT
-- NULL` for a choice question, and therefore accepted a key in any shape at all.
--
-- IT DOES NOT PUT THE LABELS BACK, AND THAT IS DELIBERATE.
--
-- The forward migration rewrote `correct` from the option's TEXT to the option's
-- POSITION. Reverting that rewrite is not possible without doing damage:
--
--   - Nothing records which rows were rewritten. Every choice question now
--     holds `{"indexes":[i]}`, including any written since by
--     `TestService.setQuestions`, which has never written anything else. A
--     blanket conversion back to labels would corrupt the correct rows in order
--     to restore the broken ones.
--   - The shape it would restore is one `rpc_test_submit` can never match
--     against what `QuestionRenderer` sends. Un-marking 576 questions is not a
--     safer state to return to; it is the defect.
--
-- So this rollback re-opens the door and leaves the room tidy. After it runs,
-- the old shape can be WRITTEN again — which is the only thing a caller could
-- need a rollback here for — while the rows that exist stay markable.
--
-- If the labels genuinely must come back for something, the conversion is
-- derivable in the same way the forward one was, and belongs in its own
-- migration where it can be reviewed:
--
--   UPDATE public.test_questions
--      SET correct = to_jsonb(options ->> (correct #>> '{indexes,0}')::int)
--    WHERE question_format IN ('mcq','multi');

BEGIN;

ALTER TABLE public.test_questions DROP CONSTRAINT IF EXISTS test_questions_shape_matches_format;
ALTER TABLE public.test_questions
  ADD CONSTRAINT test_questions_shape_matches_format
  CHECK (
    (question_format IN ('mcq', 'multi')
       AND options IS NOT NULL AND correct IS NOT NULL AND answer IS NULL)
    OR
    (question_format = 'numerical'
       AND correct IS NOT NULL AND answer IS NULL)
    OR
    (question_format IN ('short', 'long')
       AND answer IS NOT NULL AND correct IS NULL)
  );

COMMENT ON COLUMN public.test_questions.correct IS
  'The answer key. Shape is NOT enforced: a choice question may hold the option '
  'text, which rpc_test_submit can never match against what QuestionRenderer '
  'sends. See 20260914080000.';

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.test_questions'::regclass
                    AND conname  = 'test_questions_shape_matches_format') THEN
    RAISE EXCEPTION 'ABORT: the rollback left no shape constraint at all';
  END IF;

  -- Positive control: the loose constraint must genuinely be the loose one, or
  -- this rollback did nothing and a caller would find the old shape still
  -- refused.
  IF EXISTS (SELECT 1 FROM pg_constraint
              WHERE conrelid = 'public.test_questions'::regclass
                AND conname  = 'test_questions_shape_matches_format'
                AND pg_get_constraintdef(oid) LIKE '%indexes%') THEN
    RAISE EXCEPTION 'ABORT: the tightened constraint survived the rollback';
  END IF;

  -- These belong to other migrations and must not be collateral.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.test_questions'::regclass
                    AND conname  = 'test_questions_question_format_check') THEN
    RAISE EXCEPTION 'ABORT: the rollback removed test_questions_question_format_check';
  END IF;

  RAISE NOTICE 'the shape constraint is loose again; existing keys are left as positions.';
END $verify$;

COMMIT;
