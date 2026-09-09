-- Rollback for 20260916020000_the_answer_key_walked_around_its_own_grant
--
-- THIS ROLLBACK DROPS. IT DOES NOT RESTORE THE PREVIOUS BODIES.
--
-- The state before 20260916020000 was measured, as the caller, handing a
-- school-A student all 8 questions of a school-B test with their correct
-- answers — while the same student's direct reads of `tests` and
-- `test_questions` both returned 0 rows. Writing that body back into the
-- database as a "rollback" would be re-opening a disclosure on purpose.
--
-- So this drops the student half of the report outright, which is the same
-- shape as 20260916000000's own rollback and fails closed: the student report
-- stops existing rather than existing wrongly.
--
-- WHAT ROLLING THIS BACK COSTS: no drill-down for anyone — neither the teacher
-- tapping a student name nor the student reading their own wrong answers. The
-- class aggregate (`rpc_test_class_report`) is untouched and keeps working; it
-- has no per-question payload and was never part of this defect.
--
-- Nothing else references these two: no policy, no trigger, no view. The
-- reports are computed from `test_attempts` / `test_answers` / `test_questions`
-- and dropping them cannot orphan a row.

DROP FUNCTION IF EXISTS public.rpc_test_student_report(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_read_test_student_report(uuid, uuid);

DO $verify$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('can_read_test_student_report','rpc_test_student_report');
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % student-report function(s) still present', _n;
  END IF;

  -- The class report must survive: this rollback is scoped to the student half.
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_test_class_report'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: this rollback removed the class report as well';
  END IF;

  RAISE NOTICE 'student test report removed; the class aggregate is untouched.';
END $verify$;
