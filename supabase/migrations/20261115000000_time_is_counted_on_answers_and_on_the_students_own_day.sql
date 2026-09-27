-- ===========================================================================
-- TIME IS COUNTED ON ANSWERS, AND ON THE STUDENT'S OWN DAY
--
-- Two defects in how Analysis reads a student's time.
--
-- 1. "Seconds per question" averaged the SKIPS in.
--    rpc_student_practice_analytics.avg_sec is avg(time_taken_ms) over every
--    attempt that carries a time, and a skip carries one — the second or two
--    the student spent before passing. Every pace figure on the page reads it:
--    the subject tiles ("Fastest subject", "Takes most time", "Average per
--    question"), the per-subject chart, "Topics / Chapters that take you
--    longest". A subject answered at 40s a question and skipped through at 1s
--    reads faster than it is, and a row that is mostly skips ranks by how fast
--    the student gave up. Analysis.tsx said as much ("THE REAL FIX IS ONE
--    LEVEL DOWN and needs a migration: avg_sec should be averaged over
--    ANSWERED attempts") and held it back with a second floor on `answered`.
--    This is that fix. `timed` — the count behind avg_sec, which the page
--    floors on — becomes answered-and-timed with it, so the floor and the
--    figure it guards count the same rows. total_min is unchanged: a skip is
--    still time spent, and total_min is time spent.
--
-- 2. Study time came from a second clock, on the wrong day.
--    "Study time (4 weeks)", "Average per day", "Most active day", the
--    day-of-week chart and "This month vs last month" read
--    academic_daily_activity.practice_minutes, which is not the time on the
--    questions:
--      * each finished session adds round(total_time_ms / 60000) with a
--        one-minute FLOOR (20260928000000) — a 20-second session is a minute,
--        ten of them are ten minutes against 3.3 measured;
--      * rpc_test_submit adds a TEST's minutes to the same column
--        (20260925000000) — school data on a page that is practice-only by
--        rule 11;
--      * the day is CURRENT_DATE on a UTC database, so anything done between
--        midnight and 05:30 in India lands on the day before;
--      * rpc_student_academic_snapshot returns only 28 days of it, so "last
--        month" in the month comparison held the last day or two of that month
--        and nothing else.
--    rpc_student_practice_time(_tz) answers from question_attempts — the one
--    record every other time figure on the page already counts — summed per
--    day in the caller's own time zone, from the first day of last month.
--    The hour histogram moves here too: the browser fetched the raw
--    timestamps with .limit(5000), under a PostgREST cap of 1,000 rows, so a
--    busy student's "Most active hour" was read off their latest 1,000
--    answers only.
--
-- Callers: Analysis.tsx (useStudentPracticeAnalytics, useStudentPracticeTime).
--
-- ROLLBACK: rollback/20261115000000_time_is_counted_on_answers_and_on_the_students_own_day.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Seconds per question is seconds per ANSWER ──────────────────────────
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
  -- Normalised once: a body last written from a Windows checkout carries CRLF
  -- (20260928000000), and these anchors are single lines either way.
  _def := replace(pg_get_functiondef('public.rpc_student_practice_analytics()'::regprocedure), E'\r\n', E'\n');

  -- by_subject, by_topic, by_chapter, by_difficulty: all four, or none.
  IF (length(_def) - length(replace(_def, _timed_old, ''))) / length(_timed_old) <> 4 THEN
    RAISE EXCEPTION 'expected the timed count in all 4 groups of rpc_student_practice_analytics, found %',
      (length(_def) - length(replace(_def, _timed_old, ''))) / length(_timed_old);
  END IF;
  IF (length(_def) - length(replace(_def, _avg_old, ''))) / length(_avg_old) <> 4 THEN
    RAISE EXCEPTION 'expected avg_sec in all 4 groups of rpc_student_practice_analytics, found %',
      (length(_def) - length(replace(_def, _avg_old, ''))) / length(_avg_old);
  END IF;

  EXECUTE replace(replace(_def, _timed_old, _timed_new), _avg_old, _avg_new);
END
$pace$;

-- ── 2. The student's time, per day of their own calendar ───────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_practice_time(_tz text)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid   uuid := auth.uid();
  _today date;
  _from  date;
  _since timestamptz;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;
  -- The browser's IANA zone. The database holds no column saying where a
  -- student is, and a UTC day straddles two Indian ones.
  IF _tz IS NULL OR NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _tz) THEN
    RAISE EXCEPTION 'unknown time zone: %', _tz USING ERRCODE = '22023';
  END IF;

  _today := (now() AT TIME ZONE _tz)::date;
  -- The first day of last month. It always reaches past the four-week grid
  -- (which starts at most 27 days back), and it is what "last month" needs.
  _from  := (date_trunc('month', _today) - interval '1 month')::date;
  _since := _from::timestamp AT TIME ZONE _tz;

  RETURN jsonb_build_object(
    'time_zone', _tz,
    'from',      to_char(_from, 'YYYY-MM-DD'),
    'today',     to_char(_today, 'YYYY-MM-DD'),

    -- One row per local day that has anything in it.
    --   ms        time on the questions, skips included: time spent
    --   answered  questions answered, not skipped
    --   correct   answered and right
    --   sessions  practice sessions finished that day with something in them,
    --             the rule rpc_student_academic_snapshot counts sessions by
    'days', (
      WITH a AS (
        SELECT (qa.created_at AT TIME ZONE _tz)::date AS day,
               COALESCE(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0), 0)::bigint AS ms,
               count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int AS answered,
               count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int AS correct
          FROM public.question_attempts qa
         WHERE qa.user_id = _uid
           AND qa.created_at >= _since
         GROUP BY 1
      ), s AS (
        SELECT (ps.finished_at AT TIME ZONE _tz)::date AS day,
               count(*)::int AS sessions
          FROM public.practice_sessions ps
         WHERE ps.user_id = _uid
           AND ps.finished_at >= _since
           AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0
         GROUP BY 1
      )
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
               'date',     to_char(COALESCE(a.day, s.day), 'YYYY-MM-DD'),
               'ms',       COALESCE(a.ms, 0),
               'answered', COALESCE(a.answered, 0),
               'correct',  COALESCE(a.correct, 0),
               'sessions', COALESCE(s.sessions, 0))
             ORDER BY COALESCE(a.day, s.day)), '[]'::jsonb)
        FROM a FULL JOIN s ON s.day = a.day
    ),

    -- 24 counts, index 0 = midnight on the student's clock: answers and skips
    -- over the last 28 days.
    'hours', (
      SELECT jsonb_agg(COALESCE(c.n, 0) ORDER BY g.hr)
        FROM generate_series(0, 23) AS g(hr)
        LEFT JOIN (
          SELECT extract(hour FROM qa.created_at AT TIME ZONE _tz)::int AS hr,
                 count(*)::int AS n
            FROM public.question_attempts qa
           WHERE qa.user_id = _uid
             AND qa.created_at >= now() - interval '28 days'
           GROUP BY 1
        ) c ON c.hr = g.hr
    )
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_student_practice_time(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_student_practice_time(text) TO authenticated;

-- ── Proof, as the student ──────────────────────────────────────────────────
DO $verify$
DECLARE
  _tz constant text := 'Asia/Kolkata';
  _uid uuid; _subject text;
  _want_avg numeric; _old_avg numeric; _want_timed int;
  _from date; _since timestamptz;
  _want_ms bigint; _want_hours bigint; _want_sessions bigint;
  _pa jsonb; _pt jsonb; _row jsonb;
  _refused_tz boolean; _refused_anon boolean;
BEGIN
  -- ── 1. A student for whom the two definitions of avg_sec DISAGREE ───────
  -- Only there can the check below fail; anywhere else it is a tautology.
  SELECT qa.user_id, public._normalize_subject_label(qa.subject)
    INTO _uid, _subject
    FROM public.question_attempts qa
   WHERE public._normalize_subject_label(qa.subject) IS NOT NULL
     AND COALESCE(qa.time_taken_ms, 0) > 0
   GROUP BY 1, 2
  HAVING count(*) FILTER (WHERE COALESCE(qa.skipped, false)) > 0
     AND count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false)) > 0
     AND round(avg(qa.time_taken_ms) / 1000.0, 1)
         <> round(avg(qa.time_taken_ms) FILTER (WHERE NOT COALESCE(qa.skipped, false)) / 1000.0, 1)
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: no student has a timed skip beside a timed answer in one subject — the pace check would prove nothing';
  END IF;

  SELECT round(avg(qa.time_taken_ms) FILTER (WHERE NOT COALESCE(qa.skipped, false)) / 1000.0, 1),
         round(avg(qa.time_taken_ms) / 1000.0, 1),
         count(*) FILTER (WHERE NOT COALESCE(qa.skipped, false))::int
    INTO _want_avg, _old_avg, _want_timed
    FROM public.question_attempts qa
   WHERE qa.user_id = _uid
     AND public._normalize_subject_label(qa.subject) = _subject
     AND COALESCE(qa.time_taken_ms, 0) > 0;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _pa := public.rpc_student_practice_analytics();
  RESET ROLE;

  SELECT r INTO _row FROM jsonb_array_elements(_pa->'by_subject') r WHERE r->>'subject' = _subject;
  IF _row IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: % is missing from by_subject for %', _subject, _uid;
  END IF;
  IF (_row->>'avg_sec')::numeric IS DISTINCT FROM _want_avg THEN
    RAISE EXCEPTION 'ROLLED BACK: % avg_sec is %, want % over answers (the skip-inclusive figure is %)',
      _subject, _row->>'avg_sec', _want_avg, _old_avg;
  END IF;
  IF (_row->>'timed')::int <> _want_timed THEN
    RAISE EXCEPTION 'ROLLED BACK: % timed is %, want % timed answers', _subject, _row->>'timed', _want_timed;
  END IF;

  -- ── 2. A student with time inside the new window ─────────────────────────
  _from  := (date_trunc('month', (now() AT TIME ZONE _tz)::date) - interval '1 month')::date;
  _since := _from::timestamp AT TIME ZONE _tz;

  _uid := NULL;
  SELECT qa.user_id INTO _uid
    FROM public.question_attempts qa
   WHERE qa.created_at >= _since AND COALESCE(qa.time_taken_ms, 0) > 0
   GROUP BY 1
   ORDER BY count(*) DESC
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'ROLLED BACK: nobody has a timed answer since % — the time check would prove nothing', _from;
  END IF;

  SELECT COALESCE(sum(qa.time_taken_ms) FILTER (WHERE COALESCE(qa.time_taken_ms, 0) > 0), 0)
    INTO _want_ms
    FROM public.question_attempts qa WHERE qa.user_id = _uid AND qa.created_at >= _since;
  SELECT count(*) INTO _want_hours
    FROM public.question_attempts qa WHERE qa.user_id = _uid AND qa.created_at >= now() - interval '28 days';
  SELECT count(*) INTO _want_sessions
    FROM public.practice_sessions ps
   WHERE ps.user_id = _uid AND ps.finished_at >= _since
     AND (COALESCE(ps.correct_count, 0) + COALESCE(ps.wrong_count, 0) + COALESCE(ps.skipped_count, 0)) > 0;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  SET LOCAL ROLE authenticated;
  _pt := public.rpc_student_practice_time(_tz);
  BEGIN
    PERFORM public.rpc_student_practice_time('Not/A_Zone');
    _refused_tz := false;
  EXCEPTION WHEN invalid_parameter_value THEN
    _refused_tz := true;
  END;
  PERFORM set_config('request.jwt.claims', '', true);
  BEGIN
    PERFORM public.rpc_student_practice_time(_tz);
    _refused_anon := false;
  EXCEPTION WHEN OTHERS THEN
    _refused_anon := SQLERRM = 'auth required';
  END;
  RESET ROLE;

  IF _pt->>'from' <> to_char(_from, 'YYYY-MM-DD') THEN
    RAISE EXCEPTION 'ROLLED BACK: window starts %, want %', _pt->>'from', _from;
  END IF;
  IF (SELECT sum((d->>'ms')::bigint) FROM jsonb_array_elements(_pt->'days') d) IS DISTINCT FROM _want_ms THEN
    RAISE EXCEPTION 'ROLLED BACK: days carry % ms, question_attempts % ms',
      (SELECT sum((d->>'ms')::bigint) FROM jsonb_array_elements(_pt->'days') d), _want_ms;
  END IF;
  IF COALESCE((SELECT sum((d->>'sessions')::int) FROM jsonb_array_elements(_pt->'days') d), 0) <> _want_sessions THEN
    RAISE EXCEPTION 'ROLLED BACK: days carry % sessions, practice_sessions %',
      (SELECT sum((d->>'sessions')::int) FROM jsonb_array_elements(_pt->'days') d), _want_sessions;
  END IF;
  IF jsonb_array_length(_pt->'hours') <> 24
     OR (SELECT sum(h::text::int) FROM jsonb_array_elements(_pt->'hours') h) <> _want_hours THEN
    RAISE EXCEPTION 'ROLLED BACK: hours % do not sum to the % attempts of the last 28 days', _pt->'hours', _want_hours;
  END IF;
  IF NOT _refused_tz THEN
    RAISE EXCEPTION 'ROLLED BACK: an unknown time zone was accepted';
  END IF;
  IF NOT _refused_anon THEN
    RAISE EXCEPTION 'ROLLED BACK: answered a caller with no identity';
  END IF;
  IF has_function_privilege('anon', 'public.rpc_student_practice_time(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLED BACK: anon can execute rpc_student_practice_time';
  END IF;

  RAISE NOTICE 'pace over answers and time per local day: proved as two students';
END
$verify$;

COMMIT;
