-- THE STUDENT BANK VIEW NEEDS A SIGN-IN.
--
-- 20261060000000 (on claude/question-topics-per-chapter) re-granted
-- question_bank_student to anon as well as authenticated. The view reads as
-- its owner, so RLS does not apply to it, and for a caller with no school its
-- board fence still lets through every row with board NULL or 'both'.
-- Measured 2026-09-24 with only the public anon key: 62 questions, text and
-- options.
--
-- Every reader of the view is a signed-in screen (practiceService,
-- MistakeBook, useWeakChapters); 20261046000000, which built the view,
-- granted it to authenticated only.
BEGIN;

REVOKE ALL ON public.question_bank_student FROM anon;

DO $proof$
BEGIN
  IF has_table_privilege('anon', 'public.question_bank_student', 'SELECT') THEN
    RAISE EXCEPTION 'anon can still read question_bank_student';
  END IF;
  IF NOT has_table_privilege('authenticated', 'public.question_bank_student', 'SELECT') THEN
    RAISE EXCEPTION 'a signed-in student lost the view';
  END IF;
END
$proof$;

COMMIT;
