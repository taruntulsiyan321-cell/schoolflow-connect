-- ============================================================================
-- Gurukul Auth Foundation — multi-tenant schools + session context
-- ============================================================================
-- Roles: keep existing admin (= School Admin), principal, teacher, student, parent
-- Add super_admin for future platform use (no routes yet).
-- Every profile belongs to exactly one school (nullable only until assigned).
-- Exactly one role per user account (enforced after consolidating duplicates).

-- ── 1. Schools (tenants) ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.schools ENABLE ROW LEVEL SECURITY;

-- ── 2. Seed default school for existing single-tenant data ───────────────────
INSERT INTO public.schools (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000000001', 'Wisdom Campus', 'wisdom-campus')
ON CONFLICT (id) DO NOTHING;

UPDATE public.schools s
SET name = coalesce(nullif(trim(a.school_name), ''), s.name),
    updated_at = now()
FROM public.app_settings a
WHERE s.id = '00000000-0000-4000-8000-000000000001';

-- ── 3. Profile multi-tenant + active status ──────────────────────────────────
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id),
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

UPDATE public.profiles
SET school_id = '00000000-0000-4000-8000-000000000001'
WHERE school_id IS NULL;

CREATE INDEX IF NOT EXISTS profiles_school_id_idx ON public.profiles(school_id);

-- Schools RLS (after profiles.school_id exists)
DROP POLICY IF EXISTS schools_select_own ON public.schools;
CREATE POLICY schools_select_own ON public.schools
  FOR SELECT TO authenticated
  USING (
    id = (SELECT school_id FROM public.profiles WHERE id = auth.uid())
    OR public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
  );

DROP POLICY IF EXISTS schools_admin_update ON public.schools;
CREATE POLICY schools_admin_update ON public.schools
  FOR UPDATE TO authenticated
  USING (
    id = (SELECT school_id FROM public.profiles WHERE id = auth.uid())
    AND (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal'))
  );

-- ── 4. Exactly one role per user ─────────────────────────────────────────────
WITH ranked AS (
  SELECT id, user_id, role,
    ROW_NUMBER() OVER (
      PARTITION BY user_id
      ORDER BY CASE role::text
        WHEN 'admin' THEN 1
        WHEN 'principal' THEN 2
        WHEN 'teacher' THEN 3
        WHEN 'student' THEN 4
        WHEN 'parent' THEN 5
        ELSE 99
      END
    ) AS rn
  FROM public.user_roles
)
DELETE FROM public.user_roles ur
USING ranked r
WHERE ur.id = r.id AND r.rn > 1;

DROP INDEX IF EXISTS user_roles_one_per_user;
CREATE UNIQUE INDEX user_roles_one_per_user ON public.user_roles(user_id);

-- ── 6. Session helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT school_id FROM public.profiles WHERE id = auth.uid();
$$;

GRANT EXECUTE ON FUNCTION public.get_my_school_id() TO authenticated;

CREATE OR REPLACE FUNCTION public.get_my_role()
RETURNS public.app_role
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT role FROM public.user_roles WHERE user_id = auth.uid() LIMIT 1;
$$;

GRANT EXECUTE ON FUNCTION public.get_my_role() TO authenticated;

-- Single round-trip auth bootstrap for the client
CREATE OR REPLACE FUNCTION public.get_auth_context()
RETURNS TABLE (
  user_id uuid,
  email text,
  full_name text,
  photo_url text,
  is_active boolean,
  role public.app_role,
  school_id uuid,
  school_name text,
  school_slug text,
  school_logo_url text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  -- Ensure portal rows are linked on first login
  PERFORM public.link_portal_on_auth(_uid);

  -- Ensure profile exists (defensive)
  INSERT INTO public.profiles (id, full_name, email, school_id)
  SELECT _uid,
         coalesce((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = _uid), ''),
         (SELECT email FROM auth.users WHERE id = _uid),
         '00000000-0000-4000-8000-000000000001'
  ON CONFLICT (id) DO NOTHING;

  -- Assign default school if missing
  UPDATE public.profiles
  SET school_id = coalesce(school_id, '00000000-0000-4000-8000-000000000001')
  WHERE id = _uid AND school_id IS NULL;

  RETURN QUERY
  SELECT
    p.id,
    p.email,
    p.full_name,
    p.photo_url,
    p.is_active,
    ur.role,
    p.school_id,
    s.name,
    s.slug,
    s.logo_url
  FROM public.profiles p
  LEFT JOIN public.user_roles ur ON ur.user_id = p.id
  LEFT JOIN public.schools s ON s.id = p.school_id
  WHERE p.id = _uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.get_auth_context() TO authenticated;

-- ── 7. Role assignment must keep one role (uuid form; text form still exists) ─
CREATE OR REPLACE FUNCTION public.admin_set_unique_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only school admins can assign roles';
  END IF;

  -- Reject platform-level roles from school admins (super_admin added for future)
  IF _role::text = 'super_admin' THEN
    RAISE EXCEPTION 'super_admin cannot be assigned from the school admin panel';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
END;
$$;

GRANT EXECUTE ON FUNCTION public.admin_set_unique_role(uuid, public.app_role) TO authenticated;

-- Portal linking must respect one-role-per-user
CREATE OR REPLACE FUNCTION public.link_portal_on_auth(_uid uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE
  _email text;
  _phone text;
  _teacher_id uuid;
  _student_id uuid;
  _parent_student_id uuid;
  _has_role boolean;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT lower(email), public.normalize_phone(phone) INTO _email, _phone
  FROM auth.users WHERE id = _uid;

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid) INTO _has_role;

  IF _email IS NOT NULL THEN
    SELECT id INTO _teacher_id FROM public.teachers WHERE lower(email) = _email AND user_id IS NULL LIMIT 1;
    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher')
        ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students WHERE user_id IS NULL AND lower(portal_email) = _email LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
        ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
    END IF;
  END IF;

  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    SELECT id INTO _student_id FROM public.students WHERE user_id IS NULL AND portal_phone = _phone LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
        ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email LIMIT 1;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent')
        ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
    END IF;
  END IF;

  IF _phone IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone LIMIT 1;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent')
        ON CONFLICT (user_id) DO NOTHING;
      END IF;
    END IF;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.link_portal_on_auth(uuid) TO authenticated;

-- ── 8. New users inherit default school ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  _student_id uuid;
  _default_school uuid := '00000000-0000-4000-8000-000000000001';
  _has_role boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, school_id, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.phone,
    COALESCE((NEW.raw_user_meta_data->>'school_id')::uuid, _default_school),
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        full_name = CASE
          WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END,
        school_id = COALESCE(public.profiles.school_id, EXCLUDED.school_id);

  PERFORM public.link_portal_on_auth(NEW.id);

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

  IF NEW.raw_user_meta_data->>'admission_number' IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students
      WHERE admission_number = NEW.raw_user_meta_data->>'admission_number'
        AND user_id IS NULL
      LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = NEW.id WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role)
        VALUES (NEW.id, 'student')
        ON CONFLICT (user_id) DO NOTHING;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_default_role()
RETURNS app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _existing app_role;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  PERFORM public.link_portal_on_auth(_uid);
  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
  ON CONFLICT (user_id) DO NOTHING;
  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  RETURN _existing;
END; $$;

-- ── 9. Soft school-isolation helper for future RLS policies ──────────────────
-- Usage in policies: school_id = public.get_my_school_id()
-- Domain tables can adopt this incrementally without breaking existing demos.

COMMENT ON FUNCTION public.get_my_school_id() IS
  'Returns the authenticated user school_id for multi-tenant RLS. Use: school_id = public.get_my_school_id()';

COMMENT ON FUNCTION public.get_auth_context() IS
  'Bootstrap RPC: profile + role + school for the signed-in user in one round trip.';

-- ── 10. Reserve super_admin enum for future platform console ─────────────────
DO $$ BEGIN
  ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'super_admin';
EXCEPTION
  WHEN duplicate_object THEN NULL;
  WHEN others THEN NULL;
END $$;
