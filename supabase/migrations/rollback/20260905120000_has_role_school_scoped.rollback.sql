-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — has_role loses its school-scoped signature
--
-- Drops `has_role(uuid, app_role, uuid)` and restores the two-argument function
-- to the self-contained body it had before 20260905120000.
--
-- ⚠ ORDER MATTERS. The two-argument form is restored FIRST, because after this
-- migration it delegates to the three-argument one. Dropping the three-arg
-- while the two-arg still calls it would leave 106 policies across 68 tables
-- and 52 functions calling a function whose callee does not exist — every one
-- of them erroring at query time, which is the entire authorization surface.
--
-- WHAT THIS RESTORES
--
-- The service-role defect: `auth.uid()` is NULL, the cross-account branch is
-- taken, `get_my_school_id()` is NULL, and `has_role` answers false for every
-- role from every caller without a session. `dpp-generate-questions` goes back
-- to refusing everyone (KNOWN_ISSUES §1) and issue 2 is blocked again.
--
-- WHAT IT DOES NOT RESTORE, and must not
--
-- The superseded route (a) from KNOWN_ISSUES §1 — the
-- `current_setting('role') = 'service_role'` disjunct — is NOT reinstated here
-- and should not be reinstated anywhere. It was ruled against: an authorization
-- primitive must not answer "yes" to a caller that has already bypassed RLS.
-- Rolling this migration back returns to the broken-but-honest state, not to
-- the bypass.
--
-- WHAT GOES RED, and should:
--   · probe12 "120000 three-arg with NO session, right school"  (function gone)
--   · probe12 "120000 three-arg, WRONG school (the scoping control)"
--   · probe12 "120000 three-arg, NULL school"
-- Run `npm run verify:caller-privileges` afterwards so the regression is
-- recorded rather than discovered.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Restore the self-contained two-argument body FIRST (see the order note).
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL THEN false
    WHEN _role = 'super_admin' THEN
      _user_id = auth.uid() AND public.is_super_admin()
    WHEN _user_id = auth.uid() THEN (
      EXISTS (
        SELECT 1 FROM public.memberships m
         WHERE m.id = public.active_membership_id()
           AND m.role = _role
           AND m.status = 'active'
      )
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
    ELSE EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.account_id = _user_id
         AND m.role = _role
         AND m.status = 'active'
         AND m.school_id = public.get_my_school_id()
    )
  END
$function$;

-- 2. Only now is the three-argument form unreferenced.
DROP FUNCTION IF EXISTS public.has_role(uuid, public.app_role, uuid);

-- Assert the INVERSE of the forward check, so a half-applied reversal fails
-- loudly rather than leaving the primitive pointing at a missing callee.
DO $verify$
DECLARE _n int; _two text;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_role';
  IF _n <> 1 THEN
    RAISE EXCEPTION 'rollback incomplete: expected 1 has_role overload, found %', _n;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO _two FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_role' AND p.pronargs = 2;

  IF _two ~ 'has_role\(_user_id, _role, ' THEN
    RAISE EXCEPTION 'rollback incomplete: the two-argument form still delegates to a dropped function';
  END IF;
  IF _two !~ 'get_my_school_id' THEN
    RAISE EXCEPTION 'rollback incomplete: the cross-account branch was not restored';
  END IF;
  IF _two !~ 'active_membership_id' THEN
    RAISE EXCEPTION 'rollback incomplete: the self branch was lost';
  END IF;
  IF _two ~* 'service_role' THEN
    RAISE EXCEPTION 'rollback introduced the superseded service-role bypass';
  END IF;
END $verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20260905120000_has_role_school_scoped';

COMMIT;
