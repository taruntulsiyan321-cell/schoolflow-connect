-- ===========================================================================
-- ROLLBACK: the analytics function as it was, and rpc_student_practice_time goes
--
-- rpc_student_practice_analytics is restored from the definition 20261115000000
-- saved before changing it — avg_sec and `timed` over every timed attempt,
-- skips included, and `effort` counted off attempt_number — and the per-day
-- time function is dropped. The app's study-time, busiest-hour and "How you
-- work" figures read what that migration returns, so roll the app back with
-- this.
--
-- Undoes: 20261115000000_time_is_counted_on_answers_and_on_the_students_own_day.sql
-- ===========================================================================

BEGIN;

DO $restore$
DECLARE _def text;
BEGIN
  SELECT definition INTO _def FROM public.routines_pre_20261115000000
   WHERE object = 'public.rpc_student_practice_analytics()';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'no saved definition of rpc_student_practice_analytics() to restore';
  END IF;
  EXECUTE _def;
  IF md5(pg_get_functiondef('public.rpc_student_practice_analytics()'::regprocedure)) <> md5(_def) THEN
    RAISE EXCEPTION 'rpc_student_practice_analytics() did not come back as it was saved';
  END IF;
END
$restore$;

DROP FUNCTION public.rpc_student_practice_time(text);
DROP TABLE public.routines_pre_20261115000000;

COMMIT;
