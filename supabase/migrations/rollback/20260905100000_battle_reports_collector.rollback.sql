-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — the battle report collector is removed
--
-- After this, `battle_reports.expires_at` goes back to being a UI gate with
-- nothing behind it: `BattleReportView.tsx:151` still tells the student the
-- analytics are available for 24 hours, and the rows stay forever. That was the
-- state on 2026-09-05, when one row four weeks past its own expiry was still
-- present.
--
-- ⚠ WHAT THIS DOES NOT DO: it does not bring back rows the collector has
-- already deleted. Those are gone, which is the designed behaviour of an
-- ephemeral report — the rollback restores the ABSENCE of a collector, not the
-- data one collected. If a report was needed after expiry, this rollback is not
-- the remedy and there isn't one; the window is the product decision.
--
-- Nothing durable is affected either way. XP and league live in
-- progression_history / student_xp and the winner in battles.status, all
-- written by rpc_finish_battle, which never touches this table.
--
-- WHAT GOES RED, and should:
--   · probe8 "100000 collector removes an EXPIRED report"
--   · probe8 "100000 collector refuses a signed-in caller"
-- Run `npm run verify:caller-privileges` afterwards so the regression is
-- recorded rather than discovered.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

SELECT cron.unschedule(jobid) FROM cron.job WHERE jobname = 'purge-expired-battle-reports';

DROP FUNCTION IF EXISTS public.rpc_purge_expired_battle_reports();

-- Assert the INVERSE of the forward check, so a half-applied reversal fails
-- loudly rather than leaving a job pointing at a function that is gone.
DO $verify$
DECLARE _jobs int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc
              WHERE proname = 'rpc_purge_expired_battle_reports'
                AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'rollback incomplete: the collector function still exists';
  END IF;

  SELECT count(*) INTO _jobs FROM cron.job WHERE jobname = 'purge-expired-battle-reports';
  IF _jobs <> 0 THEN
    RAISE EXCEPTION 'rollback incomplete: % cron job(s) still reference the collector', _jobs;
  END IF;
END $verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20260905100000_battle_reports_collector';

COMMIT;
