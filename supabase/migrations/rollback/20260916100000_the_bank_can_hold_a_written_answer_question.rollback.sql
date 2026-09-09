-- Rollback for 20260916100000_the_bank_can_hold_a_written_answer_question
--
-- Puts the two NOT NULLs back and drops the either/or shape rule, so the bank
-- holds multiple-choice questions only again.
--
-- THIS CAN FAIL, AND IT SHOULD. If any written-answer question was stored
-- after the forward migration, restoring NOT NULL on `options` would have to
-- destroy it. The block below REFUSES rather than deleting anyone's questions:
-- rolling back a schema widening is not permission to throw away the rows it
-- allowed in. Move or delete them deliberately first, then run this.
--
-- `answer` is deliberately NOT dropped. Dropping a column destroys its data
-- irreversibly, and keeping an unused nullable text column costs nothing.

DO $guard$
DECLARE _written int;
BEGIN
  SELECT count(*) INTO _written
    FROM public.question_bank
   WHERE options IS NULL OR correct_index IS NULL;
  IF _written > 0 THEN
    RAISE EXCEPTION
      'REFUSING TO ROLL BACK: % written-answer question(s) exist and restoring '
      'NOT NULL would require destroying them. Deal with those rows first.',
      _written;
  END IF;
END $guard$;

ALTER TABLE public.question_bank
  DROP CONSTRAINT IF EXISTS question_bank_answer_shape;

ALTER TABLE public.question_bank ALTER COLUMN options SET NOT NULL;
ALTER TABLE public.question_bank ALTER COLUMN correct_index SET NOT NULL;

DO $verify$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM information_schema.columns
   WHERE table_schema='public' AND table_name='question_bank'
     AND column_name IN ('options','correct_index') AND is_nullable = 'NO';
  IF _n <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: only % of 2 columns are NOT NULL again', _n;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.question_bank'::regclass
       AND conname = 'question_bank_answer_shape'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the shape constraint is still present';
  END IF;

  RAISE NOTICE 'question_bank is multiple-choice-only again; the answer column is kept and unused.';
END $verify$;
