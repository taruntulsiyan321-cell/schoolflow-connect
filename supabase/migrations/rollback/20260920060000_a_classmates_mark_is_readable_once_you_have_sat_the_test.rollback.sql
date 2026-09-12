-- Rollback for 20260920060000.
--
-- Restores the policy verbatim from 20260904180000, which admits any student of
-- a section to EVERY classmate's mark on EVERY test of that section, whether or
-- not they have sat it. Measured before the fix: a student who had opened
-- neither test in her class read all six mark rows.

DROP POLICY IF EXISTS test_marks_read ON public.test_marks;

CREATE POLICY test_marks_read ON public.test_marks
  FOR SELECT
  USING (
    test_id IN (SELECT public.my_readable_test_ids())
    OR test_id IN (SELECT public.my_manageable_test_ids())
    OR student_id IN (SELECT public.my_own_or_children_student_ids())
  );
