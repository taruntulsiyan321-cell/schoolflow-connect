-- =====================================================================
-- CHUNK 3 — PEOPLE
--
-- Students, enrolment history, guardians, teachers and remarks.
--
-- RECONCILIATION DECISION (confirmed before building): the existing tables are
-- ADAPTED, not replaced. The database already held three parent-linkage
-- mechanisms — `parents`, `parent_students` and `students.parent_user_id`.
-- Building the doc's `guardians` / `student_guardians` literally would have
-- made four. So:
--     doc's `guardians`         == existing `parents`         (gains `relation`)
--     doc's `student_guardians` == existing `parent_students` (already shaped right)
-- and `students.parent_user_id` is migrated INTO `parent_students` and marked
-- deprecated. One mechanism, every existing FK and call site still resolving.
--
-- `student_remarks` is likewise the existing `teacher_remarks`, which already
-- carries school_id/student_id/teacher_id/body/created_at. It gains `edited_at`
-- and `deleted_at` and a policy that enforces "written only by teachers who
-- teach that student".
--
-- REPORTED DEVIATION — read this before approving:
--   The doc says roll_number "lives in student_enrolments, not here". This
--   migration creates student_enrolments as the AUTHORITY for roll numbers and
--   their history, with the unique constraint the doc specifies, and backfills
--   it. It does NOT drop students.roll_number, because 26 application files and
--   4 SQL functions read that column today and dropping it in the same chunk
--   that introduces enrolment history would put a 30-site refactor and a schema
--   change in one un-reviewable step. students.roll_number is COMMENTed as
--   deprecated. Migrating those call sites is the follow-up, and it is named
--   explicitly rather than left to be discovered.
--
-- enrolment_date backfill: derived from the earliest attendance record that
-- exists for the student, falling back to the current academic year's start.
-- It is not invented per-student — where the database has evidence of when a
-- student was first present, that is what is used (G4).
--
-- Reverse: supabase/migrations/rollback/20260826160000_chunk3_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — students gains enrolment, exit and soft delete
-- ---------------------------------------------------------------------

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS academic_year_id uuid REFERENCES public.academic_years(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS enrolment_date   date,
  ADD COLUMN IF NOT EXISTS exit_date        date,
  ADD COLUMN IF NOT EXISTS deleted_at       timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by       uuid;

COMMENT ON COLUMN public.students.roll_number IS
  'DEPRECATED — student_enrolments.roll_number is the authority (per year, reusable). Kept only until the 26 application files and 4 SQL functions still reading it are migrated. Do not add new readers.';

COMMENT ON COLUMN public.students.parent_user_id IS
  'DEPRECATED — parent_students is the authority for guardian linkage. Retained until its 21 call sites across 10 files and 9 SQL functions are migrated. Do not add new readers.';

COMMENT ON COLUMN public.students.enrolment_date IS
  'Attendance is counted FROM this date, never from session start (locked decision 10.27). A mid-term joiner is simply absent from the denominator on days before it.';

ALTER TABLE public.students ALTER COLUMN school_id SET NOT NULL;

UPDATE public.students s
   SET academic_year_id = ay.id
  FROM public.academic_years ay
 WHERE s.academic_year_id IS NULL
   AND ay.school_id = s.school_id
   AND ay.is_current;

-- Earliest real evidence of attendance, else the year start.
UPDATE public.students s
   SET enrolment_date = COALESCE(
         (SELECT min(a.date) FROM public.attendance a WHERE a.student_id = s.id),
         (SELECT ay.starts_on FROM public.academic_years ay
           WHERE ay.school_id = s.school_id AND ay.is_current LIMIT 1))
 WHERE s.enrolment_date IS NULL;

ALTER TABLE public.students
  DROP CONSTRAINT IF EXISTS students_exit_after_enrolment;
ALTER TABLE public.students
  ADD CONSTRAINT students_exit_after_enrolment
  CHECK (exit_date IS NULL OR enrolment_date IS NULL OR exit_date >= enrolment_date);


-- ---------------------------------------------------------------------
-- SECTION 2 — teachers gains soft delete (G6: 30 days, admin restores)
-- ---------------------------------------------------------------------

ALTER TABLE public.teachers
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;


-- ---------------------------------------------------------------------
-- SECTION 3 — student_enrolments: the roll-number and section history
--
-- "Section change mid-year: history moves with the student." Closing one row
-- and opening another is what records that, rather than overwriting a column.
-- ---------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.student_enrolments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  school_id        uuid NOT NULL REFERENCES public.schools(id) ON DELETE CASCADE,
  student_id       uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  academic_year_id uuid NOT NULL REFERENCES public.academic_years(id) ON DELETE RESTRICT,
  section_id       uuid REFERENCES public.classes(id) ON DELETE SET NULL,
  roll_number      text,
  from_date        date NOT NULL,
  to_date          date,
  created_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT student_enrolments_window CHECK (to_date IS NULL OR to_date >= from_date),
  -- The doc's constraint: a roll number is unique within a section for a year,
  -- and may be reused in a different section or a different year.
  CONSTRAINT student_enrolments_roll_unique
    UNIQUE (section_id, academic_year_id, roll_number)
);

CREATE INDEX IF NOT EXISTS student_enrolments_student_idx ON public.student_enrolments (student_id);
CREATE INDEX IF NOT EXISTS student_enrolments_section_idx ON public.student_enrolments (section_id);
CREATE INDEX IF NOT EXISTS student_enrolments_school_idx  ON public.student_enrolments (school_id);

-- One open enrolment per student: closing and reopening is two rows.
CREATE UNIQUE INDEX IF NOT EXISTS student_enrolments_one_open
  ON public.student_enrolments (student_id)
  WHERE to_date IS NULL;

-- A student's enrolment must sit in the student's own institution.
CREATE OR REPLACE FUNCTION public.tg_student_enrolments_same_institution()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _student_school uuid; _section_school uuid;
BEGIN
  SELECT s.school_id INTO _student_school FROM public.students s WHERE s.id = NEW.student_id;
  IF _student_school IS NULL THEN
    RAISE EXCEPTION 'student % does not exist', NEW.student_id;
  END IF;
  IF _student_school IS DISTINCT FROM NEW.school_id THEN
    RAISE EXCEPTION 'student % belongs to institution %, not %',
      NEW.student_id, _student_school, NEW.school_id;
  END IF;
  IF NEW.section_id IS NOT NULL THEN
    SELECT c.school_id INTO _section_school FROM public.classes c WHERE c.id = NEW.section_id;
    IF _section_school IS DISTINCT FROM NEW.school_id THEN
      RAISE EXCEPTION 'section % belongs to institution %, not %',
        NEW.section_id, _section_school, NEW.school_id;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_student_enrolments_same_institution ON public.student_enrolments;
CREATE TRIGGER trg_student_enrolments_same_institution
  BEFORE INSERT OR UPDATE OF student_id, section_id, school_id ON public.student_enrolments
  FOR EACH ROW EXECUTE FUNCTION public.tg_student_enrolments_same_institution();

REVOKE EXECUTE ON FUNCTION public.tg_student_enrolments_same_institution() FROM public, anon, authenticated;

-- Backfill one open enrolment per student from what students already carries.
INSERT INTO public.student_enrolments
  (school_id, student_id, academic_year_id, section_id, roll_number, from_date)
SELECT s.school_id, s.id, ay.id, s.class_id, s.roll_number, s.enrolment_date
  FROM public.students s
  JOIN public.academic_years ay
    ON ay.school_id = s.school_id AND ay.is_current
 WHERE s.enrolment_date IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.student_enrolments e WHERE e.student_id = s.id)
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 4 — guardians (== parents) and student_guardians (== parent_students)
--
-- `relation` is added to parents. The doc says "mother and father"; live data
-- already contains 'Guardian', so the check allows guardian too rather than
-- rejecting rows that exist. Flagged rather than silently widened.
-- ---------------------------------------------------------------------

ALTER TABLE public.parents
  ADD COLUMN IF NOT EXISTS relation text;

UPDATE public.parents p
   SET relation = lower(btrim(x.relationship))
  FROM public.parent_students x
 WHERE x.parent_id = p.id
   AND p.relation IS NULL
   AND btrim(coalesce(x.relationship, '')) <> '';

ALTER TABLE public.parents DROP CONSTRAINT IF EXISTS parents_relation_known;
ALTER TABLE public.parents
  ADD CONSTRAINT parents_relation_known
  CHECK (relation IS NULL OR relation IN ('mother', 'father', 'guardian'));

COMMENT ON TABLE public.parents IS
  'The doc''s `guardians`. Mother/father per locked decision 4; ''guardian'' is also permitted because live data already contained it.';
COMMENT ON TABLE public.parent_students IS
  'The doc''s `student_guardians`. The authority for guardian linkage — students.parent_user_id is deprecated in favour of this table.';

-- Migrate the legacy single-parent column into the join table.
INSERT INTO public.parent_students (school_id, parent_id, student_id, relationship, is_primary)
SELECT s.school_id, p.id, s.id, COALESCE(p.relation, 'guardian'), true
  FROM public.students s
  JOIN public.parents p ON p.user_id = s.parent_user_id
 WHERE s.parent_user_id IS NOT NULL
   AND NOT EXISTS (
     SELECT 1 FROM public.parent_students ps
      WHERE ps.parent_id = p.id AND ps.student_id = s.id)
ON CONFLICT DO NOTHING;


-- ---------------------------------------------------------------------
-- SECTION 5 — student_remarks (== teacher_remarks) gains edit/delete markers
--
-- "Teacher can edit or delete their own remark at any time" — but the parent
-- may already have read it, so an edit must leave a visible marker.
-- ---------------------------------------------------------------------

ALTER TABLE public.teacher_remarks
  ADD COLUMN IF NOT EXISTS edited_at  timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

COMMENT ON COLUMN public.teacher_remarks.edited_at IS
  'Set by trigger whenever the body changes. Surfaced to the parent, who may already have read the original (locked decision 10.14).';

CREATE OR REPLACE FUNCTION public.tg_teacher_remarks_mark_edited()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.body IS DISTINCT FROM OLD.body THEN
    NEW.edited_at := now();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_teacher_remarks_mark_edited ON public.teacher_remarks;
CREATE TRIGGER trg_teacher_remarks_mark_edited
  BEFORE UPDATE OF body ON public.teacher_remarks
  FOR EACH ROW EXECUTE FUNCTION public.tg_teacher_remarks_mark_edited();

REVOKE EXECUTE ON FUNCTION public.tg_teacher_remarks_mark_edited() FROM public, anon, authenticated;

-- "Written only by teachers who teach that student." Enforced in policy.
DROP POLICY IF EXISTS teacher_remarks_teacher_write ON public.teacher_remarks;
CREATE POLICY teacher_remarks_teacher_write ON public.teacher_remarks
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR EXISTS (
        SELECT 1 FROM public.students s
         WHERE s.id = teacher_remarks.student_id
           AND public.teacher_teaches_class(auth.uid(), s.class_id)
      )
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND EXISTS (
      SELECT 1 FROM public.students s
       WHERE s.id = teacher_remarks.student_id
         AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );


-- ---------------------------------------------------------------------
-- SECTION 6 — soft delete is enforced by policy, not by application filtering
--
-- G6: "Soft-deleted rows carry deleted_at, deleted_by, and are excluded from
-- every query by default via the RLS policy or a view — not by application
-- filtering." Admin still sees them, because admin is who restores them.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS students_hide_soft_deleted ON public.students;
CREATE POLICY students_hide_soft_deleted ON public.students
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (deleted_at IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS teachers_hide_soft_deleted ON public.teachers;
CREATE POLICY teachers_hide_soft_deleted ON public.teachers
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (deleted_at IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS teacher_remarks_hide_soft_deleted ON public.teacher_remarks;
CREATE POLICY teacher_remarks_hide_soft_deleted ON public.teacher_remarks
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (deleted_at IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role));


-- ---------------------------------------------------------------------
-- SECTION 7 — "Student leaves the school: parent access removed immediately."
--
-- Restrictive, so it cannot be undone by adding a permissive policy later.
-- Staff keep their view: the record is retained and past reports must still
-- reconcile (10.27). Only the guardian loses sight of it.
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS students_exit_hides_from_guardian ON public.students;
CREATE POLICY students_exit_hides_from_guardian ON public.students
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (
    exit_date IS NULL
    OR exit_date > CURRENT_DATE
    OR NOT public.has_role(auth.uid(), 'parent'::public.app_role)
  );


-- ---------------------------------------------------------------------
-- SECTION 8 — RLS on the new table
-- ---------------------------------------------------------------------

ALTER TABLE public.student_enrolments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS student_enrolments_tenant_fence ON public.student_enrolments;
CREATE POLICY student_enrolments_tenant_fence ON public.student_enrolments
  AS RESTRICTIVE FOR ALL TO authenticated, anon
  USING (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

DROP POLICY IF EXISTS student_enrolments_read ON public.student_enrolments;
CREATE POLICY student_enrolments_read ON public.student_enrolments
  FOR SELECT TO authenticated
  USING (public.same_school(school_id));

-- Only admin creates or changes enrolment (10.18: admin creates students and
-- assigns them; a section move is an admin action).
DROP POLICY IF EXISTS student_enrolments_write_admin ON public.student_enrolments;
CREATE POLICY student_enrolments_write_admin ON public.student_enrolments
  FOR ALL TO authenticated
  USING (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role));


-- ---------------------------------------------------------------------
-- SECTION 9 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _students int;
BEGIN
  SELECT count(*) INTO _students FROM public.students;

  -- Every student has an enrolment date and an open enrolment row.
  SELECT count(*) INTO _n FROM public.students WHERE enrolment_date IS NULL;
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 3: % student(s) have no enrolment_date', _n; END IF;

  SELECT count(*) INTO _n
    FROM public.students s
   WHERE NOT EXISTS (SELECT 1 FROM public.student_enrolments e
                      WHERE e.student_id = s.id AND e.to_date IS NULL);
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 3: % student(s) have no open enrolment row', _n; END IF;

  -- The roll-number uniqueness rule the doc specifies must exist.
  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid = 'public.student_enrolments'::regclass
                    AND conname = 'student_enrolments_roll_unique') THEN
    RAISE EXCEPTION 'Chunk 3: roll-number uniqueness constraint missing';
  END IF;

  -- Every legacy parent_user_id is now represented in the join table.
  SELECT count(*) INTO _n
    FROM public.students s
   WHERE s.parent_user_id IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.parent_students ps
         JOIN public.parents p ON p.id = ps.parent_id
        WHERE ps.student_id = s.id AND p.user_id = s.parent_user_id);
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 3: % legacy parent link(s) not migrated into parent_students', _n;
  END IF;

  -- Soft delete must be enforced by policy, not by the application.
  SELECT count(*) INTO _n
    FROM (VALUES ('students'), ('teachers'), ('teacher_remarks')) AS t(tbl)
   WHERE NOT EXISTS (
     SELECT 1 FROM pg_policies p
      WHERE p.schemaname = 'public' AND p.tablename = t.tbl
        AND p.permissive = 'RESTRICTIVE' AND p.policyname = t.tbl || '_hide_soft_deleted');
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 3: soft-delete policy missing on % table(s)', _n; END IF;

  -- Guardian access must drop on exit.
  IF NOT EXISTS (SELECT 1 FROM pg_policies
                  WHERE schemaname = 'public' AND tablename = 'students'
                    AND policyname = 'students_exit_hides_from_guardian'
                    AND permissive = 'RESTRICTIVE') THEN
    RAISE EXCEPTION 'Chunk 3: exited students are still visible to guardians';
  END IF;

  RAISE NOTICE 'Chunk 3: % students, all with enrolment history', _students;
END $$;
