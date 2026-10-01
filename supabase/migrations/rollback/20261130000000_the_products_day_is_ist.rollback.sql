-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: the streak back on the database's clock
--
-- Restores the three functions and the reset's schedule from what
-- 20261130000000 saved, then drops public._product_day. Note what you are
-- restoring: the streak counts UTC days and resets at 05:31 IST, while the plan
-- allowances reset at midnight IST (KNOWN_ISSUES 105).
--
-- Undoes: 20261130000000_the_products_day_is_ist.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE r record; _sched text;
BEGIN
  FOR r IN SELECT definition FROM public.routines_pre_20261130000000 WHERE object LIKE 'public.%' LOOP
    EXECUTE r.definition;
  END LOOP;
  SELECT definition INTO _sched FROM public.routines_pre_20261130000000 WHERE object = 'cron:reset-broken-study-streaks';
  IF _sched IS NULL THEN RAISE EXCEPTION 'no saved schedule — cannot restore'; END IF;
  PERFORM cron.alter_job(j.jobid, schedule => _sched) FROM cron.job j WHERE j.jobname = 'reset-broken-study-streaks';
END
$restore$;

DROP FUNCTION public._product_day(timestamptz);
DROP TABLE public.routines_pre_20261130000000;

DELETE FROM public.schema_migrations WHERE version = '20261130000000_the_products_day_is_ist';

COMMIT;
