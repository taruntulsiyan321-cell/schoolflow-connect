-- =====================================================================
-- REVERSE OF: 20260827130000_chunk66_can_read_mark_per_statement.sql
--
-- WHAT THIS COSTS, plainly. Measured, not estimated — these are the
-- numbers taken from this database at 2,546 marks before the migration,
-- and they are what running this script restores:
--
--   marks        admin 20.3 s · principal 21.0 s · teacher 18.5 s
--                student 35.9 s · parent 50.1 s
--   test_marks   parent and student TIMED OUT past 180 s, teacher 98.7 s
--   report_cards parent 6.0 s
--   tests        student 7.3 s
--
-- Against an 8 s statement timeout. This does not make the marks surface
-- slower; it makes it return HTTP 500 for every role at one real school's
-- volume. The demo school is small enough to hide all of it.
--
-- Reverse only to isolate a problem, never as a resting state.
--
-- NOTE ON SCOPE: this restores the exact policy and function bodies that
-- existed before, including two things the migration deliberately
-- improved and which therefore also revert —
--   * is_class_teacher_of_student regains its missing institution
--     predicate (harmless only because a RESTRICTIVE tenant fence
--     currently catches it);
--   * student_class_id goes back to filtering the whole student roster
--     through a per-row same_school() call.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. Shared helpers, back to their pre-6.6 bodies.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.student_class_id(_user_id uuid)
RETURNS uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT s.class_id
    FROM public.students s
   WHERE public.same_school(s.school_id)
     AND CASE
           WHEN _user_id = auth.uid()
             THEN s.id = public.active_local_person_id()
                  AND public.active_membership_role() = 'student'
           ELSE s.user_id = _user_id
         END
   LIMIT 1
$$;

CREATE OR REPLACE FUNCTION public.is_principal_or_admin(_uid uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT public.has_role(_uid,'admin') OR public.has_role(_uid,'principal')
$$;

-- ---------------------------------------------------------------------
-- 2. marks — the per-row resolver and the policy that called it.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.can_read_mark(_exam_id uuid, _student_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.exams e
     WHERE e.id = _exam_id
       AND public.same_school(e.school_id)
       AND CASE public.active_membership_role()
             WHEN 'admin'     THEN true
             WHEN 'principal' THEN true
             WHEN 'teacher'   THEN public.teacher_teaches_class(auth.uid(), e.class_id)
             WHEN 'student'   THEN e.results_published_at IS NOT NULL
                                   AND public.is_my_student_record(_student_id)
             WHEN 'parent'    THEN e.results_published_at IS NOT NULL
                                   AND _student_id = ANY (public.my_children_student_ids())
             ELSE false
           END
  )
$$;

DROP POLICY IF EXISTS marks_read ON public.marks;
CREATE POLICY marks_read ON public.marks
  FOR SELECT
  USING (
    public.can_read_mark(exam_id, student_id)
    OR (public.same_school(school_id) AND public.is_super_admin() AND public.super_admin_has_any_access())
  );

-- ---------------------------------------------------------------------
-- 3. The tenant fences, back to the per-row same_school() form.
-- ---------------------------------------------------------------------
DO $$
DECLARE _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY['marks','exams','exam_subjects','tests','test_marks','report_cards'] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _t || '_tenant_fence', _t);
    EXECUTE format($f$
      CREATE POLICY %I ON public.%I
        AS RESTRICTIVE FOR ALL TO anon, authenticated
        USING      (school_id IS NULL OR public.same_school(school_id))
        WITH CHECK (school_id IS NULL OR public.same_school(school_id))
    $f$, _t || '_tenant_fence', _t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- 4. exams
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS exams_read ON public.exams;
CREATE POLICY exams_read ON public.exams
  FOR SELECT
  USING (
    public.same_school(school_id)
    AND (
      CASE public.active_membership_role()
        WHEN 'admin'     THEN true
        WHEN 'principal' THEN true
        WHEN 'teacher'   THEN public.teacher_teaches_class(auth.uid(), class_id)
        WHEN 'student'   THEN public.student_class_id(auth.uid()) = class_id
        WHEN 'parent'    THEN class_id = ANY (public.my_children_class_ids())
        ELSE false
      END
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
  );

-- ---------------------------------------------------------------------
-- 5. exam_subjects, tests, test_marks, report_cards — back to FOR ALL.
--    Note this restores the shape where a permissive FOR ALL write policy
--    is also evaluated on every SELECT.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS exam_subjects_read   ON public.exam_subjects;
DROP POLICY IF EXISTS exam_subjects_insert ON public.exam_subjects;
DROP POLICY IF EXISTS exam_subjects_update ON public.exam_subjects;
DROP POLICY IF EXISTS exam_subjects_delete ON public.exam_subjects;
CREATE POLICY exam_subjects_read ON public.exam_subjects
  FOR SELECT USING (public.same_school(school_id));
CREATE POLICY exam_subjects_write ON public.exam_subjects
  FOR ALL USING (public.can_manage_exam(exam_id))
      WITH CHECK (public.can_manage_exam(exam_id));

DROP POLICY IF EXISTS tests_read   ON public.tests;
DROP POLICY IF EXISTS tests_insert ON public.tests;
DROP POLICY IF EXISTS tests_update ON public.tests;
DROP POLICY IF EXISTS tests_delete ON public.tests;
CREATE POLICY tests_read ON public.tests
  FOR SELECT USING (public.can_read_test(id));
CREATE POLICY tests_write ON public.tests
  FOR ALL USING (public.can_manage_test(id))
      WITH CHECK (public.can_manage_test(id));

DROP POLICY IF EXISTS tests_hide_soft_deleted ON public.tests;
CREATE POLICY tests_hide_soft_deleted ON public.tests
  AS RESTRICTIVE FOR ALL
  USING (deleted_at IS NULL OR public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS test_marks_read   ON public.test_marks;
DROP POLICY IF EXISTS test_marks_insert ON public.test_marks;
DROP POLICY IF EXISTS test_marks_update ON public.test_marks;
DROP POLICY IF EXISTS test_marks_delete ON public.test_marks;
CREATE POLICY test_marks_read ON public.test_marks
  FOR SELECT USING (
    public.can_read_test(test_id)
    OR public.is_my_student_record(student_id)
    OR public.is_my_child(student_id)
  );
CREATE POLICY test_marks_write ON public.test_marks
  FOR ALL USING (public.can_manage_test(test_id))
      WITH CHECK (public.can_manage_test(test_id));

DROP POLICY IF EXISTS report_cards_read   ON public.report_cards;
DROP POLICY IF EXISTS report_cards_insert ON public.report_cards;
DROP POLICY IF EXISTS report_cards_update ON public.report_cards;
DROP POLICY IF EXISTS report_cards_delete ON public.report_cards;
CREATE POLICY report_cards_read ON public.report_cards
  FOR SELECT USING (
    public.is_my_student_record(student_id)
    OR public.is_my_child(student_id)
    OR public.is_principal_or_admin(auth.uid())
    OR public.is_class_teacher_of_student(auth.uid(), student_id)
  );
CREATE POLICY report_cards_write ON public.report_cards
  FOR ALL USING (public.can_manage_exam(exam_id))
      WITH CHECK (public.can_manage_exam(exam_id));

-- ---------------------------------------------------------------------
-- 6. The set helpers this chunk introduced. Dropped last, because every
--    policy above had to stop referencing them first.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_exam_ids_for_marks();
DROP FUNCTION IF EXISTS public.my_visible_exam_ids();
DROP FUNCTION IF EXISTS public.my_manageable_exam_ids();
DROP FUNCTION IF EXISTS public.my_readable_test_ids();
DROP FUNCTION IF EXISTS public.my_manageable_test_ids();
DROP FUNCTION IF EXISTS public.my_readable_mark_student_ids();
DROP FUNCTION IF EXISTS public.my_own_or_children_student_ids();
DROP FUNCTION IF EXISTS public.my_class_teacher_student_ids();
DROP FUNCTION IF EXISTS public.my_class_teacher_class_ids();
DROP FUNCTION IF EXISTS public.my_teacher_class_ids();
DROP FUNCTION IF EXISTS public.my_accessible_school_ids();

DELETE FROM public.schema_migrations WHERE version = '20260827130000';

COMMIT;
