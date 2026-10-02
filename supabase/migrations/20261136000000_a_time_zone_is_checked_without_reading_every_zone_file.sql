-- ═══════════════════════════════════════════════════════════════════════════
-- A TIME ZONE IS CHECKED WITHOUT READING EVERY ZONE FILE
-- ═══════════════════════════════════════════════════════════════════════════
--
-- rpc_student_practice_time (20261115000000) answers Home's and Analysis's
-- practice-time panels on the student's own day. Before reading anything it
-- checked the browser's zone with
--
--     NOT EXISTS (SELECT 1 FROM pg_timezone_names WHERE name = _tz)
--
-- and pg_timezone_names is built by reading every zone file on disk, on every
-- call. Measured live 2026-10-02 as two real exam accounts: 152–791 ms for that
-- check alone, against ~1 ms for the conversion itself — nearly all of the
-- function's 206–419 ms, and why the LIGHTER account was the slower one.
--
-- Now: the name's shape is checked (a zone NAME, as a browser's
-- Intl.DateTimeFormat sends, never an abbreviation or an offset — the old check
-- refused those too, since pg_timezone_names lists neither), and AT TIME ZONE
-- itself refuses a name it does not know, with the same 22023 as before.
-- Nothing else in the function changes; the proof requires the same answer, to
-- the byte, for a real exam account with practice in range.
--
-- ROLLBACK: rollback/20261136000000_a_time_zone_is_checked_without_reading_every_zone_file.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── Before: the live function's answer for a real exam account ─────────────
DO $before$
DECLARE
  _uid uuid;
  _r jsonb;
BEGIN
  SELECT qa.user_id INTO _uid
    FROM public.question_attempts qa
    JOIN public.memberships m ON m.account_id = qa.user_id
    JOIN public.schools s ON s.id = m.school_id AND s.kind = 'individual'
   WHERE qa.created_at >= date_trunc('month', now()) - interval '1 month'
   GROUP BY qa.user_id
   ORDER BY count(*) DESC, qa.user_id
   LIMIT 1;
  IF _uid IS NULL THEN
    RAISE EXCEPTION '20261136000000: no exam account with practice since last month to prove against';
  END IF;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';
  _r := public.rpc_student_practice_time('Asia/Kolkata');
  EXECUTE 'RESET ROLE';
  PERFORM set_config('gurukul.m20261136_uid', _uid::text, true);
  PERFORM set_config('gurukul.m20261136_before', _r::text, true);
END
$before$;

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
  -- A real zone NAME — "Area/Location", or UTC, GMT, Etc/… — as the browser
  -- sends. Not an abbreviation ('IST' is Israel to this database) and not an
  -- offset ('UTC+5' counts the other way). Checked by shape, then by AT TIME
  -- ZONE itself, which refuses a name it does not know: pg_timezone_names read
  -- every zone file on disk on each call (150–790 ms, measured 2026-10-02).
  IF _tz IS NULL OR _tz !~ '^(UTC|GMT|Etc/[A-Za-z0-9+-]+|[A-Z][A-Za-z_]+(/[A-Za-z0-9_+-]+)+)$' THEN
    RAISE EXCEPTION 'unknown time zone: %', _tz USING ERRCODE = '22023';
  END IF;
  BEGIN
    _today := (now() AT TIME ZONE _tz)::date;
  EXCEPTION WHEN invalid_parameter_value THEN
    RAISE EXCEPTION 'unknown time zone: %', _tz USING ERRCODE = '22023';
  END;
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

-- ── Proof, as that account ─────────────────────────────────────────────────
DO $proof$
DECLARE
  _uid uuid := current_setting('gurukul.m20261136_uid')::uuid;
  _before jsonb := current_setting('gurukul.m20261136_before')::jsonb;
  _r jsonb;
  _bad text;
BEGIN
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid, 'role', 'authenticated')::text, true);
  EXECUTE 'SET LOCAL ROLE authenticated';

  -- 1. The same answer.
  _r := public.rpc_student_practice_time('Asia/Kolkata');
  IF _r IS DISTINCT FROM _before THEN
    RAISE EXCEPTION '20261136000000: the answer changed: % vs %', left(_r::text, 300), left(_before::text, 300);
  END IF;
  -- CONTROL: the comparison is of real practice, not of two empty answers.
  IF jsonb_array_length(_before->'days') = 0 OR jsonb_array_length(_before->'hours') <> 24 THEN
    RAISE EXCEPTION '20261136000000: the probe account had nothing to compare (%)', left(_before::text, 200);
  END IF;
  -- The zone-file view is gone from the function. (The speed itself is
  -- measured outside, before and after: one timing inside a transaction is
  -- too noisy to gate on — a planted copy of the old check passed one.)
  IF pg_get_functiondef('public.rpc_student_practice_time(text)'::regprocedure) ~* 'from[[:space:]]+pg_timezone_names' THEN
    RAISE EXCEPTION '20261136000000: the function still reads pg_timezone_names';
  END IF;

  -- 2. Real zone names a browser sends are accepted.
  PERFORM public.rpc_student_practice_time('UTC');
  PERFORM public.rpc_student_practice_time('America/Argentina/Buenos_Aires');
  PERFORM public.rpc_student_practice_time('America/Port-au-Prince');
  PERFORM public.rpc_student_practice_time('Etc/GMT-5');

  -- 3. Refused with 22023, as before: unknown names, abbreviations, offsets, junk.
  FOREACH _bad IN ARRAY ARRAY['Not/AZone', 'IST', 'UTC+5', '+05:30', '', 'asia/kolkata', 'Asia/Kolkata; select 1'] LOOP
    BEGIN
      PERFORM public.rpc_student_practice_time(_bad);
      RAISE EXCEPTION '20261136000000: % was accepted', quote_literal(_bad) USING ERRCODE = 'P0001';
    EXCEPTION WHEN invalid_parameter_value THEN
      NULL;
    END;
  END LOOP;
  BEGIN
    PERFORM public.rpc_student_practice_time(NULL);
    RAISE EXCEPTION '20261136000000: NULL was accepted' USING ERRCODE = 'P0001';
  EXCEPTION WHEN invalid_parameter_value THEN
    NULL;
  END;

  EXECUTE 'RESET ROLE';
END
$proof$;

COMMIT;
