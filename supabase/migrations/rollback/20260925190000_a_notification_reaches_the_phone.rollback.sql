-- Rollback for 20260925190000_a_notification_reaches_the_phone.
--
-- Removes the push queue: the schedule, the dispatch, the claim, the insert
-- trigger, `notifications.pushed_at` and its index, the recipient index on
-- `device_tokens` if this migration created it, and the vault secret — and
-- `pg_net`, which the migration installed, unless something else now calls it.
--
-- WHAT REVERTING COSTS: no notification reaches a closed app again. The
-- `notification-push` edge function stays deployed and answers nothing: with
-- no claim function it returns 500, and nothing calls it. Delete it with
-- `supabase functions delete notification-push` to finish the rollback.

DO $pre$
BEGIN
  IF to_regprocedure('public.dispatch_notification_push()') IS NULL
     OR to_regprocedure('public.claim_notifications_for_push(integer)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: 20260925190000 is not applied here';
  END IF;
END
$pre$;

SELECT cron.unschedule('push-notifications-to-phones')
 WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-notifications-to-phones');

DROP TRIGGER notification_push_queue ON public.notifications;
DROP FUNCTION public.tg_notification_push_queue();
DROP FUNCTION public.claim_notifications_for_push(integer);
DROP FUNCTION public.dispatch_notification_push();
DROP INDEX public.notifications_waiting_for_push_idx;
DROP INDEX IF EXISTS public.device_tokens_push_recipient_idx;
ALTER TABLE public.notifications DROP COLUMN pushed_at;
DELETE FROM vault.secrets WHERE name = 'notification_push_drain';

DO $net$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_net') THEN
    IF EXISTS (SELECT 1 FROM cron.job WHERE command ~* 'net\.http_')
       OR EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                   WHERE n.nspname NOT IN ('net', 'pg_catalog', 'information_schema')
                     AND p.prosrc ~* 'net\.http_(post|get)') THEN
      RAISE NOTICE 'pg_net kept: something other than 20260925190000 calls it now';
    ELSE
      DROP EXTENSION pg_net;
    END IF;
  END IF;
END
$net$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'public' AND table_name = 'notifications' AND column_name = 'pushed_at')
     OR to_regprocedure('public.dispatch_notification_push()') IS NOT NULL
     OR to_regprocedure('public.claim_notifications_for_push(integer)') IS NOT NULL
     OR to_regprocedure('public.tg_notification_push_queue()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'notification_push_queue')
     OR EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-notifications-to-phones')
     OR EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'notification_push_drain') THEN
    RAISE EXCEPTION 'ROLLED BACK: part of the push queue is still in place';
  END IF;
  RAISE NOTICE 'rollback OK: the push queue, its schedule and its secret are gone';
END
$verify$;
