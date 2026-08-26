-- =====================================================================
-- ROLLBACK — Chunk 3 PEOPLE (20260826160000)
--
-- Drops what Chunk 3 added and restores the previous policies. The backfilled
-- parent_students rows are NOT removed: they are correct data that merely
-- happened to be created by this migration, and deleting them would lose the
-- guardian linkage for any student whose only link was the legacy column.
-- =====================================================================

-- --- Section 8: the new table's policies and the table itself --------
DROP POLICY IF EXISTS student_enrolments_write_admin  ON public.student_enrolments;
DROP POLICY IF EXISTS student_enrolments_read         ON public.student_enrolments;
DROP POLICY IF EXISTS student_enrolments_tenant_fence ON public.student_enrolments;

DROP TRIGGER IF EXISTS trg_student_enrolments_same_institution ON public.student_enrolments;
DROP TABLE IF EXISTS public.student_enrolments;
DROP FUNCTION IF EXISTS public.tg_student_enrolments_same_institution();

-- --- Section 7 and 6: policies added by this chunk -------------------
DROP POLICY IF EXISTS students_exit_hides_from_guardian  ON public.students;
DROP POLICY IF EXISTS students_hide_soft_deleted         ON public.students;
DROP POLICY IF EXISTS teachers_hide_soft_deleted         ON public.teachers;
DROP POLICY IF EXISTS teacher_remarks_hide_soft_deleted  ON public.teacher_remarks;

-- --- Section 5: remarks edit marker and the restored write policy ----
DROP TRIGGER IF EXISTS trg_teacher_remarks_mark_edited ON public.teacher_remarks;
DROP FUNCTION IF EXISTS public.tg_teacher_remarks_mark_edited();

ALTER TABLE public.teacher_remarks
  DROP COLUMN IF EXISTS edited_at,
  DROP COLUMN IF EXISTS deleted_at;

-- The pre-Chunk-3 write policy: any teacher in the school, not only one who
-- teaches the student.
DROP POLICY IF EXISTS teacher_remarks_teacher_write ON public.teacher_remarks;
CREATE POLICY teacher_remarks_teacher_write ON public.teacher_remarks
  FOR ALL TO authenticated
  USING (public.same_school(school_id))
  WITH CHECK (public.same_school(school_id));

-- --- Section 4: guardian relation -----------------------------------
ALTER TABLE public.parents DROP CONSTRAINT IF EXISTS parents_relation_known;
ALTER TABLE public.parents DROP COLUMN IF EXISTS relation;

COMMENT ON TABLE public.parents IS NULL;
COMMENT ON TABLE public.parent_students IS NULL;

-- --- Section 2: teacher soft delete ---------------------------------
ALTER TABLE public.teachers
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by;

-- --- Section 1: student columns -------------------------------------
ALTER TABLE public.students DROP CONSTRAINT IF EXISTS students_exit_after_enrolment;

ALTER TABLE public.students
  DROP COLUMN IF EXISTS academic_year_id,
  DROP COLUMN IF EXISTS enrolment_date,
  DROP COLUMN IF EXISTS exit_date,
  DROP COLUMN IF EXISTS deleted_at,
  DROP COLUMN IF EXISTS deleted_by;

ALTER TABLE public.students ALTER COLUMN school_id DROP NOT NULL;

COMMENT ON COLUMN public.students.roll_number IS NULL;
COMMENT ON COLUMN public.students.parent_user_id IS NULL;
