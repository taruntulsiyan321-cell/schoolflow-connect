-- ═══════════════════════════════════════════════════════════════════════════
-- has_role gains a school-scoped signature; the existing one delegates to it
--
-- ── THE PROBLEM ──────────────────────────────────────────────────────────
--
-- A service-role caller has no session, so `auth.uid()` is NULL, so
-- `_user_id = auth.uid()` is NULL rather than true, so the CROSS-USER branch is
-- taken — and that branch ends `AND m.school_id = public.get_my_school_id()`.
-- `get_my_school_id()` resolves entirely from `auth.uid()`, so it is NULL too,
-- and `m.school_id = NULL` is never true. The function answers `false` for
-- every role, for every user, from every service-role client.
--
-- This has blocked `dpp-generate-questions` (KNOWN_ISSUES §1) and issue 2 for
-- several sessions.
--
-- ── THE PREVIOUSLY-WRITTEN FIX IS SUPERSEDED. DO NOT APPLY IT. ───────────
--
-- KNOWN_ISSUES §1 route (a) proposed widening the cross-account branch with:
--
--     AND ( m.school_id = public.get_my_school_id()
--           OR (auth.uid() IS NULL
--               AND current_setting('role', true) = 'service_role') )
--
-- That is a service-role bypass, and it has been ruled against: it makes the
-- authorization primitive answer "yes" to a caller that has already bypassed
-- RLS by role attribute. The primitive would stop meaning "this person holds
-- this role here" and start meaning "this person holds this role, or you didn't
-- have to ask". That migration should be struck from KNOWN_ISSUES, not applied.
--
-- ── THE SHAPE: CALLERS NAME THE SCHOOL ───────────────────────────────────
--
--   has_role(user, role, school_id)   the cross-account predicate. Takes the
--                                     institution as an argument instead of
--                                     inferring it from a session, which is the
--                                     only reason a caller without one can use
--                                     it at all.
--   has_role(user, role)              unchanged signature and unchanged
--                                     behaviour. Resolves the caller's school
--                                     from their session and delegates.
--
-- 106 policies across 68 tables and 52 functions call the two-argument form.
-- None of them changes: delegation keeps them working exactly as before, and a
-- caller with no session still gets `false` from it — correctly, because it
-- asked a question it gave no institution to answer.
--
-- ── WHY THE SELF-BRANCH IS NOT DUPLICATION ───────────────────────────────
--
-- The instruction was not to write the predicate twice, and this does not:
-- there are TWO DIFFERENT predicates here and there always were.
--
--   cross-account   "does this OTHER person hold this role at this school"
--                   → memberships by (account_id, role, status, school_id)
--   self            "am I ACTING in this role right now"
--                   → memberships by m.id = active_membership_id()
--
-- `memberships_account_school_role_key` is UNIQUE on (account_id, school_id,
-- role), so one account can hold several roles at one school. The self-branch
-- keys on the ACTIVE membership specifically, which is what makes "notifications
-- and badges show the active role only, never blended" enforceable. Collapsing
-- it into the school-scoped predicate would silently grant every role a user
-- holds at their school regardless of which one they are acting as — a
-- role-switching regression wearing a refactor's clothes.
--
-- So the self-branch stays where it is, and the cross-account predicate — the
-- one that was broken — now exists exactly once, in the three-argument form.
--
-- ── WHAT THIS DOES NOT DO ────────────────────────────────────────────────
--
-- It does not make any caller pass a school. `_shared/requireRole.ts` still
-- calls the two-argument form from a service-role client and will still get
-- `false`; fixing that needs an edge-function deploy, which is refused in this
-- environment. This migration makes the correct call POSSIBLE and asserts it
-- works. Wiring it is a separate, deploy-gated change.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $premise$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_role';
  IF _n <> 1 THEN
    RAISE EXCEPTION
      'ABORT: expected exactly 1 has_role overload before this migration, found %. Re-read before proceeding.', _n;
  END IF;
END $premise$;

-- ── The cross-account predicate, school named by the caller ───────────────
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role public.app_role, _school_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT CASE
    WHEN _user_id IS NULL OR _role IS NULL OR _school_id IS NULL THEN false
    -- super_admin is not a membership and never has been: memberships carries a
    -- CHECK (role <> 'super_admin'). It stays self-only, so naming a school
    -- cannot manufacture one.
    WHEN _role = 'super_admin' THEN
      _user_id = auth.uid() AND public.is_super_admin()
    ELSE EXISTS (
      SELECT 1 FROM public.memberships m
       WHERE m.account_id = _user_id
         AND m.role = _role
         AND m.status = 'active'
         AND m.school_id = _school_id
    )
  END
$function$;

REVOKE ALL ON FUNCTION public.has_role(uuid, public.app_role, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.app_role, uuid) TO authenticated, service_role;

-- ── The existing signature: resolve the school, then delegate ─────────────
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
    -- SELF: "am I acting in this role right now". Keyed on the ACTIVE
    -- membership, not on any membership at this school — one account may hold
    -- several roles at one institution, and only the active one counts.
    WHEN _user_id = auth.uid() THEN (
      EXISTS (
        SELECT 1 FROM public.memberships m
         WHERE m.id = public.active_membership_id()
           AND m.role = _role
           AND m.status = 'active'
      )
      -- Super-admin bypass. Deliberately not school-specific here: this half
      -- only says "acts in this role", and the institution is decided by the
      -- same_school(school_id) half that every such policy also carries.
      OR (public.is_super_admin() AND public.super_admin_has_any_access())
    )
    -- CROSS-ACCOUNT: delegated, so the predicate exists once. A caller with no
    -- session resolves NULL here and the three-argument form returns false for
    -- a NULL school — which is the correct answer to a question that named no
    -- institution, not a bug to be widened away.
    ELSE public.has_role(_user_id, _role, public.get_my_school_id())
  END
$function$;

-- ── Verification ──────────────────────────────────────────────────────────
DO $verify$
DECLARE _two text; _three text; _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_role';
  IF _n <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected 2 has_role overloads after this migration, found %', _n;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO _three FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_role'
     AND p.pronargs = 3;
  SELECT pg_get_functiondef(p.oid) INTO _two FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'has_role'
     AND p.pronargs = 2;

  IF _three IS NULL THEN RAISE EXCEPTION 'ABORT: the school-scoped overload was not created'; END IF;
  IF _two   IS NULL THEN RAISE EXCEPTION 'ABORT: the two-argument signature is missing'; END IF;

  -- The three-arg form must scope on the ARGUMENT, never on the session.
  IF _three !~ 'm\.school_id\s*=\s*_school_id' THEN
    RAISE EXCEPTION 'ABORT: the school-scoped form does not scope on its argument';
  END IF;
  IF _three ~* 'get_my_school_id' THEN
    RAISE EXCEPTION 'ABORT: the school-scoped form still infers the school from the session';
  END IF;
  -- And it must NOT contain a service-role escape hatch, which is the ruling
  -- this migration exists to implement rather than repeat.
  IF _three ~* 'service_role' OR _two ~* 'service_role' THEN
    RAISE EXCEPTION 'ABORT: a service-role bypass was reintroduced into has_role';
  END IF;

  -- The two-arg form must delegate rather than carry a second copy.
  IF _two !~ 'has_role\(_user_id, _role, public\.get_my_school_id\(\)\)' THEN
    RAISE EXCEPTION 'ABORT: the two-argument form does not delegate to the school-scoped one';
  END IF;
  -- The self-branch must survive: it is a different predicate, and losing it
  -- would grant every role a user holds at their school, not the active one.
  IF _two !~ 'active_membership_id\(\)' THEN
    RAISE EXCEPTION 'ABORT: the active-membership self branch was lost';
  END IF;

  IF has_function_privilege('anon', 'public.has_role(uuid, public.app_role, uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: anon can execute the school-scoped has_role';
  END IF;
END $verify$;

COMMIT;
