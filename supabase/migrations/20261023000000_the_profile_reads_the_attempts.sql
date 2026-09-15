-- ════════════════════════════════════════════════════════════════════════════
-- THE PROFILE READS THE ATTEMPTS, LIKE EVERYTHING ELSE
-- ════════════════════════════════════════════════════════════════════════════
--
-- 20261022000000 put every practice-accuracy rate on one RULE (correct over
-- answered, pooled). It left the profile on a different SOURCE, and that is
-- still a disagreement — measured for one student immediately after it:
--
--   _exam_readiness            28.2%   from question_attempts
--   student_academic_profiles  10.14%  from practice_sessions
--
-- WHY THE SOURCE MATTERS MORE THAN THE FORMULA HERE
--
-- practice_sessions.question_count is the session's PLANNED size, not what the
-- student answered. The same student:
--
--   sum(question_count) across 15 sessions   225
--   question_attempts actually recorded       86
--
-- Sessions are ended early, and sessions the loader could not fill are
-- auto-finished as empty shells (20260925000000) still carrying a planned 20.
-- Dividing by that number does not measure the student — it measures how many
-- questions were once intended for them. Excluding the shells only moves it to
-- 18.8%, because the early-ended sessions carry the same fault.
--
-- question_attempts is one row per question actually put in front of them,
-- carrying is_correct and skipped. It is what _exam_readiness reads and what
-- Analysis reads, so the profile reads it too, and the number teacher and
-- parent views show is the number the student sees.
--
-- practice_sessions remains the source for the session COUNT, which is a count
-- of sessions and is correct as it stands.
--
-- ROLLBACK: supabase/migrations/rollback/20261023000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'refresh_student_academic_profile';
  IF _def IS NULL THEN RAISE EXCEPTION 'refresh_student_academic_profile not found'; END IF;

  _new := replace(_def,
    'SELECT count(*), coalesce(
    100.0 * sum(correct_count)::numeric
          / NULLIF(sum(GREATEST(question_count - COALESCE(skipped_count, 0), 0)), 0), 0)
  INTO _practice_n, _practice_avg
  FROM public.practice_sessions
  WHERE student_id = _student_id
     OR (_user IS NOT NULL AND user_id = _user);',
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
  WHERE _user IS NOT NULL AND user_id = _user;');

  IF _new = _def THEN
    RAISE EXCEPTION 'the accuracy anchor matched nothing — the substitution would have failed open';
  END IF;
  EXECUTE _new;
END $rewrite$;

DO $check$
DECLARE _rp text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _rp
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='refresh_student_academic_profile';
  IF position('FROM public.question_attempts' IN _rp) = 0 THEN
    RAISE EXCEPTION 'the profile still does not read question_attempts';
  END IF;
  IF position('sum(GREATEST(question_count' IN _rp) > 0 THEN
    RAISE EXCEPTION 'the planned-size denominator survives';
  END IF;
END $check$;

DO $refresh$
DECLARE _sid uuid; _n int := 0;
BEGIN
  FOR _sid IN SELECT id FROM public.students LOOP
    BEGIN
      PERFORM public.refresh_student_academic_profile(_sid);
      _n := _n + 1;
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'profile refresh skipped for %: %', _sid, SQLERRM;
    END;
  END LOOP;
  RAISE NOTICE 'refreshed % student profile(s)', _n;
END $refresh$;

COMMIT;
