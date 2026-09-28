-- ===========================================================================
-- A BROKEN PRACTICE STREAK IS ZERO
--
-- Owner's ruling (2026-09-28, KNOWN_ISSUES 87): when a student misses a day,
-- their practice streak turns to zero.
--
-- The defect. student_xp.study_streak is written in exactly one place,
-- _progression_bump_study_streak (20260802310000), and only when the student
-- FINISHES a practice session. Nothing ever lowers it in between. A student
-- with a 12-day streak who stops practising reads "12-day practice streak"
-- on Analysis, Home, Profile, the parent's page, the leaderboard's streak
-- board and the principal's average — for a week, a month, until the next
-- session, at which point the writer's ELSE branch finally sets it to 1. The
-- break was only ever recorded by the next practice, never by the missed day.
--
-- Where the fix goes. Every one of those readers reads the stored column
-- (rpc_get_student_progression, rpc_leaderboard, the principal and admin
-- summaries, the raw student_xp row the Battleground and the academic
-- snapshot read). Teaching each reader "unless last_study_date is old" would
-- put the same rule in six homes. The stored number is what is wrong, so the
-- stored number is what is fixed: a daily job zeroes every streak whose last
-- practice day is before yesterday, and every reader is right for free.
--
-- The rule is the writer's own. _progression_bump_study_streak continues a
-- streak when last_study_date = today - 1 and restarts it otherwise, on
-- CURRENT_DATE of this database (UTC). The job zeroes exactly the rows the
-- writer would restart: last_study_date < CURRENT_DATE - 1, on the same
-- CURRENT_DATE. A streak whose last day is yesterday is still alive — today
-- is not over — and is left alone. streak_protection_tokens are not consulted
-- because the writer does not consult them either; a token that saved a
-- streak would have to save it in the writer first.
--
-- study_week_streak and study_month_streak are the same consecutive-day run,
-- capped at 7 and 31 (they only feed the perfect-week/month awards), so they
-- break with it. study_longest_streak is a record, not a current run, and
-- last_study_date is a fact; neither is touched.
--
-- Scheduled at 00:01 UTC, one minute after the day the writer counts turns
-- over. Run once here as well, so the streaks already stale today read zero
-- the moment this is applied rather than tomorrow.
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.reset_broken_study_streaks()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  _n integer;
BEGIN
  UPDATE public.student_xp SET
    study_streak       = 0,
    study_week_streak  = 0,
    study_month_streak = 0,
    updated_at         = now()
  WHERE (study_streak > 0 OR study_week_streak > 0 OR study_month_streak > 0)
    AND (last_study_date IS NULL OR last_study_date < CURRENT_DATE - 1);
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END;
$function$;

COMMENT ON FUNCTION public.reset_broken_study_streaks() IS
  'Zeroes the current practice streak of every student who did not practise today or yesterday (KNOWN_ISSUES 87). Same day rule as _progression_bump_study_streak. Cron: reset-broken-study-streaks.';

REVOKE ALL ON FUNCTION public.reset_broken_study_streaks() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reset_broken_study_streaks() FROM anon, authenticated;

-- Unscheduled first so re-applying this migration cannot leave two jobs.
DO $cron$
BEGIN
  PERFORM cron.unschedule('reset-broken-study-streaks');
EXCEPTION WHEN OTHERS THEN
  NULL;   -- not scheduled yet
END
$cron$;

SELECT cron.schedule('reset-broken-study-streaks', '1 0 * * *', $$SELECT public.reset_broken_study_streaks();$$);

-- ── THE PROOF ────────────────────────────────────────────────────────────
--
-- Sets four real students' streak rows, runs the job, measures, and ROLLS
-- BACK everything it wrote by raising inside a sub-block. Failing six ways:
--
--   1. Last practised two days ago, streak 12  -> 0 (the ruling).
--   2. No last day recorded, streak 3          -> 0.
--   3. CONTROL: practised yesterday, streak 5  -> still 5. Without it, a job
--      that zeroed everybody would pass 1 and 2.
--   4. CONTROL: practised today, streak 7      -> still 7.
--   5. The record and the fact survive: longest streak and last day unchanged.
--   6. The writer agrees: a session finished today by the zeroed student
--      makes the streak 1 — and by the student who practised yesterday, 6.
DO $proof$
DECLARE
  _u uuid[];
  _broken int; _nodate int; _yday int; _today int;
  _broken_wk int; _broken_mo int; _longest int; _last date;
  _after_broken int; _after_yday int;
BEGIN
  SELECT array_agg(user_id) INTO _u FROM (
    SELECT s.user_id FROM public.students s
     WHERE s.user_id IS NOT NULL
     ORDER BY s.created_at LIMIT 4) q;
  IF coalesce(array_length(_u, 1), 0) < 4 THEN
    RAISE EXCEPTION 'fewer than four students to prove this with';
  END IF;

  BEGIN
    PERFORM public._ensure_student_xp(_u[i]) FROM generate_series(1, 4) i;
    UPDATE public.student_xp SET study_streak = 12, study_week_streak = 7, study_month_streak = 12,
           study_longest_streak = 20, last_study_date = CURRENT_DATE - 2 WHERE user_id = _u[1];
    UPDATE public.student_xp SET study_streak = 3, study_week_streak = 3, study_month_streak = 3,
           last_study_date = NULL WHERE user_id = _u[2];
    UPDATE public.student_xp SET study_streak = 5, study_week_streak = 5, study_month_streak = 5,
           last_study_date = CURRENT_DATE - 1 WHERE user_id = _u[3];
    UPDATE public.student_xp SET study_streak = 7, study_week_streak = 7, study_month_streak = 7,
           last_study_date = CURRENT_DATE WHERE user_id = _u[4];

    PERFORM public.reset_broken_study_streaks();

    SELECT study_streak, study_week_streak, study_month_streak, study_longest_streak, last_study_date
      INTO _broken, _broken_wk, _broken_mo, _longest, _last
      FROM public.student_xp WHERE user_id = _u[1];
    SELECT study_streak INTO _nodate FROM public.student_xp WHERE user_id = _u[2];
    SELECT study_streak INTO _yday  FROM public.student_xp WHERE user_id = _u[3];
    SELECT study_streak INTO _today FROM public.student_xp WHERE user_id = _u[4];

    PERFORM public._progression_bump_study_streak(_u[1]);
    PERFORM public._progression_bump_study_streak(_u[3]);
    SELECT study_streak INTO _after_broken FROM public.student_xp WHERE user_id = _u[1];
    SELECT study_streak INTO _after_yday  FROM public.student_xp WHERE user_id = _u[3];

    RAISE EXCEPTION 'proof_rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proof_rollback' THEN RAISE; END IF;
  END;

  IF _broken <> 0 OR _broken_wk <> 0 OR _broken_mo <> 0 THEN
    RAISE EXCEPTION 'a streak last practised two days ago reads %/%/%, expected 0/0/0', _broken, _broken_wk, _broken_mo;
  END IF;
  IF _nodate <> 0 THEN RAISE EXCEPTION 'a streak with no last day reads %, expected 0', _nodate; END IF;
  IF _yday <> 5 THEN RAISE EXCEPTION 'CONTROL FAILED: practised yesterday and the streak reads %, expected 5', _yday; END IF;
  IF _today <> 7 THEN RAISE EXCEPTION 'CONTROL FAILED: practised today and the streak reads %, expected 7', _today; END IF;
  IF _longest <> 20 OR _last IS DISTINCT FROM CURRENT_DATE - 2 THEN
    RAISE EXCEPTION 'the reset changed the record (longest %) or the fact (last day %)', _longest, _last;
  END IF;
  IF _after_broken <> 1 THEN RAISE EXCEPTION 'practising after the reset gave a streak of %, expected 1', _after_broken; END IF;
  IF _after_yday <> 6 THEN RAISE EXCEPTION 'practising the day after yesterday gave %, expected 6', _after_yday; END IF;

  IF has_function_privilege('authenticated', 'public.reset_broken_study_streaks()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.reset_broken_study_streaks()', 'EXECUTE') THEN
    RAISE EXCEPTION 'a signed-in or anonymous caller can run the reset';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'reset-broken-study-streaks'
                   AND command LIKE '%reset_broken_study_streaks()%') THEN
    RAISE EXCEPTION 'the cron job is not scheduled';
  END IF;
END
$proof$;

-- The streaks already stale today read zero from now, not from tomorrow.
SELECT public.reset_broken_study_streaks();

COMMIT;
