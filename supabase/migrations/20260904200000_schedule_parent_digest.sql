-- ═══════════════════════════════════════════════════════════════════════════
-- The parent weekly digest is scheduled
--
-- §10.15: "sends automatically, no human check". Until now nothing ran it —
-- pg_cron was installed and held exactly one job (rpc_refresh_featured_battles,
-- hourly), so the infrastructure was never the blocker. Wiring was.
--
-- ── THE TIME IS A DECISION, AND IT IS RECORDED HERE ──────────────────────
--
-- The spec says "weekly" and does not say when, so this picks one and says so
-- rather than leaving a bare cron string for the next reader to reverse
-- engineer.
--
--   30 1 * * 1   →  Mondays at 01:30 UTC  =  07:00 IST
--
-- Monday morning, before the school day, so the week just ended is summarised
-- while it is still the thing a parent is thinking about. pg_cron schedules in
-- the server's timezone, which is UTC here; the IST conversion is the number
-- that actually matters and is why it is written down.
--
-- ── WHY UNSCHEDULE-THEN-SCHEDULE ─────────────────────────────────────────
--
-- cron.schedule() with the same jobname replaces, but only if the name matches
-- exactly. Unscheduling by name first makes re-running this migration
-- idempotent and makes a renamed job impossible to leave behind running the old
-- body on the old timetable.
--
-- ── WHAT RUNS ────────────────────────────────────────────────────────────
--
-- rpc_send_parent_weekly_digests() writes ONE notification per parent who has
-- at least one linked child, and skips the rest. It refuses any caller with
-- auth.uid() set, so it cannot be invoked by a signed-in user to fan out
-- notifications across schools; a cron job has no auth.uid() and passes. It is
-- also granted to service_role only, so the refusal is not the only guard.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    RAISE EXCEPTION
      'ABORT: pg_cron is not installed, so the digest would silently never send. Install it or do not claim this is scheduled.';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE proname = 'rpc_send_parent_weekly_digests'
                    AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'ABORT: rpc_send_parent_weekly_digests does not exist; apply 20260904190000 first';
  END IF;

  PERFORM cron.unschedule('parent-weekly-digest')
   WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'parent-weekly-digest');

  PERFORM cron.schedule(
    'parent-weekly-digest',
    '30 1 * * 1',
    'SELECT public.rpc_send_parent_weekly_digests();'
  );
END $$;

-- ── Verification ──────────────────────────────────────────────────────────
DO $$
DECLARE _j record;
BEGIN
  SELECT * INTO _j FROM cron.job WHERE jobname = 'parent-weekly-digest';

  IF _j IS NULL THEN
    RAISE EXCEPTION 'ABORT: the job was not registered';
  END IF;
  IF NOT _j.active THEN
    RAISE EXCEPTION 'ABORT: the job is registered but inactive, which sends nothing';
  END IF;
  IF _j.schedule <> '30 1 * * 1' THEN
    RAISE EXCEPTION 'ABORT: unexpected schedule %', _j.schedule;
  END IF;
  IF _j.command !~ 'rpc_send_parent_weekly_digests' THEN
    RAISE EXCEPTION 'ABORT: the job does not call the sender: %', _j.command;
  END IF;

  -- Exactly one. A duplicate under another name would double every parent's
  -- notification and be invisible from this one.
  IF (SELECT count(*) FROM cron.job WHERE command ~ 'rpc_send_parent_weekly_digests') <> 1 THEN
    RAISE EXCEPTION 'ABORT: % job(s) call the digest sender; expected exactly 1',
      (SELECT count(*) FROM cron.job WHERE command ~ 'rpc_send_parent_weekly_digests');
  END IF;
END $$;

COMMIT;
