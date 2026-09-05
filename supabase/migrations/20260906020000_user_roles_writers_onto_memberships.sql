-- ═══════════════════════════════════════════════════════════════════════════
-- The eight user_roles writers: four go, four move onto memberships, and the
-- five missing tenancy fences land in the same change
--
-- `public.user_roles` has been read-only at the table level since Chunk 1.5 --
-- `trg_user_roles_read_only` raises on INSERT, UPDATE and DELETE alike. Eight
-- functions still wrote it, so every one of them raised when called. Roles live
-- on `public.memberships` and are granted through `_grant_membership` /
-- `_revoke_membership`.
--
-- ── THE SPLIT IS 4 + 4, NOT 3 + 5 ────────────────────────────────────────
--
-- The approved classification said three drops and five rewrites. Counting the
-- signatures gives four and four, because `ensure_default_role()` cannot be
-- rewritten onto memberships at all: a membership requires an institution, and
-- that function names none -- it inserted `(auth.uid(), 'student')` for any
-- authenticated caller with no role. Under memberships that is not a weaker
-- version of the right thing, it is a different thing. It was already
-- classified as incoherent and dropped; this only corrects the arithmetic.
--
-- DROPPED (4)
--   admin_connect_student_account(uuid, text)  the orphaned overload. The live
--       three-argument form already calls _grant_membership and already fences
--       on same_school; the client passes three arguments, and this one is not
--       even granted to `authenticated` (acl: postgres, service_role only), so
--       nothing could have called it from a browser.
--   admin_assign_role(text, app_role)          unreferenced and superseded.
--   admin_remove_role(uuid, app_role)          unreferenced and superseded.
--   ensure_default_role()                      incoherent under memberships.
--
-- §10.18 AND THE BLOCK THAT CONTRADICTED IT. `admin_assign_role` raised on
-- 'principal' and 'admin' with "managed by the platform owner only".
-- §10.18 (docs/locked-decisions.md:564) says the opposite in four places: admin
-- "Creates the principal, creates other admins", "Create the principal
-- account", "Create other admin accounts (multiple admins per school)", and the
-- chain "Super admin -> school admin -> principal, teachers, students,
-- parents." Where code and spec disagree the spec wins, so the block is the
-- bug and it goes with the function rather than being preserved onto
-- `admin_set_unique_role`.
--
-- REWRITTEN (4) -- CREATE OR REPLACE, not DROP + CREATE, so the existing
-- EXECUTE grant to `authenticated` survives:
--   admin_connect_teacher_account, admin_revoke_teacher_account,
--   admin_revoke_student_account, admin_set_teacher_access
--
-- ── THE FENCES, WHICH ARE THE SECURITY HALF ──────────────────────────────
--
-- All four are SECURITY DEFINER and updated `teachers` / `students` BY ID with
-- no institution check, so an admin of school A could reach a row of school B.
-- They were unreachable only because the role gate they share refuses everyone
-- a service-role client asks about -- and fixing that gate is what makes them
-- reachable. Fences and assertions land together or neither lands.
--
-- Each now resolves the row's school first and requires same_school() on it,
-- the same shape the three-argument connect already uses. probe14 asserts the
-- refusal AND the own-school path still working; a fence that merely broke the
-- feature would pass a denial-only test.
--
-- ── THE RENDEZVOUS COVERS IDENTIFIER RESOLUTION ──────────────────────────
--
-- `admin_assign_role` resolved an email or phone to an account. Dropping it
-- does not lose that: `admin_connect_teacher_account` below and the live
-- `admin_connect_student_account/3` both resolve an identifier, and when no
-- auth user exists yet they record it on the row (`teachers.email`,
-- `students.portal_email` / `portal_phone`) and return NULL, so
-- `link_portal_on_auth` binds the account on that person's first sign-in. What
-- IS lost is granting an arbitrary role by identifier -- see the note above
-- about §10.18's unimplemented account-creation chain, logged not built.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The four drops ───────────────────────────────────────────────────────
DROP FUNCTION IF EXISTS public.admin_connect_student_account(uuid, text);
DROP FUNCTION IF EXISTS public.admin_assign_role(text, app_role);
DROP FUNCTION IF EXISTS public.admin_remove_role(uuid, app_role);
DROP FUNCTION IF EXISTS public.ensure_default_role();

-- ── Connect a teacher: fenced, and onto memberships ──────────────────────
CREATE OR REPLACE FUNCTION public.admin_connect_teacher_account(_teacher_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _id text; _phone text; _school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can connect teacher accounts';
  END IF;

  SELECT school_id INTO _school FROM public.teachers WHERE id = _teacher_id;
  IF _school IS NULL OR NOT public.same_school(_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;

  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
    IF _uid IS NULL THEN
      -- The rendezvous: record the identity and let link_portal_on_auth bind it
      -- when they first sign in. Returning NULL is how the caller knows.
      UPDATE public.teachers SET email = lower(_id) WHERE id = _teacher_id;
      RETURN NULL;
    END IF;
    UPDATE public.teachers SET user_id = _uid, status = 'active', email = lower(_id)
     WHERE id = _teacher_id;
  ELSE
    _phone := public.normalize_phone(_id);
    IF _phone IS NULL OR length(_phone) < 7 THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
    SELECT id INTO _uid FROM auth.users WHERE public.normalize_phone(phone) = _phone LIMIT 1;
    IF _uid IS NULL THEN
      RAISE EXCEPTION 'No account found for %. Ask them to sign in once, or use an email address.', _id;
    END IF;
    UPDATE public.teachers SET user_id = _uid, status = 'active' WHERE id = _teacher_id;
  END IF;

  PERFORM public._grant_membership(_uid, _school, 'teacher'::public.app_role, _teacher_id);
  UPDATE public.profiles SET school_id = coalesce(school_id, _school) WHERE id = _uid;
  RETURN _uid;
END;
$function$;

-- ── Revoke a teacher ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_teacher_account(_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can revoke teacher accounts';
  END IF;

  SELECT user_id, school_id INTO _uid, _school FROM public.teachers WHERE id = _teacher_id;
  IF _school IS NULL OR NOT public.same_school(_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;

  UPDATE public.teachers SET user_id = NULL, status = 'inactive' WHERE id = _teacher_id;

  IF _uid IS NOT NULL THEN
    -- Scoped to THIS institution. An account teaching at another school keeps
    -- that membership; revoking here is not revoking them everywhere.
    PERFORM public._revoke_membership(_uid, _school, 'teacher'::public.app_role);
  END IF;
END;
$function$;

-- ── Revoke a student ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_revoke_student_account(_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can revoke student accounts';
  END IF;

  SELECT user_id, school_id INTO _uid, _school FROM public.students WHERE id = _student_id;
  IF _school IS NULL OR NOT public.same_school(_school) THEN
    RAISE EXCEPTION 'Student is outside your school';
  END IF;

  UPDATE public.students SET user_id = NULL WHERE id = _student_id;

  IF _uid IS NOT NULL THEN
    PERFORM public._revoke_membership(_uid, _school, 'student'::public.app_role);
  END IF;
END;
$function$;

-- ── Activate / deactivate a teacher's access ─────────────────────────────
CREATE OR REPLACE FUNCTION public.admin_set_teacher_access(_teacher_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can change teacher access';
  END IF;

  SELECT user_id, school_id INTO _uid, _school FROM public.teachers WHERE id = _teacher_id;
  IF _school IS NULL OR NOT public.same_school(_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;

  UPDATE public.teachers
     SET status = CASE WHEN _active THEN 'active' ELSE 'inactive' END
   WHERE id = _teacher_id;

  IF _uid IS NOT NULL THEN
    IF _active THEN
      PERFORM public._grant_membership(_uid, _school, 'teacher'::public.app_role, _teacher_id);
    ELSE
      PERFORM public._revoke_membership(_uid, _school, 'teacher'::public.app_role);
    END IF;
  END IF;
END;
$function$;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- Runs as `postgres`, so it proves nothing about who is refused (rule 6). It
-- checks shape only. The behavioural claims -- an admin of school A refused on
-- a school B row, the same admin still working on their own school, and a
-- non-admin refused -- are asserted as the caller in probe14.sql (rule 7).
--
-- Comments are stripped before every match (rule 29). These bodies explain the
-- change at length and name `user_roles` in prose; without stripping, the
-- absence check below would fail on a correct function.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _name text;
  _src  text;
  _oid  oid;
  _strip constant text := '--[^\n]*|/\*.*?\*/';
  _rewritten constant text[] := ARRAY[
    'admin_connect_teacher_account','admin_revoke_teacher_account',
    'admin_revoke_student_account','admin_set_teacher_access'];
  _dropped constant text[] := ARRAY['admin_assign_role','admin_remove_role','ensure_default_role'];
BEGIN
  -- The four drops are gone.
  FOREACH _name IN ARRAY _dropped LOOP
    IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                WHERE n.nspname = 'public' AND p.proname = _name) THEN
      RAISE EXCEPTION 'ABORT: % survived the drop', _name;
    END IF;
  END LOOP;

  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname = 'admin_connect_student_account'
                AND p.pronargs = 2) THEN
    RAISE EXCEPTION 'ABORT: the orphaned two-argument connect overload survived';
  END IF;
  -- ...and the one that does the work is still there. Dropping BOTH overloads
  -- would satisfy the check above and break student linking entirely.
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname = 'public' AND p.proname = 'admin_connect_student_account'
                    AND p.pronargs = 3) THEN
    RAISE EXCEPTION 'ABORT: the three-argument connect was dropped too';
  END IF;

  FOREACH _name IN ARRAY _rewritten LOOP
    SELECT p.oid, regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
      INTO _oid, _src
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = _name;

    IF _src IS NULL THEN
      RAISE EXCEPTION 'ABORT: % is missing', _name;
    END IF;
    IF _src ~* 'user_roles' THEN
      RAISE EXCEPTION 'ABORT: % still writes user_roles', _name;
    END IF;
    IF _src !~ 'same_school' THEN
      RAISE EXCEPTION 'ABORT: % has no tenancy fence', _name;
    END IF;
    IF _src !~ '_grant_membership|_revoke_membership' THEN
      RAISE EXCEPTION 'ABORT: % does not go through the membership helpers', _name;
    END IF;
    IF _src !~ 'has_role' THEN
      RAISE EXCEPTION 'ABORT: % lost its admin gate', _name;
    END IF;
    -- The grant must survive the replace, or the browser silently loses the RPC.
    IF NOT has_function_privilege('authenticated', _oid, 'EXECUTE') THEN
      RAISE EXCEPTION 'ABORT: authenticated lost EXECUTE on %', _name;
    END IF;
  END LOOP;

  -- Control: prove the stripper ran. This phrase exists ONLY inside a comment
  -- in admin_revoke_teacher_account, so a stripper that silently no-opped would
  -- leave it present and every match above would be untrustworthy (G11).
  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'admin_revoke_teacher_account';
  IF _src ~ 'not revoking them everywhere' THEN
    RAISE EXCEPTION 'ABORT: comment stripping did not run; every match above is unreliable';
  END IF;
END $verify$;

COMMIT;
