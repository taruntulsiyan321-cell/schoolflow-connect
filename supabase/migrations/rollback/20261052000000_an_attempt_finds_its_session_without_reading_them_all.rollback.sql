-- ROLLBACK 20261052000000 — drops the session_id index.
--
-- This returns rpc_record_question_attempt's template idempotency lookup to
-- a full sequential scan of question_attempts on every saved answer
-- (measured at 95 ms against 7,445 rows, and linear in the table's size).
-- There is no correctness change either way; it is purely the cost of
-- saving an answer.
DROP INDEX IF EXISTS public.question_attempts_session;
DELETE FROM public.schema_migrations
 WHERE version = '20261052000000_an_attempt_finds_its_session_without_reading_them_all';
