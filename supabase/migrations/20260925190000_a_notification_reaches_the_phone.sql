-- ═══════════════════════════════════════════════════════════════════════════
-- A notification reaches the phone
--
-- Asked 2026-09-15: does homework reach "the particular student's parents'
-- phone or the particular student's phone". Measured on live the same day:
--
--   * Every notification is a row in `notifications`, and a signed-in student
--     or parent sees it the moment it is written (realtime) — on a phone as on
--     a laptop, while the app is open.
--   * With the app closed, nothing arrives. The Android app registers each
--     phone's FCM token in `device_tokens`, and `send-push` reaches FCM with the
--     project's service account — but only a direct message or an admin
--     broadcast ever called it. No homework, test, exam, decision or notice was
--     ever sent to a phone, and `pg_net` was not installed, so the database
--     could not have called out.
--   * `device_tokens` holds 0 rows: no phone has registered yet.
--
-- ── WHAT CHANGES ──────────────────────────────────────────────────────────
--
-- Every notification written for someone with a registered phone is sent to
-- that phone, once, within about a minute — whatever wrote it:
--
--   1. `notifications.pushed_at` — when a row was settled for the phone: sent,
--      or judged not to need sending. Rows already written are history, not
--      news: they take this migration's time through a column default, so no
--      row is rewritten and no realtime event fires, and the default is then
--      dropped.
--   2. `tg_notification_push_queue` — on insert, a row for someone with no
--      registered phone is settled at once; anyone else's waits (NULL).
--   3. `claim_notifications_for_push(limit)` — service_role only. Settles and
--      returns the waiting rows younger than 30 minutes, each with its
--      recipient's device tokens, locked SKIP LOCKED so two senders never send
--      one twice.
--   4. `dispatch_notification_push()` — every minute, from pg_cron. Settles
--      whatever has waited 30 minutes (a phone told half an hour late is told
--      something stale), and when anything is still waiting calls the
--      `notification-push` edge function through pg_net, carrying the vault
--      secret `notification_push_drain`.
--   5. That secret is generated here, into vault, and appears nowhere else in
--      this file. The deploy copies it into the function's
--      NOTIFICATION_PUSH_DRAIN secret; the function refuses every call without
--      it (it runs with verify_jwt off, because the database has no user to
--      sign for).
--
-- WHAT IT CANNOT DO: reach a phone that has not registered. That needs the
-- Android app installed and signed in, with notification permission granted.
--
-- Rollback: supabase/migrations/rollback/20260925190000_a_notification_reaches_the_phone.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 0. The database can call out ────────────────────────────────────────────

DO $net$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'pg_net') THEN
    CREATE EXTENSION IF NOT EXISTS pg_net;
  END IF;
  IF to_regprocedure('net.http_post(text,jsonb,jsonb,jsonb,integer)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: net.http_post(text,jsonb,jsonb,jsonb,integer) does not exist, so no notification could reach a phone. Install pg_net, then apply this migration.';
  END IF;
  IF to_regprocedure('cron.schedule(text,text,text)') IS NULL THEN
    RAISE EXCEPTION 'ABORT: cron.schedule(text,text,text) does not exist, so nothing would ever send. Install pg_cron, then apply this migration.';
  END IF;
END
$net$;

-- ── 1. When a notification was settled for the phone ────────────────────────

ALTER TABLE public.notifications ADD COLUMN pushed_at timestamptz DEFAULT now();
ALTER TABLE public.notifications ALTER COLUMN pushed_at DROP DEFAULT;
COMMENT ON COLUMN public.notifications.pushed_at IS
  'When this notification was settled for the recipient''s phones: sent by notification-push, or judged not to need sending (no phone registered, or 30 minutes old). NULL while it waits. Rows written before 20260925190000 carry that migration''s time.';

CREATE INDEX notifications_waiting_for_push_idx
  ON public.notifications (created_at) WHERE pushed_at IS NULL;

DO $idx$
BEGIN
  -- Every insert asks whether its recipient has a phone.
  IF NOT EXISTS (
    SELECT 1 FROM pg_index i
     WHERE i.indrelid = 'public.device_tokens'::regclass
       AND i.indkey[0] = (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.device_tokens'::regclass AND attname = 'user_id')
  ) THEN
    CREATE INDEX device_tokens_push_recipient_idx ON public.device_tokens (user_id);
  END IF;
END
$idx$;

-- ── 2. On arrival: waiting only for someone with a phone ────────────────────

CREATE FUNCTION public.tg_notification_push_queue()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Whatever the writer put in pushed_at is not trusted either way.
  NEW.pushed_at := CASE
    WHEN EXISTS (SELECT 1 FROM public.device_tokens d WHERE d.user_id = NEW.user_id) THEN NULL
    ELSE now()
  END;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.tg_notification_push_queue() FROM PUBLIC, anon, authenticated;

CREATE TRIGGER notification_push_queue
  BEFORE INSERT ON public.notifications
  FOR EACH ROW EXECUTE FUNCTION public.tg_notification_push_queue();

-- ── 3. The sender claims what is waiting ────────────────────────────────────

CREATE FUNCTION public.claim_notifications_for_push(_limit integer DEFAULT 500)
RETURNS TABLE (
  notification_id uuid,
  recipient uuid,
  title text,
  body text,
  link text,
  kind text,
  tokens text[]
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH due AS (
    SELECT n.id
      FROM public.notifications n
     WHERE n.pushed_at IS NULL
       AND n.created_at > now() - interval '30 minutes'
     ORDER BY n.created_at
     LIMIT greatest(1, least(coalesce(_limit, 500), 1000))
     FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.notifications n
       SET pushed_at = now()
      FROM due
     WHERE n.id = due.id
    RETURNING n.id, n.user_id, n.title, n.body, n.link, n.type
  )
  SELECT c.id, c.user_id, c.title, c.body, c.link, c.type, array_agg(DISTINCT d.token ORDER BY d.token)
    FROM claimed c
    JOIN public.device_tokens d ON d.user_id = c.user_id
   GROUP BY c.id, c.user_id, c.title, c.body, c.link, c.type
$$;
REVOKE ALL ON FUNCTION public.claim_notifications_for_push(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_notifications_for_push(integer) TO service_role;
COMMENT ON FUNCTION public.claim_notifications_for_push(integer) IS
  'notification-push''s claim (20260925190000): settles and returns waiting notifications younger than 30 minutes with their recipients'' device tokens, each exactly once. service_role only.';

-- ── 4. Once a minute: settle the stale, call the sender for the rest ────────

CREATE FUNCTION public.dispatch_notification_push()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _waiting integer;
  _drain text;
BEGIN
  UPDATE public.notifications
     SET pushed_at = now()
   WHERE pushed_at IS NULL
     AND created_at <= now() - interval '30 minutes';

  SELECT count(*) INTO _waiting FROM public.notifications WHERE pushed_at IS NULL;
  IF _waiting = 0 THEN
    RETURN 0;
  END IF;

  SELECT decrypted_secret INTO _drain FROM vault.decrypted_secrets WHERE name = 'notification_push_drain';
  IF _drain IS NULL THEN
    RAISE WARNING 'dispatch_notification_push: the vault secret notification_push_drain is missing; % notification(s) wait', _waiting;
    RETURN 0;
  END IF;

  PERFORM net.http_post(
    url := 'https://psqxykzqfvxgsvkmgurn.supabase.co/functions/v1/notification-push',
    body := '{}'::jsonb,
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-push-drain', _drain),
    timeout_milliseconds := 15000
  );
  RETURN _waiting;
END;
$$;
REVOKE ALL ON FUNCTION public.dispatch_notification_push() FROM PUBLIC, anon, authenticated;
COMMENT ON FUNCTION public.dispatch_notification_push() IS
  'Runs every minute (pg_cron job push-notifications-to-phones, 20260925190000): settles notifications 30 minutes old unsent, and calls notification-push when any still wait. Returns how many wait.';

-- ── 5. The secret the sender checks, and the schedule ───────────────────────

DO $secret$
DECLARE
  _value constant text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vault.secrets WHERE name = 'notification_push_drain') THEN
    IF to_regproc('vault.create_secret') IS NOT NULL THEN
      PERFORM vault.create_secret(_value, 'notification_push_drain',
        'Sent by dispatch_notification_push, checked by the notification-push edge function (its NOTIFICATION_PUSH_DRAIN secret). 20260925190000.');
    ELSE
      -- A database without supabase_vault's API (the local replica's shim).
      INSERT INTO vault.secrets (name, secret) VALUES ('notification_push_drain', _value);
    END IF;
  END IF;
END
$secret$;

SELECT cron.schedule('push-notifications-to-phones', '* * * * *', 'SELECT public.dispatch_notification_push()');

-- ── 6. Proof ──────────────────────────────────────────────────────────────

DO $verify$
DECLARE
  _school uuid; _nophone uuid; _phone uuid;
  _quiet uuid; _queued uuid; _stale uuid;
  _n bigint; _queue_before bigint;
  _token constant text := '[verify 20260925190000] token';
BEGIN
  -- 0. What was written before is settled — and there was something written,
  --    or this would prove nothing.
  IF NOT EXISTS (SELECT 1 FROM public.notifications) THEN
    RAISE EXCEPTION 'ROLLED BACK: no notification exists to prove the backfill on — a check that cannot run is not a check that passed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.notifications WHERE pushed_at IS NULL) THEN
    RAISE EXCEPTION 'ROLLED BACK: a notification written before this migration is waiting to be pushed';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attrdef d JOIN pg_attribute a ON a.attrelid = d.adrelid AND a.attnum = d.adnum
              WHERE d.adrelid = 'public.notifications'::regclass AND a.attname = 'pushed_at') THEN
    RAISE EXCEPTION 'ROLLED BACK: pushed_at kept its default';
  END IF;

  -- 1. Who may call what.
  IF has_function_privilege('authenticated', 'public.claim_notifications_for_push(integer)', 'EXECUTE')
     OR has_function_privilege('anon', 'public.claim_notifications_for_push(integer)', 'EXECUTE')
     OR NOT has_function_privilege('service_role', 'public.claim_notifications_for_push(integer)', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.dispatch_notification_push()', 'EXECUTE')
     OR has_function_privilege('anon', 'public.dispatch_notification_push()', 'EXECUTE')
     OR has_function_privilege('authenticated', 'public.tg_notification_push_queue()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ROLLED BACK: a push function is callable by the wrong role';
  END IF;

  -- 2. The schedule, the secret and the way out.
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'push-notifications-to-phones'
                    AND schedule = '* * * * *' AND command = 'SELECT public.dispatch_notification_push()') THEN
    RAISE EXCEPTION 'ROLLED BACK: the push-notifications-to-phones job is not scheduled every minute';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM vault.decrypted_secrets
                  WHERE name = 'notification_push_drain' AND length(decrypted_secret) >= 48) THEN
    RAISE EXCEPTION 'ROLLED BACK: the vault secret notification_push_drain is missing or short';
  END IF;

  BEGIN
    -- Two accounts of one school, neither with a phone; one is given a phone.
    SELECT p.school_id, p.id INTO _school, _nophone
      FROM public.profiles p
     WHERE p.school_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.device_tokens d WHERE d.user_id = p.id)
     ORDER BY p.id LIMIT 1;
    SELECT p.id INTO _phone
      FROM public.profiles p
     WHERE p.school_id = _school AND p.id <> _nophone
       AND NOT EXISTS (SELECT 1 FROM public.device_tokens d WHERE d.user_id = p.id)
     ORDER BY p.id LIMIT 1;
    IF _phone IS NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: need two accounts of one school with no phone registered';
    END IF;
    INSERT INTO public.device_tokens (id, user_id, token, platform, school_id, created_at, updated_at)
    VALUES (gen_random_uuid(), _phone, _token, 'android', _school, now(), now());

    -- 3. On arrival: settled for someone with no phone, waiting for someone
    --    with one — whatever the writer claimed.
    INSERT INTO public.notifications (id, user_id, school_id, type, title, body, link, read, created_at, pushed_at)
    VALUES (gen_random_uuid(), _nophone, _school, 'homework', '[verify 20260925190000] no phone', 'b', '/student/homework', false, now(), NULL)
    RETURNING id INTO _quiet;
    INSERT INTO public.notifications (id, user_id, school_id, type, title, body, link, read, created_at, pushed_at)
    VALUES (gen_random_uuid(), _phone, _school, 'homework', '[verify 20260925190000] to the phone', 'b', '/student/homework', false, now(), now())
    RETURNING id INTO _queued;
    IF (SELECT pushed_at FROM public.notifications WHERE id = _quiet) IS NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: a notification for someone with no phone waits to be pushed';
    END IF;
    IF (SELECT pushed_at FROM public.notifications WHERE id = _queued) IS NOT NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: a notification for someone with a phone was settled without being sent';
    END IF;

    -- 4. The minute's dispatch sees it waiting and calls the sender (where
    --    pg_net is real, a request is queued; the savepoint drops it).
    IF to_regclass('net.http_request_queue') IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM net.http_request_queue' INTO _queue_before;
    END IF;
    IF public.dispatch_notification_push() < 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: the dispatch did not see a notification waiting for a phone';
    END IF;
    IF _queue_before IS NOT NULL THEN
      EXECUTE 'SELECT count(*) FROM net.http_request_queue' INTO _n;
      IF _n <> _queue_before + 1 THEN
        RAISE EXCEPTION 'ROLLED BACK: the dispatch did not call notification-push (% queued request(s), % before)', _n, _queue_before;
      END IF;
    END IF;

    -- 5. Claimed once, with its phone's token — and only by service_role.
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.claim_notifications_for_push(1);
      RAISE EXCEPTION 'ROLLED BACK: a signed-in session could claim notifications';
    EXCEPTION WHEN insufficient_privilege THEN
      NULL;
    END;
    RESET ROLE;

    SET LOCAL ROLE service_role;
    SELECT count(*) INTO _n
      FROM public.claim_notifications_for_push(500) c
     WHERE c.notification_id = _queued AND c.recipient = _phone
       AND c.tokens = ARRAY[_token] AND c.link = '/student/homework';
    RESET ROLE;
    IF _n <> 1 THEN
      RAISE EXCEPTION 'ROLLED BACK: the waiting notification was not claimed with its phone''s token';
    END IF;
    IF (SELECT pushed_at FROM public.notifications WHERE id = _queued) IS NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: a claimed notification was left waiting, so it would be sent again';
    END IF;
    SET LOCAL ROLE service_role;
    SELECT count(*) INTO _n
      FROM public.claim_notifications_for_push(500) c
     WHERE c.notification_id IN (_queued, _quiet);
    RESET ROLE;
    IF _n <> 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: a notification was claimed twice, or one that needed no push was claimed';
    END IF;

    -- 6. Old news is settled, not sent: the claim leaves it, the dispatch
    --    settles it.
    INSERT INTO public.notifications (id, user_id, school_id, type, title, body, link, read, created_at)
    VALUES (gen_random_uuid(), _phone, _school, 'homework', '[verify 20260925190000] stale', 'b', '/student/homework', false, now() - interval '31 minutes')
    RETURNING id INTO _stale;
    SET LOCAL ROLE service_role;
    SELECT count(*) INTO _n FROM public.claim_notifications_for_push(500) c WHERE c.notification_id = _stale;
    RESET ROLE;
    IF _n <> 0 THEN
      RAISE EXCEPTION 'ROLLED BACK: a notification 31 minutes old was claimed to be sent';
    END IF;
    IF (SELECT pushed_at FROM public.notifications WHERE id = _stale) IS NOT NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: the claim settled a notification it did not send';
    END IF;
    PERFORM public.dispatch_notification_push();
    IF (SELECT pushed_at FROM public.notifications WHERE id = _stale) IS NULL THEN
      RAISE EXCEPTION 'ROLLED BACK: a notification 31 minutes old is still waiting after the dispatch';
    END IF;

    RAISE EXCEPTION USING ERRCODE = 'P0999', MESSAGE = 'verify fixtures rolled back';
  EXCEPTION WHEN SQLSTATE 'P0999' THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM public.notifications WHERE title LIKE '[verify 20260925190000]%')
     OR EXISTS (SELECT 1 FROM public.device_tokens WHERE token LIKE '[verify 20260925190000]%') THEN
    RAISE EXCEPTION 'ROLLED BACK: verify fixtures survived the savepoint';
  END IF;

  RAISE NOTICE 'verify OK: history is settled; a notification waits only for someone with a phone; the minute''s dispatch calls the sender for it; service_role alone claims it, once, with its token and link; one 31 minutes old is settled, never sent; the schedule and the vault secret are in place — and nothing the proof did survived';
END
$verify$;
