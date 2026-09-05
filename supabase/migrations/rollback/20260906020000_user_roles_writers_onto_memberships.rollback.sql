-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — the eight writers go back to writing a read-only table
--
-- ⚠ WHAT THIS RESTORES IS BROKEN CODE, DELIBERATELY.
--
-- `public.user_roles` is read-only at the table level (`trg_user_roles_read_only`
-- raises on INSERT, UPDATE and DELETE). Every function restored below writes it,
-- so every one of them raises when called. Account linking, revoking and teacher
-- activation all stop working again.
--
-- ⚠ AND IT REOPENS FIVE CROSS-TENANT HOLES. The restored bodies are
-- SECURITY DEFINER and update `teachers` / `students` BY ID with no
-- `same_school` check, so an admin of school A can act on a school B row.
-- probe14's four CROSS-TENANT assertions go red, and they are the ones that
-- matter.
--
-- Roll this back only to reproduce the old behaviour, never to keep it.
--
-- ⚠ ORDER MATTERS for the grants. The four dropped functions are recreated, and
-- CREATE does NOT restore an ACL, so the GRANTs at the end are not optional --
-- without them `authenticated` cannot call them and the rollback would leave a
-- third state that never existed. Note `admin_connect_student_account(uuid,text)`
-- deliberately gets NO `authenticated` grant: it never had one.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Recreate the four dropped functions, verbatim ─────────────────────
CREATE OR REPLACE FUNCTION public.admin_connect_student_account(_student_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _id text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can connect student accounts';
  END IF;
  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
      WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
      LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No account found for %. Ask the student to sign in with Google once first.', _id;
  END IF;

  UPDATE public.students SET user_id = _uid WHERE id = _student_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_assign_role(_identifier text, _role app_role)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _id text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can assign roles';
  END IF;
  IF _role IN ('principal'::app_role, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Principal and Admin roles are managed by the platform owner only';
  END IF;
  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN
    RAISE EXCEPTION 'Email or phone required';
  END IF;
  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
     LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user found with %. Ask them to sign in once first.', _id;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN _uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_remove_role(_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can remove roles';
  END IF;
  IF _role IN ('principal'::app_role, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Principal and Admin roles are managed by the platform owner only';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END;
$function$;

CREATE OR REPLACE FUNCTION public.ensure_default_role()
RETURNS app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _existing app_role;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
    ON CONFLICT (user_id, role) DO NOTHING;
  RETURN 'student'::app_role;
END;
$function$;

-- ── 2. Restore the four rewritten bodies, unfenced, as they were ─────────
CREATE OR REPLACE FUNCTION public.admin_connect_teacher_account(_teacher_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _id text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can connect teacher accounts';
  END IF;
  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
      WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
      LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No account found for %. Ask the teacher to sign in with Google once first.', _id;
  END IF;

  UPDATE public.teachers SET user_id = _uid, status = 'active' WHERE id = _teacher_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _uid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_teacher_account(_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can revoke teacher accounts';
  END IF;
  SELECT user_id INTO _uid FROM public.teachers WHERE id = _teacher_id;
  UPDATE public.teachers SET user_id = NULL, status = 'inactive' WHERE id = _teacher_id;
  IF _uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'teacher'::app_role;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_revoke_student_account(_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can revoke student accounts';
  END IF;
  SELECT user_id INTO _uid FROM public.students WHERE id = _student_id;
  UPDATE public.students SET user_id = NULL WHERE id = _student_id;
  IF _uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'student'::app_role;
  END IF;
END;
$function$;

CREATE OR REPLACE FUNCTION public.admin_set_teacher_access(_teacher_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change teacher access';
  END IF;
  UPDATE public.teachers SET status = CASE WHEN _active THEN 'active' ELSE 'inactive' END
    WHERE id = _teacher_id RETURNING user_id INTO _uid;
  IF _uid IS NOT NULL THEN
    IF _active THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher'::app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    ELSE
      DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'teacher'::app_role;
    END IF;
  END IF;
END;
$function$;

-- ── 3. Restore the ACLs a CREATE cannot bring back ───────────────────────
GRANT EXECUTE ON FUNCTION public.admin_assign_role(text, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.admin_remove_role(uuid, app_role) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ensure_default_role() TO authenticated, service_role;
-- service_role only, matching the ACL it actually had.
GRANT EXECUTE ON FUNCTION public.admin_connect_student_account(uuid, text) TO service_role;

DO $verify$
DECLARE _src text; _strip constant text := '--[^\n]*|/\*.*?\*/';
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                  WHERE n.nspname='public' AND p.proname='ensure_default_role') THEN
    RAISE EXCEPTION 'ABORT: ensure_default_role was not restored';
  END IF;
  IF (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
       WHERE n.nspname='public' AND p.proname='admin_connect_student_account') <> 2 THEN
    RAISE EXCEPTION 'ABORT: both connect overloads should exist after rollback';
  END IF;
  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public' AND p.proname='admin_revoke_teacher_account';
  IF _src ~ 'same_school' THEN
    RAISE EXCEPTION 'ABORT: the fence survived; this is not the pre-migration body';
  END IF;
  IF _src !~ 'user_roles' THEN
    RAISE EXCEPTION 'ABORT: the restored body does not write user_roles';
  END IF;
END $verify$;

COMMIT;
