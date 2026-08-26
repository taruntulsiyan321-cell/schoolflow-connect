-- ROLLBACK — restores the narrow four-value whitelist (20260826180000).
-- Doing so re-breaks XP awards for attendance, battle, deep_link,
-- homework_submission, recovery_followup, revision, student_mistake,
-- student_test_attempt and weak_concept — silently, because
-- ProgressionService.awardSafe swallows the error.
ALTER TABLE public.progression_history
  DROP CONSTRAINT IF EXISTS progression_history_source_type_check;
ALTER TABLE public.progression_history
  ADD CONSTRAINT progression_history_source_type_check
  CHECK (source_type = ANY (ARRAY[
    'dpp_attempt'::text, 'battle_participant'::text,
    'practice_session'::text, 'recovery_assignment'::text
  ]));
