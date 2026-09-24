-- ROLLBACK 20261057000000 — stops the daily revision/recovery reminder.
--
-- THIS RESTORES THE DEFECT: a chapter falls due, and a week overdue, and
-- nothing tells the student (§4.1b, §5, §9 all ask for it).
--
-- The cron job goes and the function goes. Reminders already delivered are
-- left where they are: they are the student's own notifications, and deleting
-- somebody's past messages to undo a feature is not a rollback.

DO $cron$
BEGIN
  PERFORM cron.unschedule('learning-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;   -- already gone
END
$cron$;

DROP FUNCTION IF EXISTS public.send_learning_reminders();

-- Fail closed: neither the job nor the function may survive this.
DO $check$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'learning-reminders') THEN
    RAISE EXCEPTION 'the learning-reminders cron job is still scheduled';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'send_learning_reminders'
  ) THEN
    RAISE EXCEPTION 'send_learning_reminders still exists';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261057000000_one_reminder_a_day_for_the_revision_and_recovery_waiting';
