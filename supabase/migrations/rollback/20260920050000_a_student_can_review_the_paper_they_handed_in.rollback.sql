-- Rollback for 20260920050000.
--
-- Drops the answer sheet. The result screen's question review then has no
-- source for the correct answer — a student's own read of `test_questions` goes
-- through `rpc_test_questions_for_attempt`, which omits `correct` on purpose —
-- so the review falls back to rule 27's honest empty state and the student can
-- see their mark, their rank and their weak topics but not what the right
-- answer was.

DROP FUNCTION IF EXISTS public.rpc_test_answer_sheet(uuid, uuid);
