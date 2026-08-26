-- =====================================================================
-- FIX — progression_history.source_type whitelist was too narrow
--
-- NOT part of Chunk 4. Found by Chunk 4's live smoke test (G8) and proven to
-- predate it: the constraint was added by
-- 20260822210000_gap_closure_check_constraints, applied 2026-08-22 08:29 UTC,
-- four days before Chunk 4. It is my own defect from that session.
--
-- The constraint whitelisted four source types:
--     dpp_attempt · battle_participant · practice_session · recovery_assignment
-- but the application emits eleven. Nine of them therefore raised 23514 on
-- every XP award — and ProgressionService.awardSafe wraps the call in a bare
-- `catch {}`, so every one failed silently. The teacher UI showed "Attendance
-- submitted" while eleven awards returned HTTP 400 behind it.
--
-- Silently broken since 2026-08-22: attendance, battle, deep_link,
-- homework_submission, recovery_followup, revision, student_mistake,
-- student_test_attempt, weak_concept. Only dpp_attempt and practice_session
-- ever worked, which is why progression_history holds practice_session rows
-- and nothing else.
--
-- The whitelist is KEPT, not dropped — a typo in source_type should still be
-- refused. It is widened to exactly what the system produces, taken from a
-- grep of every `sourceType:` literal in src/ plus the two server-side values
-- the original constraint named.
--
-- Reverse: supabase/migrations/rollback/20260826180000_progression_source_type_down.sql
-- =====================================================================

ALTER TABLE public.progression_history
  DROP CONSTRAINT IF EXISTS progression_history_source_type_check;

ALTER TABLE public.progression_history
  ADD CONSTRAINT progression_history_source_type_check
  CHECK (source_type = ANY (ARRAY[
    -- emitted by the application (grep: sourceType: "..." across src/)
    'attendance'::text,
    'battle'::text,
    'deep_link'::text,
    'dpp_attempt'::text,
    'homework_submission'::text,
    'practice_session'::text,
    'recovery_followup'::text,
    'revision'::text,
    'student_mistake'::text,
    'student_test_attempt'::text,
    'weak_concept'::text,
    -- named by the original constraint; retained for server-side writers
    'battle_participant'::text,
    'recovery_assignment'::text
  ]));

DO $$
DECLARE _def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _def
    FROM pg_constraint WHERE conname = 'progression_history_source_type_check';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'source_type whitelist was dropped rather than widened';
  END IF;

  -- The nine that were broken must now be accepted.
  IF _def NOT LIKE '%attendance%' OR _def NOT LIKE '%homework_submission%'
     OR _def NOT LIKE '%student_test_attempt%' OR _def NOT LIKE '%weak_concept%' THEN
    RAISE EXCEPTION 'whitelist still omits a source type the application emits: %', _def;
  END IF;
END $$;
