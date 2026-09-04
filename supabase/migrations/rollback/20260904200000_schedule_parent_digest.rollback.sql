-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — the parent weekly digest stops sending
--
-- Unschedules the pg_cron job. The digest functions stay; only the thing that
-- runs them goes.
--
-- WHAT THIS COSTS: §10.15's "sends automatically, no human check" is unmet
-- again. `useParentWeeklyDigest` still has no caller, so after this the digest
-- is unreachable from anywhere — exactly the state this pair of migrations was
-- written to end. Roll back only to stop a misfiring job, and expect the digest
-- to be silent until it is rescheduled.
--
-- No data is touched. Notification rows already sent are left alone: they are
-- correct summaries of real weeks, and deleting a parent's digest because the
-- schedule was withdrawn would be a worse lie than never having sent it.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE NOTICE 'pg_cron is not installed; nothing to unschedule';
    RETURN;
  END IF;

  PERFORM cron.unschedule('parent-weekly-digest')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'parent-weekly-digest');
END $$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron')
     AND EXISTS (SELECT 1 FROM cron.job WHERE command ~ 'rpc_send_parent_weekly_digests') THEN
    RAISE EXCEPTION 'rollback incomplete: a job still calls rpc_send_parent_weekly_digests';
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260904200000_schedule_parent_digest';

COMMIT;
