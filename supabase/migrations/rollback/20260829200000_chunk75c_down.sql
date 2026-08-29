-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — Chunk 7.5c through 7.5i (the DPP removal)
--   20260829200000  branches, dpp_count, badge codes
--   20260829210000  the four tables
--   20260829220000  the two enum types
--   20260829230000  the restored _bump_academic_activity grants
--
-- ⚠ THIS ROLLBACK CANNOT RESTORE THE DPP DATA. The four tables were dropped
-- with 2 dpps, 2 dpp_questions, 4 dpp_attempts and 2 dpp_answers in them.
-- Nothing here brings those rows back, and no version of it could.
--
-- What this does undo is the RENAMING, which is the part that would break a
-- reverted client:
--   academic_daily_activity.test_count -> dpp_count
--   student_badges first_test/test_perfect -> first_dpp/dpp_perfect
--   the three converged CHECK constraints
--
-- It deliberately does NOT rewrite the fifteen function bodies back. They were
-- rewritten by an ordered substitution pass, and reversing it blind would run
-- the same pass in the opposite direction over bodies that have since been
-- edited by 7.5c's two explicit fixes — turning `student_mistakes` reads back
-- into reads of tables that no longer exist. If those bodies genuinely need
-- reverting, re-apply the migrations that last defined them; the DPP-era
-- versions are in git history.
--
-- Realistically: if 7.5 needs reverting, revert the COMMIT, restore the
-- database from a point-in-time backup taken before 20260829200000, and do
-- not run this file. It exists so the rename half is reversible, not to
-- pretend the drop is.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.academic_daily_activity RENAME COLUMN test_count TO dpp_count;

UPDATE public.student_badges SET badge_code = 'first_dpp'   WHERE badge_code = 'first_test';
UPDATE public.student_badges SET badge_code = 'dpp_perfect' WHERE badge_code = 'test_perfect';

ALTER TABLE public.question_attempts DROP CONSTRAINT IF EXISTS question_attempts_source_check;
UPDATE public.question_attempts SET source = 'dpp' WHERE source = 'test';
ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_source_check
  CHECK (source = ANY (ARRAY['battle', 'dpp', 'practice', 'mistake_book']));

ALTER TABLE public.progression_history DROP CONSTRAINT IF EXISTS progression_history_source_type_check;
UPDATE public.progression_history SET source_type = 'dpp_attempt' WHERE source_type = 'test_attempt';
ALTER TABLE public.progression_history
  ADD CONSTRAINT progression_history_source_type_check
  CHECK (source_type = ANY (ARRAY['attendance', 'battle', 'deep_link', 'dpp_attempt',
                                  'homework_submission', 'practice_session', 'recovery_followup',
                                  'revision', 'student_mistake', 'student_test_attempt',
                                  'weak_concept', 'battle_participant', 'recovery_assignment']));

-- The enum types, recreated empty of dependents. Nothing uses them after a
-- rollback either, but their absence is what verification item 4 measured, so
-- restoring them restores the pre-7.5 shape honestly.
DO $types$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                  WHERE n.nspname='public' AND t.typname='dpp_attempt_status') THEN
    CREATE TYPE public.dpp_attempt_status AS ENUM ('in_progress', 'submitted');
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
                  WHERE n.nspname='public' AND t.typname='dpp_question_kind') THEN
    CREATE TYPE public.dpp_question_kind AS ENUM ('mcq', 'multi', 'numerical', 'short');
  END IF;
END
$types$;

-- NOTE on 20260829230000: its REVOKE is NOT undone. Re-granting EXECUTE on an
-- internal helper to anon and authenticated would restore a privilege escalation
-- that only existed for the length of one migration because pg_get_functiondef
-- does not carry grants. There is no state worth returning to there.

COMMIT;
