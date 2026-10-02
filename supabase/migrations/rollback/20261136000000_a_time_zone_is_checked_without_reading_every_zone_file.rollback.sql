-- Rollback for 20261136000000: rpc_student_practice_time exactly as it was
-- (20261115000000), with the pg_timezone_names check. Grants are unchanged by
-- CREATE OR REPLACE either way.
BEGIN;

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
           AND NOT COALESCE(qa.excluded_from_accuracy, false)
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
             AND NOT COALESCE(qa.excluded_from_accuracy, false)
             AND qa.created_at >= now() - interval '28 days'
           GROUP BY 1
        ) c ON c.hr = g.hr
    )
  );
END;
$function$;

COMMIT;
