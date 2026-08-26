-- =====================================================================
-- REVERSE OF: 20260826140000_chunk2_curriculum_and_structure.sql
--
-- Order matters: child tables and the columns other tables gained come off
-- before the curriculum tree they point at.
--
-- DESTRUCTIVE: dropping the curriculum tree discards the seeded boards,
-- classes, subjects and 665 chapters, and every question_bank.chapter_id
-- mapping with it. The free-text chapter/subject/topic columns on
-- question_bank are untouched, so the tree can be re-seeded from them.
-- =====================================================================

-- 1. Write-time constraints added to existing tables.
DROP TRIGGER IF EXISTS trg_marks_student_section        ON public.marks;
DROP TRIGGER IF EXISTS trg_hw_submission_student_section ON public.homework_submissions;
DROP TRIGGER IF EXISTS trg_attendance_student_section   ON public.attendance;
DROP FUNCTION IF EXISTS public.tg_student_section_must_match();

-- 2. Columns other tables gained.
ALTER TABLE public.homework DROP CONSTRAINT IF EXISTS homework_section_subject_fk;
DROP INDEX IF EXISTS public.homework_section_subject_idx;
ALTER TABLE public.homework DROP COLUMN IF EXISTS section_subject_id;

DROP INDEX IF EXISTS public.question_bank_chapter_id_idx;
ALTER TABLE public.question_bank DROP COLUMN IF EXISTS chapter_id;

DROP INDEX IF EXISTS public.classes_class_group_idx;
ALTER TABLE public.classes DROP COLUMN IF EXISTS class_group_id;

COMMENT ON TABLE public.classes IS NULL;

-- 3. New institution tables.
DROP TABLE IF EXISTS public.teacher_assignments;

DROP TRIGGER IF EXISTS trg_section_subjects_same_institution ON public.section_subjects;
DROP FUNCTION IF EXISTS public.tg_section_subjects_same_institution();
DROP TABLE IF EXISTS public.section_subjects;

DROP TABLE IF EXISTS public.class_groups;

-- 4. The global curriculum tree, leaves first.
DROP TABLE IF EXISTS public.chapters;
DROP TABLE IF EXISTS public.curriculum_subjects;
DROP TABLE IF EXISTS public.curriculum_classes;
DROP TABLE IF EXISTS public.boards;

-- 5. Ledger.
DELETE FROM public.schema_migrations
 WHERE version = '20260826140000_chunk2_curriculum_and_structure';
