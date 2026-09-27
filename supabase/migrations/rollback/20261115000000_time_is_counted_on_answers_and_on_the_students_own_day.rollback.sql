-- ===========================================================================
-- ROLLBACK: avg_sec counts skips again, and rpc_student_practice_time goes
--
-- rpc_student_practice_analytics.avg_sec and `timed` return to every attempt
-- that carries a time, skips included, and the per-day time function is
-- dropped. The app's study-time and busiest-hour tiles read that function, so
-- roll the app back with this.
--
-- Undoes: 20261115000000_time_is_counted_on_answers_and_on_the_students_own_day.sql
-- ===========================================================================

BEGIN;

DO $pace$
DECLARE
  _def text;
  _timed_old constant text :=
    'count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0)::int AS timed';
  _timed_new constant text :=
    'count(*) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false))::int AS timed';
  _avg_old constant text :=
    'round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0) / 1000.0, 1) AS avg_sec';
  _avg_new constant text :=
    'round(avg(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0 AND NOT COALESCE(qa.skipped, false)) / 1000.0, 1) AS avg_sec';
BEGIN
  _def := replace(pg_get_functiondef('public.rpc_student_practice_analytics()'::regprocedure), E'\r\n', E'\n');
  IF (length(_def) - length(replace(_def, _timed_new, ''))) / length(_timed_new) <> 4 THEN
    RAISE EXCEPTION 'expected the answered timed count in all 4 groups, found %',
      (length(_def) - length(replace(_def, _timed_new, ''))) / length(_timed_new);
  END IF;
  IF (length(_def) - length(replace(_def, _avg_new, ''))) / length(_avg_new) <> 4 THEN
    RAISE EXCEPTION 'expected the answered avg_sec in all 4 groups, found %',
      (length(_def) - length(replace(_def, _avg_new, ''))) / length(_avg_new);
  END IF;
  EXECUTE replace(replace(_def, _timed_new, _timed_old), _avg_new, _avg_old);
END
$pace$;

DROP FUNCTION public.rpc_student_practice_time(text);

COMMIT;
