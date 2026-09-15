-- Rollback for 20261023000000_the_profile_reads_the_attempts.sql
--
-- Puts the profile back on practice_sessions.question_count.
--
-- What this re-introduces: the profile row teacher and parent views read is
-- divided by the PLANNED size of each session rather than by what the student
-- answered. Measured for one student: 225 planned against 86 actually
-- attempted, giving 10.14% where their own screens say 28.2%.

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prokind='f'
     AND p.proname='refresh_student_academic_profile';

  _new := replace(_def,
    'SELECT count(*)
  INTO _practice_n
  FROM public.practice_sessions
  WHERE student_id = _student_id
     OR (_user IS NOT NULL AND user_id = _user);

  -- The attempts, not the planned session size. See the migration header.
  SELECT coalesce(round(
           100.0 * count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))
                 / NULLIF(count(*) FILTER (WHERE NOT COALESCE(skipped, false)), 0), 2), 0)
  INTO _practice_avg
  FROM public.question_attempts
  WHERE _user IS NOT NULL AND user_id = _user;',
    'SELECT count(*), coalesce(
    100.0 * sum(correct_count)::numeric
          / NULLIF(sum(GREATEST(question_count - COALESCE(skipped_count, 0), 0)), 0), 0)
  INTO _practice_n, _practice_avg
  FROM public.practice_sessions
  WHERE student_id = _student_id
     OR (_user IS NOT NULL AND user_id = _user);');

  IF _new = _def THEN RAISE EXCEPTION 'anchor matched nothing'; END IF;
  EXECUTE _new;
END $rewrite$;

COMMIT;
