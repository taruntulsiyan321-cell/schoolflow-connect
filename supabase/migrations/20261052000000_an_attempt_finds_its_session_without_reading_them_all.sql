-- AN ATTEMPT FINDS ITS SESSION WITHOUT READING EVERY OTHER ONE.
--
-- THE REPORT: "A database index is missing. Saving a session will slow down
-- as students answer more questions."
--
-- It is not a future problem. MEASURED 2026-09-22 on production, with
-- question_attempts at 7,445 rows:
--
--   rpc_record_question_attempt's TEMPLATE idempotency lookup
--     WHERE session_id = ? AND user_id = ? AND bank_question_id IS NULL
--       AND attempt_number = ?
--     -> Seq Scan, Rows Removed by Filter: 7445, Execution Time 95.228 ms
--
--   the session roll-up
--     WHERE session_id = ?
--     -> Seq Scan, Rows Removed by Filter: 7445, Execution Time 2.004 ms
--
-- The first of those runs on EVERY attempt a student saves through the
-- template/AI path, so the cost is paid per question and grows with the
-- whole table rather than with the student's own session.
--
-- WHY THE EXISTING INDEXES DO NOT COVER IT. question_attempts has ten
-- indexes and not one leads with session_id. question_attempts_bank_qid
-- does serve the BANK idempotency lookup (measured: Index Scan, 2.1 ms) --
-- but it is PARTIAL, `WHERE bank_question_id IS NOT NULL`, so it is
-- unusable for the template path, which asks for exactly the rows that
-- index excludes. That is why one of the two paths was fast and the other
-- read the table.
--
-- ONE INDEX, NOT TWO. session_id alone narrows to a single session's
-- handful of rows, after which the remaining predicates are a trivial
-- filter; adding attempt_number or a partial clause would buy almost
-- nothing and cost another write on every insert.
--
-- NOT CONCURRENTLY: CREATE INDEX CONCURRENTLY cannot run inside a
-- transaction and this file is one. At 7,445 rows / 5 MB the build is
-- milliseconds and the ACCESS EXCLUSIVE lock is shorter than the statement
-- timeout. On a table where that stops being true, rebuild this one
-- concurrently outside a migration.

CREATE INDEX IF NOT EXISTS question_attempts_session
  ON public.question_attempts (session_id);

-- Fail closed: the index must exist AND the planner must actually choose it
-- for the lookup that was scanning. An index nobody uses is not a fix.
DO $guard$
DECLARE _plan text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND tablename = 'question_attempts'
      AND indexname = 'question_attempts_session'
  ) THEN
    RAISE EXCEPTION 'question_attempts_session was not created';
  END IF;

  EXECUTE $q$
    EXPLAIN (COSTS OFF)
    SELECT id FROM public.question_attempts
     WHERE session_id = '00000000-0000-0000-0000-000000000000'::uuid
       AND bank_question_id IS NULL AND attempt_number = 1 LIMIT 1
  $q$ INTO _plan;

  IF _plan ILIKE '%Seq Scan%' THEN
    RAISE EXCEPTION 'the template idempotency lookup still sequential-scans: %', _plan;
  END IF;
END
$guard$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261052000000_an_attempt_finds_its_session_without_reading_them_all')
ON CONFLICT (version) DO NOTHING;
