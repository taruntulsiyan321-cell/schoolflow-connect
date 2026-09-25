-- ROLLBACK of 20261102000000_one_reminder_a_day_for_the_revision_and_recovery_waiting:
-- the daily job unscheduled and the function dropped. Reminders already sent
-- stay in the students' notifications — they were delivered.

BEGIN;

DO $cron$
BEGIN
  PERFORM cron.unschedule('learning-reminders');
EXCEPTION WHEN OTHERS THEN
  NULL;
END
$cron$;

DROP FUNCTION IF EXISTS public.send_learning_reminders();

DELETE FROM public.schema_migrations WHERE version = '20261102000000_one_reminder_a_day_for_the_revision_and_recovery_waiting';

COMMIT;
