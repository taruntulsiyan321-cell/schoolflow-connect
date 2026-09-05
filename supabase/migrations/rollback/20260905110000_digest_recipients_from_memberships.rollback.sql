-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — the digest goes back to selecting recipients from user_roles
--
-- ⚠ THIS RESTORES A SILENT FAILURE, NOT A BEHAVIOUR CHANGE.
--
-- After this, `rpc_send_parent_weekly_digests` iterates
-- `user_roles WHERE role='parent'` again. `public.user_roles` is read-only at
-- the table level since Chunk 1.5, so any school onboarded through
-- `_grant_membership` has no rows there and the loop finds nobody. The function
-- returns `{"sent": 0}`, the cron job reports success, and no parent at that
-- school ever receives a weekly summary.
--
-- There is no error to notice. That is the whole hazard.
--
-- It also loses the `status = 'active'` filter, which user_roles cannot
-- express: a revoked parent resumes receiving weekly summaries about a child
-- they no longer have standing over.
--
-- In THIS database the rollback looks harmless — the seed wrote both tables, so
-- both queries return the same three parents. That equivalence is a property of
-- the seed, not of the system, and it will not hold for a real school.
--
-- WHAT GOES RED, and should:
--   · probe11 "110000 membership-only parent receives a digest"
-- Run `npm run verify:caller-privileges` afterwards so the regression is
-- recorded rather than discovered.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_send_parent_weekly_digests is a scheduled job; it has no per-user caller and reads across institutions by design';
  END IF;

  FOR _p IN
    SELECT DISTINCT ur.user_id
      FROM public.user_roles ur
     WHERE ur.role = 'parent'
  LOOP
    _digest := public._parent_weekly_digest(_p.user_id, _from, _to);
    _kids := jsonb_array_length(_digest -> 'children');

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

-- Assert the INVERSE of the forward check, so a half-applied reversal fails
-- loudly rather than leaving the function reading neither table.
DO $verify$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname = 'rpc_send_parent_weekly_digests' AND pronamespace = 'public'::regnamespace;

  IF _d !~* '\muser_roles\M' THEN
    RAISE EXCEPTION 'rollback incomplete: the sender does not read user_roles';
  END IF;
  IF _d ~* 'public\.memberships' THEN
    RAISE EXCEPTION 'rollback incomplete: the sender still reads memberships';
  END IF;
  IF _d !~* 'auth\.uid\(\) IS NOT NULL' THEN
    RAISE EXCEPTION 'rollback incomplete: the no-caller gate was lost';
  END IF;
END $verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20260905110000_digest_recipients_from_memberships';

COMMIT;
