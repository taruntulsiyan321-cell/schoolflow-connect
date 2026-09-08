-- Rollback for 20260914110000_an_answer_key_must_address_a_real_option.sql
--
-- Drops the range trigger. After this, `{"indexes":[7]}` on a two-option
-- question is accepted again, so is `{"indexes":[]}`, and so is a numerical key
-- holding the STRING "4" — all three unmarkable, none of them visible to
-- `test_questions_shape_matches_format`, which pins the shape and cannot count
-- an array.
--
-- No data is changed. Every existing row satisfies the rule (measured: 0
-- empty keys, 0 out-of-range indexes, 0 non-numeric numerical keys), so
-- dropping the trigger leaves the table valid — it only stops the NEXT bad
-- write being refused.

BEGIN;

DROP TRIGGER IF EXISTS trg_test_question_key_addresses_an_option ON public.test_questions;
DROP FUNCTION IF EXISTS public.tg_test_question_key_addresses_an_option();

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_trigger
              WHERE tgrelid = 'public.test_questions'::regclass
                AND tgname  = 'trg_test_question_key_addresses_an_option'
                AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'ABORT: the trigger survived the rollback';
  END IF;

  -- Positive control: the shape constraint belongs to 20260914080000 and must
  -- NOT be collateral. Without it a bare label key becomes writable again,
  -- which is a strictly worse state than the one this rollback intends.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.test_questions'::regclass
                    AND conname  = 'test_questions_shape_matches_format'
                    AND convalidated) THEN
    RAISE EXCEPTION 'ABORT: the rollback removed test_questions_shape_matches_format';
  END IF;

  RAISE NOTICE 'range trigger dropped; an out-of-range index is writable again.';
END $verify$;

COMMIT;
