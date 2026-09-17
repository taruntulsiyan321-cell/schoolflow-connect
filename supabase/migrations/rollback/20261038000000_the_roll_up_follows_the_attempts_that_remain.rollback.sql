-- ROLLBACK for 20261038000000_the_roll_up_follows_the_attempts_that_remain.
--
-- THERE IS NOTHING TO PUT BACK, and this file says so rather than pretending.
--
-- The forward migration replaced four sessions' total_time_ms with the sum of
-- the attempts they still have. The values it replaced were sums of attempts
-- that had already been deleted by 20261032000000 — they describe questions
-- that are gone. This file does not hold them, and restoring them would mean
-- writing back a duration for work that is no longer in the record.
--
-- To undo the deletion itself, see the rollback for 20261032000000, which is
-- equally clear that the attempts are not recoverable.

DO $$
BEGIN
  RAISE NOTICE '20261038000000 has no meaningful rollback: it removed stale sums, not information';
END $$;
