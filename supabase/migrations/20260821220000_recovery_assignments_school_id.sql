-- Found by scripts/lint-tenant-scope.mjs on its first run (2026-08-21): the
-- exact same gap already fixed for revision_queue and student_academic_brain
-- (both G2-9-class: school_id column exists, RLS is user_id = auth.uid() so
-- nothing is invisible yet, but a future same_school() rewrite would silently
-- hide these rows) also exists on recovery_assignments, which nobody had
-- checked -- confirmed live: its one real row (arjun.mehta's post-dedup
-- Polynomials assignment) has school_id NULL. rpc_assign_concept_recovery's
-- INSERT never includes school_id.
--
-- Same fix as before: backfill, then the existing tg_set_school_id_from_session
-- trigger so every future INSERT self-heals regardless of which function
-- performs the write.
UPDATE public.recovery_assignments ra
SET school_id = s.school_id
FROM public.students s
WHERE ra.student_id = s.id AND ra.school_id IS NULL;

DROP TRIGGER IF EXISTS recovery_assignments_set_school ON public.recovery_assignments;
CREATE TRIGGER recovery_assignments_set_school
  BEFORE INSERT ON public.recovery_assignments
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

-- Re-verify: select count(*) from recovery_assignments where school_id is null;  -- expect 0
