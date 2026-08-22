-- Phase 1 (data integrity) audit, 2026-08-22: independently re-verified every
-- table with a nullable school_id column against its LIVE writer function,
-- not the earlier trigger-coverage list from memory. Found four tables whose
-- only write path (_upsert_concept_mastery, rpc_record_concept_mistake,
-- both _bump_academic_activity overloads, rpc_assign_concept_recovery) never
-- sets school_id, so every row they write is NULL there today -- confirmed
-- live and still happening as of this audit (concept_mastery rows dated
-- 2026-08-22, i.e. today). This is the exact same "school_id never set"
-- pattern already closed for revision_queue/student_academic_brain/
-- recovery_assignments/app_settings/etc. via tg_set_school_id_from_session --
-- these four tables were simply missed by that earlier sweep.
--
-- Blast radius, confirmed via same_school()'s definition (`_school_id IS NOT
-- NULL AND _school_id = get_my_school_id()`): a NULL school_id can never
-- match same_school(), so this is fail-closed, not a cross-tenant leak. The
-- actual impact is narrower -- admin/principal dashboards that filter by
-- same_school(school_id) silently omit this student's mastery/mistakes/
-- activity rows, while the student's own access (user_id = auth.uid()) and
-- their subject-teacher's access (joined through students.class_id, which
-- never references this column) are both unaffected. Confirmed by reading
-- every RLS policy on these four tables live before writing this migration.
--
-- attendance's single NULL school_id row is separate: rpc_bulk_upsert_attendance
-- (the only live write path) always sets school_id and raises if it can't
-- resolve one, so this is stale data (a 2020-01-02 dated row against a
-- deterministic seed-pattern student id, created 2026-08-21) rather than an
-- active bug -- backfilled here for admin-dashboard consistency, not because
-- a live path can still produce it.

CREATE TRIGGER trg_concept_mastery_set_school
  BEFORE INSERT ON public.concept_mastery
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

CREATE TRIGGER trg_student_mistakes_set_school
  BEFORE INSERT ON public.student_mistakes
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

CREATE TRIGGER trg_academic_daily_activity_set_school
  BEFORE INSERT ON public.academic_daily_activity
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

CREATE TRIGGER trg_recovery_assignment_questions_set_school
  BEFORE INSERT ON public.recovery_assignment_questions
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

-- Backfill existing NULL rows via the same student's own students.school_id
-- (authoritative and available for historical rows, unlike get_my_school_id()
-- which depends on the live session and can't run outside a request).
UPDATE public.concept_mastery cm
SET school_id = s.school_id
FROM public.students s
WHERE cm.user_id = s.user_id AND cm.school_id IS NULL AND s.school_id IS NOT NULL;

UPDATE public.student_mistakes sm
SET school_id = s.school_id
FROM public.students s
WHERE sm.user_id = s.user_id AND sm.school_id IS NULL AND s.school_id IS NOT NULL;

UPDATE public.academic_daily_activity ada
SET school_id = s.school_id
FROM public.students s
WHERE ada.user_id = s.user_id AND ada.school_id IS NULL AND s.school_id IS NOT NULL;

UPDATE public.recovery_assignment_questions raq
SET school_id = ra.school_id
FROM public.recovery_assignments ra
WHERE raq.assignment_id = ra.id AND raq.school_id IS NULL AND ra.school_id IS NOT NULL;

UPDATE public.attendance a
SET school_id = s.school_id
FROM public.students s
WHERE a.student_id = s.id AND a.school_id IS NULL AND s.school_id IS NOT NULL;
