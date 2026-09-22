-- ROLLBACK 20261048000000 — removes the per-question hint function.
--
-- Only safe while the student can still read question_bank.explanation
-- directly, i.e. before 20261049000000 withdraws qb_select_approved_board.
-- After that, dropping this takes the hint feature away entirely.
DROP FUNCTION IF EXISTS public.rpc_question_hint(uuid);
DELETE FROM public.schema_migrations
 WHERE version = '20261048000000_a_hint_is_asked_for_one_question_at_a_time';
