-- ROLLBACK 20261049000000 — restores the student's direct read of
-- question_bank.
--
-- THIS REOPENS THE HOLE. With this policy back, any signed-in student can
-- run `GET /question_bank?select=id,correct_index&correct_index=eq.2` and
-- enumerate the answer to every approved question on their board. Run it
-- only to unblock a broken deploy, and put the forward migration back as
-- soon as the client is serving.
--
-- The USING expression below is the one that was dropped, transcribed from
-- pg_policy on 2026-09-22.
CREATE POLICY qb_select_approved_board ON public.question_bank
  FOR SELECT TO authenticated
  USING (
    is_approved AND (
      board IS NULL
      OR board = 'both'
      OR board = (SELECT s.board FROM public.schools s WHERE s.id = (SELECT public.get_my_school_id()))
    )
  );

DELETE FROM public.schema_migrations
 WHERE version = '20261049000000_the_bank_is_staff_only_students_read_the_view';
