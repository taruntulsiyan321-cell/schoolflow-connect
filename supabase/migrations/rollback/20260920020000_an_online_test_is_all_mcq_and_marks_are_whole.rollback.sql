-- Rollback for 20260920020000.
--
-- Removes the markable-MCQ trigger, which re-opens `test_questions` to the four
-- shapes the migration measured as unmarkable:
--
--   short, long   `correct` is NULL, so `a.response = q.correct` is NULL and
--                 every written answer scores zero with no screen to mark it
--   numerical     marks only when the typed number matches the key exactly
--   multi         the renderer sends indexes in click order, so a correct
--                 multi-select answer marks wrong whenever the order differs
--
-- and re-opens half-marks, which the integer `tests.max_mark` and
-- `test_marks.mark` columns round into the marks a parent and principal read.
--
-- `trg_test_question_key_addresses_an_option` is NOT touched: it is a different
-- rule from a different migration.

DROP TRIGGER IF EXISTS trg_test_question_is_a_markable_mcq ON public.test_questions;
DROP FUNCTION IF EXISTS public.tg_test_question_is_a_markable_mcq();
