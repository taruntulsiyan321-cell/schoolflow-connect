-- Rollback for 20260916000000_a_teacher_can_finally_see_how_the_class_did
--
-- Drops the two report RPCs and the two fence functions.
--
-- WHAT ROLLING THIS BACK COSTS: there is no teacher-side test report again.
-- That was the state before this migration — 72 tests and 458 submitted
-- attempts with no screen through which any teacher could see one of them.
--
-- Nothing else depends on these: they are additive, read-only, and no policy
-- or trigger references them. Dropping them cannot orphan data — the reports
-- were computed from `test_attempts` / `test_answers` / `test_marks`, all of
-- which are untouched and stay exactly as they were.

DROP FUNCTION IF EXISTS public.rpc_test_student_report(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_test_class_report(uuid);
DROP FUNCTION IF EXISTS public.can_read_test_student_report(uuid, uuid);
DROP FUNCTION IF EXISTS public.can_read_test_report(uuid);

DO $verify$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname IN ('can_read_test_report','can_read_test_student_report',
                       'rpc_test_class_report','rpc_test_student_report');
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % report function(s) still present', _n;
  END IF;
  RAISE NOTICE 'test report functions removed — no teacher-side test report again.';
END $verify$;
