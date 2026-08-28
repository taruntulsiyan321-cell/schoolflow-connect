-- =====================================================================
-- REVERSE OF: 20260828140000_chunk67_batch2_attendance.sql
--
-- WHAT THIS COSTS, measured on this database at 158 attendance rows:
--
--   attendance   admin 4,526 ms · parent 4,351 ms · student 3,994 ms
--                principal 693 ms · teacher 772 ms
--   attendance_submissions  ~180 ms, 3.9 ms/row
--   attendance_audit        221-297 ms, 4.6-6.2 ms/row
--
-- Two of those are already findings against the 8 s timeout, and every
-- path projects past it at 10,000 rows. A single school year is roughly
-- 200 days x 6 sections x 35 students = 42,000 attendance rows, so this
-- restores a surface that does not work at one year of real use — on the
-- screen every teacher opens every morning.
--
-- It also restores the nested-RLS read: "att teacher read class" runs
-- EXISTS against attendance_submissions, so a teacher pays that table's
-- whole policy stack once per attendance row.
--
-- Reverse to isolate a problem, not as a resting state.
--
-- NOT REVERSED: my_teacher_submission_ids() is dropped, but the GRANT on
-- my_accessible_school_ids() is left alone — it predates this batch and
-- eighteen other tables now depend on it.
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 1. attendance — the four SELECT policies, as they were.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_read ON public.attendance;

CREATE POLICY "att parent read child" ON public.attendance
  FOR SELECT USING (public.is_my_child(student_id));

CREATE POLICY "att student read self" ON public.attendance
  FOR SELECT USING (public.is_my_student_record(student_id));

CREATE POLICY "att teacher read class" ON public.attendance
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.attendance_submissions s
       WHERE s.id = attendance.submission_id
         AND public.teacher_teaches_class(auth.uid(), s.section_id)
    )
  );

CREATE POLICY "attendance principal read" ON public.attendance
  FOR SELECT USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "att admin all" ON public.attendance;
CREATE POLICY "att admin all" ON public.attendance
  FOR ALL
  USING      (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.same_school(school_id))
  WITH CHECK (public.has_role(auth.uid(), 'admin'::public.app_role) AND public.same_school(school_id));

DROP POLICY IF EXISTS attendance_tenant_fence ON public.attendance;
CREATE POLICY attendance_tenant_fence ON public.attendance
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- ---------------------------------------------------------------------
-- 2. attendance_submissions
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_submissions_read ON public.attendance_submissions;
CREATE POLICY attendance_submissions_read ON public.attendance_submissions
  FOR SELECT USING (public.same_school(school_id));

DROP POLICY IF EXISTS attendance_submissions_admin_all ON public.attendance_submissions;
CREATE POLICY attendance_submissions_admin_all ON public.attendance_submissions
  FOR ALL
  USING      (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role))
  WITH CHECK (public.same_school(school_id) AND public.has_role(auth.uid(), 'admin'::public.app_role));

DROP POLICY IF EXISTS attendance_submissions_tenant_fence ON public.attendance_submissions;
CREATE POLICY attendance_submissions_tenant_fence ON public.attendance_submissions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- ---------------------------------------------------------------------
-- 3. attendance_audit
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS "audit school staff read" ON public.attendance_audit;
CREATE POLICY "audit school staff read" ON public.attendance_audit
  FOR SELECT USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    )
  );

DROP POLICY IF EXISTS attendance_audit_tenant_fence ON public.attendance_audit;
CREATE POLICY attendance_audit_tenant_fence ON public.attendance_audit
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR public.same_school(school_id))
  WITH CHECK (school_id IS NULL OR public.same_school(school_id));

-- ---------------------------------------------------------------------
-- 4. The helper this batch introduced. Dropped last, because the policies
--    above had to stop referencing it first.
-- ---------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.my_teacher_submission_ids();

DELETE FROM public.schema_migrations
 WHERE version = '20260828140000_chunk67_batch2_attendance';

COMMIT;
