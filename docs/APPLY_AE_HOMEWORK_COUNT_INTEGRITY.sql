-- =============================================================================
-- APPLY_AE_HOMEWORK_COUNT_INTEGRITY.sql
-- Source: supabase/migrations/20260802380000_ae_homework_count_and_live_integrity.sql
-- SSOT: bump student_xp.homework_submitted_count from progression_history
-- (homework.submit awards). Apply in Supabase SQL editor if migrations are not
-- auto-applied.
-- =============================================================================

-- 0. Ensure column exists (idempotent; also in 20260802310000 academic progression)
ALTER TABLE public.student_xp
  ADD COLUMN IF NOT EXISTS homework_submitted_count int NOT NULL DEFAULT 0;
-- Investigator 4: Academic Engine integrity
-- 1) homework_submitted_count belongs in Progression SSOT (not client dual-write)
-- 2) Idempotent: only fires on new progression_history rows (rpc_apply_progression skips duplicates)

CREATE OR REPLACE FUNCTION public._progression_bump_homework_count()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.rule_code = 'homework.submit' AND COALESCE(NEW.direction, 'award') = 'award' THEN
    PERFORM public._ensure_student_xp(NEW.user_id);
    UPDATE public.student_xp SET
      homework_submitted_count = COALESCE(homework_submitted_count, 0) + 1,
      updated_at = now()
    WHERE user_id = NEW.user_id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_progression_homework_count ON public.progression_history;
CREATE TRIGGER trg_progression_homework_count
  AFTER INSERT ON public.progression_history
  FOR EACH ROW
  EXECUTE FUNCTION public._progression_bump_homework_count();

COMMENT ON FUNCTION public._progression_bump_homework_count() IS
  'SSOT: bump homework_submitted_count when homework.submit progression is applied (idempotent via history unique key).';
