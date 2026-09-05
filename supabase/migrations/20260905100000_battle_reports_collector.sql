-- ═══════════════════════════════════════════════════════════════════════════
-- battle_reports gets the collector its 24-hour gate always implied
--
-- ── THE DEFECT ───────────────────────────────────────────────────────────
--
-- `battle_reports.expires_at` has existed since the feature shipped, and
-- `BattleReportView.tsx:151` tells the student "Detailed battle analytics are
-- available for 24 hours after each battle". Both halves of that sentence were
-- true in the UI and neither was true in the database: nothing has ever deleted
-- an expired row.
--
-- Measured before writing this: one row, `expires_at = 2026-08-07`, still
-- present roughly four weeks past its own expiry. The 24 hours was a UI gate
-- with no collector behind it — the report was hidden, never gone.
--
-- This is the precedent the parked test report (rules 12-15) would have
-- inherited, which is why it is fixed before that feature is scheduled rather
-- than after.
--
-- ── WHY DELETING IS SAFE HERE, CHECKED RATHER THAN ASSUMED ───────────────
--
-- The hazard the owner named is real: a collector that runs before the durable
-- record is written destroys the durable record. It does not apply here, and
-- the reason is structural rather than a matter of ordering.
--
--   rpc_finish_battle writes XP (through the progression path) and does NOT
--   write battle_reports at all — the report is generated lazily, later, by
--   rpc_ensure_battle_report.
--
-- So the durable outcomes never pass through this table:
--
--   XP and league      progression_history / student_xp, written at finish
--   who won            battles.status, written at finish
--   the ephemeral part battle_reports.report + ai_insights  ← only this expires
--
-- §10.8 is satisfied: the aggregate is computed at finish and stored, and what
-- expires is the per-battle detail the rule calls transient. Deleting an
-- expired report cannot orphan XP, a winner, or a mark.
--
-- ── WHY A DEDICATED JOB AND NOT A BRANCH IN rpc_purge_expired ────────────
--
-- rpc_purge_expired is the obvious home and is the wrong one, for a reason
-- that is easy to miss: IT IS NOT SCHEDULED. `cron.job` holds two entries —
-- featured battles and the parent digest — and neither runs it. A branch added
-- there would read as coverage and never execute, which is the exact failure
-- 20260904180000 removed the `tests` branch to avoid.
--
-- Scheduling rpc_purge_expired instead would start deleting soft-deleted
-- students, teachers and homework on a retention policy nobody has ruled on.
-- That is a much larger decision than this defect, so this migration takes the
-- narrow path: its own function, its own job, one table.
--
-- ── RETENTION IS THE ROW'S OWN expires_at, NOT A CONSTANT HERE ───────────
--
-- The window is whatever wrote the row; this job only enforces it. No literal
-- 24 appears below (rule 1) and changing the window stays a one-place change
-- wherever expires_at is set.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $premise$
BEGIN
  IF to_regclass('public.battle_reports') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.battle_reports does not exist';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='battle_reports' AND column_name='expires_at'
  ) THEN
    RAISE EXCEPTION 'ABORT: battle_reports has no expires_at; there is no window to enforce';
  END IF;
END $premise$;

CREATE OR REPLACE FUNCTION public.rpc_purge_expired_battle_reports()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _gone int;
BEGIN
  -- Same rule as rpc_purge_expired and rpc_send_parent_weekly_digests: a
  -- platform job with no per-user caller. It deletes across every institution
  -- by design, and there is no correct institution to scope it to — so a
  -- signed-in caller is refused rather than served a scoped subset.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_purge_expired_battle_reports is a scheduled job; it has no per-user caller and deletes across institutions by design';
  END IF;

  -- Strictly `<` now(): a row expiring exactly at this instant is still inside
  -- its window. Only the detail goes; XP, league and the winner live elsewhere
  -- and are untouched by this statement.
  WITH gone AS (
    DELETE FROM public.battle_reports
     WHERE expires_at IS NOT NULL
       AND expires_at < now()
    RETURNING 1
  ) SELECT count(*) INTO _gone FROM gone;

  RETURN jsonb_build_object(
    'battle_reports_purged', _gone,
    'remaining',             (SELECT count(*) FROM public.battle_reports),
    'ran_at',                now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_purge_expired_battle_reports() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_purge_expired_battle_reports() TO service_role;

-- ── The schedule ──────────────────────────────────────────────────────────
-- Hourly. The window is measured in hours, so a daily job would leave a report
-- readable for up to a day past its own stated expiry — which is the defect
-- this migration exists to close, one order of magnitude smaller.
SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-expired-battle-reports';
SELECT cron.schedule(
  'purge-expired-battle-reports',
  '20 * * * *',
  $cron$SELECT public.rpc_purge_expired_battle_reports();$cron$
);

-- ── Verification ──────────────────────────────────────────────────────────
DO $verify$
DECLARE _def text; _jobs int;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _def FROM pg_proc
   WHERE proname = 'rpc_purge_expired_battle_reports' AND pronamespace = 'public'::regnamespace;

  IF _def IS NULL THEN
    RAISE EXCEPTION 'ABORT: the collector was not created';
  END IF;
  IF _def !~ 'DELETE\s+FROM\s+public\.battle_reports' THEN
    RAISE EXCEPTION 'ABORT: the collector does not delete from battle_reports';
  END IF;
  IF _def !~* 'auth\.uid\(\) IS NOT NULL' THEN
    RAISE EXCEPTION 'ABORT: the collector does not refuse a per-user caller';
  END IF;
  -- It must key on the row's own window. A collector that deleted every row
  -- would also satisfy "deletes from battle_reports".
  IF _def !~ 'expires_at\s*<\s*now\(\)' THEN
    RAISE EXCEPTION 'ABORT: the collector does not key on expires_at';
  END IF;
  -- Nothing durable may be in its blast radius.
  IF _def ~* 'DELETE\s+FROM\s+public\.(battles|battle_participants|progression_history|student_xp)' THEN
    RAISE EXCEPTION 'ABORT: the collector reaches beyond the ephemeral report';
  END IF;

  SELECT count(*) INTO _jobs FROM cron.job
   WHERE jobname = 'purge-expired-battle-reports' AND active;
  IF _jobs <> 1 THEN
    RAISE EXCEPTION 'ABORT: expected exactly 1 active collector job, found %', _jobs;
  END IF;

  -- The privilege shape, asserted here only as a smoke check. The real proof
  -- that a signed-in caller is refused is probe8, run as that caller (rule 6).
  IF has_function_privilege('authenticated', 'public.rpc_purge_expired_battle_reports()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated can execute the collector';
  END IF;
END $verify$;

COMMIT;
