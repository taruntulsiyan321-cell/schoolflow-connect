-- ═══════════════════════════════════════════════════════════════════════════
-- THE PRODUCT'S DAY IS IST
-- ═══════════════════════════════════════════════════════════════════════════
--
-- KNOWN_ISSUES 105. The study streak counted days on the database's clock
-- (UTC): _progression_bump_study_streak defaulted its day to CURRENT_DATE, and
-- reset_broken_study_streaks compared with CURRENT_DATE at 00:01 UTC — 05:31
-- IST. So an Indian student's practice between midnight and 05:30 counted for
-- the day before, and the nightly reset landed in the middle of their morning.
-- The plan allowances, meanwhile, already reset at midnight IST
-- (_premium_period_key, 20261111000000). Two day-rules in one product.
--
-- RULED (the owner, 2026-10-01: "fix everything"; the option KNOWN_ISSUES 105
-- named, and the one the plans already follow): the product's day is the
-- calendar day in India, Asia/Kolkata. It has ONE home, public._product_day(),
-- and the streak writer, the nightly reset and the plan allowances' day and
-- month keys all read it. The reset now runs at 00:01 IST (18:31 UTC).
--
-- Analysis's own time panels keep the browser's zone (20261115000000): they
-- show a student their own calendar, which for every student today is IST
-- (0 of 287 exam-account attempts fall between 00:00 and 05:30 IST — and those
-- are now on the same day either way).
--
-- ROLLBACK: rollback/20261130000000_the_products_day_is_ist.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE public.routines_pre_20261130000000 (
  object text PRIMARY KEY,
  definition text NOT NULL
);
ALTER TABLE public.routines_pre_20261130000000 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.routines_pre_20261130000000 FROM anon, authenticated;
COMMENT ON TABLE public.routines_pre_20261130000000 IS
  'Rollback source for 20261130000000: the three functions as they were, and the reset''s schedule (object cron:reset-broken-study-streaks). No policy and no grant to anon or authenticated. Drop once that deployment is accepted.';
INSERT INTO public.routines_pre_20261130000000 (object, definition)
SELECT o, pg_get_functiondef(o::regprocedure)
  FROM unnest(ARRAY[
    'public._progression_bump_study_streak(uuid,date)',
    'public.reset_broken_study_streaks()',
    'public._premium_period_key(text,timestamp with time zone)']) AS o
UNION ALL
SELECT 'cron:reset-broken-study-streaks', schedule FROM cron.job WHERE jobname = 'reset-broken-study-streaks';

-- What the plan keys are today, at instants either side of both midnights,
-- so the proof can require the refactor to change none of them.
CREATE TEMP TABLE _keys_before ON COMMIT DROP AS
SELECT t AS at, p AS period, public._premium_period_key(p, t) AS k
  FROM unnest(ARRAY[
         timestamptz '2026-10-01 18:29:59+00', timestamptz '2026-10-01 18:30:00+00',
         timestamptz '2026-10-01 23:59:59+00', timestamptz '2026-10-02 00:00:00+00',
         timestamptz '2026-10-31 18:29:59+00', timestamptz '2026-10-31 18:30:00+00',
         now()]) AS t,
       unnest(ARRAY['day', 'month', 'lifetime']) AS p;

-- ── The one home ───────────────────────────────────────────────────────────
CREATE FUNCTION public._product_day(_at timestamptz DEFAULT now())
RETURNS date
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $f$
  SELECT (_at AT TIME ZONE 'Asia/Kolkata')::date
$f$;
COMMENT ON FUNCTION public._product_day(timestamptz) IS
  'The product''s calendar day: the date in India (Asia/Kolkata). The one home of that rule (20261130000000) — the study streak, its nightly reset and the plan allowances'' day and month keys read it.';
REVOKE ALL ON FUNCTION public._product_day(timestamptz) FROM PUBLIC, anon, authenticated;

-- ── Its readers ────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._premium_period_key(_period text, _at timestamp with time zone DEFAULT now())
 RETURNS text
 LANGUAGE sql
 STABLE
 SET search_path TO 'public'
AS $function$
  -- The day and the month are the product's (public._product_day, IST).
  SELECT CASE _period
    WHEN 'day'      THEN 'd:' || to_char(public._product_day(_at), 'YYYY-MM-DD')
    WHEN 'month'    THEN 'm:' || to_char(public._product_day(_at), 'YYYY-MM')
    WHEN 'lifetime' THEN 'l'
  END
$function$;

DO $edit$
DECLARE _def text; _n int;
  _old constant text := '_on date DEFAULT CURRENT_DATE)';
  _new constant text := '_on date DEFAULT public._product_day())';
BEGIN
  _def := replace(pg_get_functiondef('public._progression_bump_study_streak(uuid,date)'::regprocedure), E'\r\n', E'\n');
  _n := (length(_def) - length(replace(_def, _old, ''))) / length(_old);
  IF _n <> 1 THEN RAISE EXCEPTION 'streak bump: expected its CURRENT_DATE default once, found %', _n; END IF;
  EXECUTE replace(_def, _old, _new);
END
$edit$;

CREATE OR REPLACE FUNCTION public.reset_broken_study_streaks()
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _n integer;
BEGIN
  -- A streak is broken when the last study day is before yesterday — both
  -- counted in the product's day (public._product_day, IST).
  UPDATE public.student_xp SET
    study_streak       = 0,
    study_week_streak  = 0,
    study_month_streak = 0,
    updated_at         = now()
  WHERE (study_streak > 0 OR study_week_streak > 0 OR study_month_streak > 0)
    AND (last_study_date IS NULL OR last_study_date < public._product_day() - 1);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

-- 00:01 in India is 18:31 UTC the evening before.
SELECT cron.alter_job(j.jobid, schedule => '31 18 * * *')
  FROM cron.job j WHERE j.jobname = 'reset-broken-study-streaks';

-- ── THE PROOF ─────────────────────────────────────────────────────────────
DO $proof$
DECLARE _n int; _uid uuid; _streak int; _last date;
BEGIN
  -- 1. The product's day turns at midnight IST, not UTC.
  IF public._product_day(timestamptz '2026-10-01 18:29:59+00') <> date '2026-10-01'
     OR public._product_day(timestamptz '2026-10-01 18:30:00+00') <> date '2026-10-02' THEN
    RAISE EXCEPTION '_product_day does not turn at midnight IST';
  END IF;

  -- 2. No plan key moved: every period at every instant is what it was.
  SELECT count(*) INTO _n FROM _keys_before b
   WHERE public._premium_period_key(b.period, b.at) IS DISTINCT FROM b.k;
  IF _n <> 0 THEN RAISE EXCEPTION '% plan period key(s) changed', _n; END IF;

  -- 3. The writer and the reset read the one home; nothing restates the zone.
  IF position('_product_day()' IN pg_get_functiondef('public._progression_bump_study_streak(uuid,date)'::regprocedure)) = 0
     OR position('_product_day()' IN pg_get_functiondef('public.reset_broken_study_streaks()'::regprocedure)) = 0
     OR position('CURRENT_DATE' IN pg_get_functiondef('public.reset_broken_study_streaks()'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'a streak function does not read _product_day';
  END IF;
  IF position('Asia/Kolkata' IN pg_get_functiondef('public._premium_period_key(text,timestamp with time zone)'::regprocedure)) > 0 THEN
    RAISE EXCEPTION 'the plan keys still restate the zone';
  END IF;

  -- 4. The reset runs at 00:01 IST.
  IF (SELECT schedule FROM cron.job WHERE jobname = 'reset-broken-study-streaks') <> '31 18 * * *' THEN
    RAISE EXCEPTION 'the reset is not scheduled at 00:01 IST';
  END IF;

  -- 5. Behaviour, on a real student, rolled back: a study day of "yesterday in
  --    India" continues the streak; the day before that resets it.
  SELECT x.user_id INTO _uid FROM public.student_xp x ORDER BY x.updated_at DESC NULLS LAST LIMIT 1;
  IF _uid IS NULL THEN RAISE EXCEPTION 'NO FIXTURE: no student_xp row'; END IF;
  BEGIN
    UPDATE public.student_xp SET study_streak = 3, last_study_date = public._product_day() - 1 WHERE user_id = _uid;
    PERFORM public._progression_bump_study_streak(_uid);
    SELECT study_streak, last_study_date INTO _streak, _last FROM public.student_xp WHERE user_id = _uid;
    IF _streak <> 4 OR _last <> public._product_day() THEN
      RAISE EXCEPTION 'a study day after yesterday-in-India gave streak % on %, not 4 on %', _streak, _last, public._product_day();
    END IF;
    UPDATE public.student_xp SET study_streak = 3, last_study_date = public._product_day() - 2 WHERE user_id = _uid;
    PERFORM public.reset_broken_study_streaks();
    SELECT study_streak INTO _streak FROM public.student_xp WHERE user_id = _uid;
    IF _streak <> 0 THEN RAISE EXCEPTION 'a streak last studied two Indian days ago was not reset (%)', _streak; END IF;
    RAISE EXCEPTION 'STREAK_PROOF_OK';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'STREAK_PROOF_OK' THEN RAISE; END IF;
  END;
END
$proof$;

INSERT INTO public.schema_migrations (version)
VALUES ('20261130000000_the_products_day_is_ist')
ON CONFLICT (version) DO NOTHING;

COMMIT;
