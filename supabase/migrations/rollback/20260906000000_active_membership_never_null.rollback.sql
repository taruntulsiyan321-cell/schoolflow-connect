-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — active_membership_id goes back to answering NULL for a second
--            membership
--
-- ⚠ WHAT THIS REINSTATES IS A TOTAL ACCOUNT LOCKOUT, NOT A DEGRADATION.
--
-- After this file runs, any account holding two or more active memberships
-- resolves `active_membership_id()` to NULL again. `has_role/2`'s self branch is
-- keyed on that function, and 111 policies across 68 tables call it, so such an
-- account is refused by all of them — while `src/auth/session.ts:87` still
-- resolves a client-side role from `memberships` directly and routes them into
-- a fully-rendered app in which nothing works.
--
-- In this schema a teacher whose child attends the same school is exactly that
-- account. Do not run this against an installation that has any.
--
-- Check before running:
--
--     SELECT account_id, count(*)
--       FROM public.memberships
--      WHERE status = 'active'
--      GROUP BY account_id
--     HAVING count(*) > 1;
--
-- If that returns rows, rolling back locks those people out.
--
-- ⚠ ORDER MATTERS. `active_membership_id()` and `rpc_start_session()` both call
-- `public._role_precedence`. Both are restored to bodies that do not, and only
-- then is the helper dropped. Dropping it first would leave two functions —
-- one of them behind every policy in the database — calling a callee that does
-- not exist, erroring at query time.
--
-- WHAT GOES RED, and should:
--   · probe13, every assertion about a dual-role account
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Restore the pre-20260906000000 body: the last-resort branch answers only
--    when the account holds exactly one active membership.
CREATE OR REPLACE FUNCTION public.active_membership_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    (SELECT s.active_membership_id
       FROM public.sessions s
       JOIN public.memberships m ON m.id = s.active_membership_id
      WHERE s.account_id = auth.uid()
        AND s.auth_session_id = public.current_auth_session_id()
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND m.status = 'active'
      LIMIT 1),
    (SELECT s.active_membership_id
       FROM public.sessions s
       JOIN public.memberships m ON m.id = s.active_membership_id
      WHERE s.account_id = auth.uid()
        AND (s.expires_at IS NULL OR s.expires_at > now())
        AND m.status = 'active'
      ORDER BY s.last_seen_at DESC
      LIMIT 1),
    (SELECT t.id FROM (
       SELECT m.id, count(*) OVER () AS n
         FROM public.memberships m
        WHERE m.account_id = auth.uid()
          AND m.status = 'active'
     ) t WHERE t.n = 1)
  )
$function$;

COMMENT ON FUNCTION public.active_membership_id() IS NULL;

-- 2. Restore rpc_start_session's single-membership guard.
CREATE OR REPLACE FUNCTION public.rpc_start_session()
RETURNS TABLE(session_id uuid, active_membership_id uuid, school_id uuid, role app_role, membership_count integer)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
#variable_conflict use_column
DECLARE
  _uid  uuid := auth.uid();
  _asid uuid := public.current_auth_session_id();
  _sid  uuid;
  _mid  uuid;
  _cnt  int;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  INSERT INTO public.accounts (id) VALUES (_uid) ON CONFLICT (id) DO NOTHING;

  SELECT count(*) INTO _cnt
    FROM public.memberships m
   WHERE m.account_id = _uid AND m.status = 'active';

  IF _cnt = 1 THEN
    SELECT m.id INTO _mid
      FROM public.memberships m
     WHERE m.account_id = _uid AND m.status = 'active';
  END IF;

  IF _asid IS NOT NULL THEN
    SELECT s.id INTO _sid FROM public.sessions s WHERE s.auth_session_id = _asid;
  ELSE
    SELECT s.id INTO _sid
      FROM public.sessions s
     WHERE s.account_id = _uid
       AND s.auth_session_id IS NULL
     ORDER BY s.last_seen_at DESC
     LIMIT 1;
  END IF;

  IF _sid IS NULL THEN
    INSERT INTO public.sessions (account_id, auth_session_id, active_membership_id)
    VALUES (_uid, _asid, _mid)
    ON CONFLICT (auth_session_id) DO UPDATE
       SET last_seen_at = now(),
           active_membership_id =
             COALESCE(public.sessions.active_membership_id, EXCLUDED.active_membership_id)
    RETURNING id, public.sessions.active_membership_id INTO _sid, _mid;
  ELSE
    UPDATE public.sessions s
       SET last_seen_at = now(),
           active_membership_id = COALESCE(s.active_membership_id, _mid)
     WHERE s.id = _sid
     RETURNING s.active_membership_id INTO _mid;
  END IF;

  RETURN QUERY
  SELECT _sid,
         m.id,
         m.school_id,
         m.role,
         _cnt
    FROM public.sessions s
    LEFT JOIN public.memberships m ON m.id = s.active_membership_id
   WHERE s.id = _sid;
END;
$function$;

-- 3. Only now is it safe to drop the helper.
DROP FUNCTION IF EXISTS public._role_precedence(app_role);

DO $verify$
DECLARE _ami text; _strip constant text := '--[^\n]*|/\*.*?\*/';
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _ami
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'active_membership_id';

  IF _ami IS NULL THEN
    RAISE EXCEPTION 'ABORT: active_membership_id is missing after rollback';
  END IF;
  IF _ami ~ '_role_precedence' THEN
    RAISE EXCEPTION 'ABORT: active_membership_id still calls the dropped helper';
  END IF;
  IF _ami !~ 'n\s*=\s*1' THEN
    RAISE EXCEPTION 'ABORT: the single-membership restriction was not restored';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = '_role_precedence') THEN
    RAISE EXCEPTION 'ABORT: _role_precedence survived the rollback';
  END IF;
END $verify$;

COMMIT;
