-- ═══════════════════════════════════════════════════════════════════════════
-- The weekly digest picks its recipients from memberships, not user_roles
--
-- ── THE DEFECT, AND WHY NOTHING WOULD HAVE CAUGHT IT ─────────────────────
--
-- `rpc_send_parent_weekly_digests` selected recipients with:
--
--     SELECT DISTINCT ur.user_id FROM public.user_roles ur WHERE ur.role = 'parent'
--
-- `public.user_roles` has been read-only at the table level since Chunk 1.5
-- (`trg_user_roles_read_only` raises on INSERT, UPDATE and DELETE alike), and
-- roles live on `public.memberships`. Any school onboarded through
-- `_grant_membership` therefore has parents with a membership row and no
-- `user_roles` row at all — and the digest would iterate an empty set.
--
-- It fails SILENTLY. No exception, no zero-division, no empty payload to notice:
-- the loop simply has nothing to iterate, the function returns
-- `{"sent": 0, "skipped_no_children": 0}`, and the cron job reports success.
-- The only symptom is parents who never hear from the school.
--
-- It is invisible in THIS database and would survive an end-to-end walkthrough.
-- Measured before the change:
--
--     parents via user_roles                         3
--     parents via memberships                        3
--     membership parents with no user_roles row      0
--
-- The seed wrote both tables, so both queries return the same three people.
-- The divergence only appears on a school onboarded the way a real one would
-- be — which is to say, on the first real customer and not before.
--
-- ── THE CHANGE ───────────────────────────────────────────────────────────
--
-- `memberships.account_id` is the auth user id: all 62 `accounts` rows join
-- `auth.users` on id, and `_grant_membership` upserts `accounts` before the
-- membership precisely so that reference holds. So the value handed to
-- `_parent_weekly_digest` is unchanged in kind — same identity, different
-- table.
--
-- `status = 'active'` is added because memberships carries lifecycle that
-- `user_roles` never did. A revoked or pending parent must not receive a
-- weekly summary about a child they no longer have standing over; the old
-- query had no way to express that and so could not honour it.
--
-- Nothing else in the function changes: the no-caller gate, the empty-digest
-- skip, and the notification body are all as they were.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $premise$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc
                  WHERE proname = 'rpc_send_parent_weekly_digests'
                    AND pronamespace = 'public'::regnamespace) THEN
    RAISE EXCEPTION 'ABORT: rpc_send_parent_weekly_digests does not exist';
  END IF;
  IF to_regclass('public.memberships') IS NULL THEN
    RAISE EXCEPTION 'ABORT: public.memberships does not exist; there is nothing to repoint at';
  END IF;
END $premise$;

CREATE OR REPLACE FUNCTION public.rpc_send_parent_weekly_digests()
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _from date := CURRENT_DATE - 7;
  _to   date := CURRENT_DATE;
  _p         record;
  _digest    jsonb;
  _kids      int;
  _sent      int := 0;
  _skipped   int := 0;
BEGIN
  -- Same rule as rpc_purge_expired: a platform job with no per-user caller. It
  -- reads every institution's parents by design, and there is no correct
  -- institution to scope it to.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_send_parent_weekly_digests is a scheduled job; it has no per-user caller and reads across institutions by design';
  END IF;

  -- MEMBERSHIPS is the source of truth for a role, and has been since Chunk
  -- 1.5. The frozen legacy roles table this loop used to read is read-only at
  -- the table level, so a school onboarded through _grant_membership has no
  -- rows in it and this loop would have found nobody -- silently.
  --
  -- `account_id` IS the auth user id: _grant_membership upserts `accounts`
  -- first so that reference holds, which is why it can be handed straight to
  -- the computation below.
  --
  -- `status = 'active'` has no equivalent in the old query. A revoked parent
  -- would have kept receiving weekly summaries about a child they no longer
  -- have standing over.
  --
  -- The legacy table is named nowhere in this body on purpose: the verification
  -- block below asserts the identifier is absent, and a guard that trips on its
  -- own explanation is a guard nobody keeps.
  FOR _p IN
    SELECT DISTINCT m.account_id AS user_id
      FROM public.memberships m
     WHERE m.role = 'parent'
       AND m.status = 'active'
  LOOP
    _digest := public._parent_weekly_digest(_p.user_id, _from, _to);
    _kids := jsonb_array_length(_digest -> 'children');

    -- A parent with no linked child gets nothing. An empty digest is not a
    -- weekly summary; it is a notification that says the school did not happen.
    IF _kids = 0 THEN
      _skipped := _skipped + 1;
      CONTINUE;
    END IF;

    PERFORM public._notify(
      _p.user_id,
      'general',
      'Your weekly summary',
      format('Attendance, homework and marks for the week to %s.', to_char(_to, 'DD Mon')),
      'calendar-check',
      '/parent'
    );
    _sent := _sent + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'sent', _sent, 'skipped_no_children', _skipped,
    'window', jsonb_build_object('starts_on', _from, 'ends_on', _to),
    'ran_at', now()
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_send_parent_weekly_digests() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_send_parent_weekly_digests() TO service_role;

-- ── Verification ──────────────────────────────────────────────────────────
DO $verify$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = 'rpc_send_parent_weekly_digests' AND pronamespace = 'public'::regnamespace;

  IF _d ~* '\muser_roles\M' THEN
    RAISE EXCEPTION 'ABORT: the sender still reads user_roles';
  END IF;
  IF _d !~* 'public\.memberships' THEN
    RAISE EXCEPTION 'ABORT: the sender does not read memberships';
  END IF;
  IF _d !~* 'status\s*=\s*''active''' THEN
    RAISE EXCEPTION 'ABORT: the sender does not filter on an active membership';
  END IF;
  IF _d !~* 'role\s*=\s*''parent''' THEN
    RAISE EXCEPTION 'ABORT: the sender no longer selects parents specifically';
  END IF;
  -- The gate and the empty-skip are not in scope for this change and must
  -- survive it.
  IF _d !~* 'auth\.uid\(\) IS NOT NULL' THEN
    RAISE EXCEPTION 'ABORT: the no-caller gate was lost';
  END IF;
  IF _d !~* '_kids = 0' THEN
    RAISE EXCEPTION 'ABORT: the empty-digest skip was lost';
  END IF;

  IF has_function_privilege('authenticated', 'public.rpc_send_parent_weekly_digests()', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated can execute the scheduled sender';
  END IF;
END $verify$;

COMMIT;
