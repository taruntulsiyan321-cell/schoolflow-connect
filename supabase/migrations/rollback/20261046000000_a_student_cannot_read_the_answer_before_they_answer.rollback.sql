-- ROLLBACK 20261046000000 — drops the answer-free view and the gated review
-- function.
--
-- SAFE ONLY WHILE THE BASE-TABLE POLICY IS STILL IN PLACE. This migration is
-- additive: it changes nothing about what a student can read until
-- qb_select_approved_board is withdrawn in a later migration and the client
-- is pointed at the view. Rolling back BEFORE that happens is a no-op for
-- students. Rolling back AFTER it takes practice down, because the view is
-- then the only path a student has to a question.
--
-- Roll the later migration back first.

DROP FUNCTION IF EXISTS public.rpc_question_review(uuid[]);
DROP VIEW IF EXISTS public.question_bank_student;

DELETE FROM public.schema_migrations
 WHERE version = '20261046000000_a_student_cannot_read_the_answer_before_they_answer';
