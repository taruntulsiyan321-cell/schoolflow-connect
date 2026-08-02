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
