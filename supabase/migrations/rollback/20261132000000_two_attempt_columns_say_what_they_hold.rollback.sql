-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the attempt columns' old descriptions
--
-- Restores the two descriptions verbatim. Note what you are restoring: both
-- describe something the columns never recorded (KNOWN_ISSUES 93).
--
-- Undoes: 20261132000000_two_attempt_columns_say_what_they_hold.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

COMMENT ON COLUMN public.question_attempts.attempt_number IS 'Nth attempt on same stem within session when tracked';
COMMENT ON COLUMN public.question_attempts.solution_viewed IS 'Practice Intelligence: learner viewed solution';

DELETE FROM public.schema_migrations WHERE version = '20261132000000_two_attempt_columns_say_what_they_hold';

COMMIT;
