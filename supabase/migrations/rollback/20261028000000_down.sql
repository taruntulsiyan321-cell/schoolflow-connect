-- Rollback for 20261028000000_the_load_test_leaves_the_loop.sql
--
-- THERE IS NOTHING HONEST TO PUT BACK.
--
-- The forward migration deletes 480 student_mistakes rows reading "Scale
-- fixture mistake N" and 200 revision_queue rows with reason 'scale fixture'.
-- They were written by a load test, not by any student: nobody answered them,
-- they match no question in the bank, and they carry no options, so they could
-- never be displayed, retried or cleared.
--
-- Re-inserting invented rows here would fabricate student history, which is a
-- worse state than the one the forward migration removes. If a load test needs
-- that data again, re-run the seeder that produced it — regenerating fixtures
-- with fresh ids is what a fixture is for.
--
-- No practice history is touched either way: question_attempts,
-- practice_sessions, and every mistake carrying a real question are untouched
-- by the forward migration.

BEGIN;
DO $noop$
BEGIN
  RAISE NOTICE 'no-op by design: see the header — deleted load-test fixtures are not restorable by SQL';
END $noop$;
COMMIT;
