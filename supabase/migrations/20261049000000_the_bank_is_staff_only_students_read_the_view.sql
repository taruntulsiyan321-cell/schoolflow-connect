-- THE BANK IS STAFF-ONLY. STUDENTS READ THE VIEW.
--
-- The last of three. 20261046000000 built question_bank_student and
-- rpc_question_review, 20261047000000 made the server return its verdict so
-- the browser stops needing the answer, 20261048000000 gave the hint its own
-- per-question call. This withdraws the read that made all of it necessary.
--
-- qb_select_approved_board grants SELECT on question_bank to every
-- authenticated user for every approved question on their board. That is how
-- a student could run
--
--   GET /question_bank?select=id,correct_index&correct_index=eq.2
--
-- and enumerate the answers. A policy cannot withhold a column of a row it
-- grants, so the policy itself is the thing that has to go.
--
-- WHO STILL READS THE BASE TABLE, checked by grepping every client read
-- rather than assumed:
--
--   questionBankService (3 reads)  QuestionPapers, QuestionBankPage,
--                                  QuestionBankReview — all staff screens,
--                                  covered by qb_staff_read
--   SECURITY DEFINER functions     _practice_grade_from_bank,
--                                  rpc_question_review, rpc_question_hint
--                                  and the rest bypass RLS by definition
--   question_bank_student          security_invoker is off, so it reads as
--                                  its owner and is unaffected
--
-- Everything a student touches now goes through the view, which has no
-- answer column to select.
--
-- PARENTS lose this read too, and should: no parent surface reads the
-- question bank.

DROP POLICY IF EXISTS qb_select_approved_board ON public.question_bank;

-- Fail closed: the staff read must survive, or this has locked teachers out
-- of their own question bank.
DO $guard$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.question_bank'::regclass AND polname = 'qb_staff_read'
  ) THEN
    RAISE EXCEPTION 'qb_staff_read is gone — teachers would lose the bank';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_policy
    WHERE polrelid = 'public.question_bank'::regclass AND polname = 'qb_select_approved_board'
  ) THEN
    RAISE EXCEPTION 'the student read policy is still in place';
  END IF;
  -- And the view a student depends on must exist before its only alternative
  -- is taken away.
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.views
    WHERE table_schema = 'public' AND table_name = 'question_bank_student'
  ) THEN
    RAISE EXCEPTION 'question_bank_student is missing — students would have no questions at all';
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261049000000_the_bank_is_staff_only_students_read_the_view')
ON CONFLICT (version) DO NOTHING;
