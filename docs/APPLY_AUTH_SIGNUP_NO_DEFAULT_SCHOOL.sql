-- AUTH-C2: stop auto-tenanting self-signup into default_school_id
-- Paste in Supabase SQL Editor as UTF-8 (APPLY). Also shipped as migration.
--
-- Before: handle_new_user always set profiles.school_id = default_school_id(),
-- so uninvited student/parent signups gained same_school() access to Wisdom Campus.
-- After: school_id stays NULL until invite / admin / portal-link binds a tenant.
-- Intended student/parent role claim is unchanged; school-scoped RLS fails closed without school_id.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  _intended text;
  _has_role boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, school_id, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.phone,
    NULL, -- tenant binding is invite/admin/provisioning / link_portal_on_auth only
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        full_name = CASE
          WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END;
        -- never invent a school_id on conflict; leave existing or NULL

  PERFORM public.link_portal_on_auth(NEW.id);

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

  -- Never auto-link by client metadata admission_number (account-takeover vector).
  -- Portal email/phone linking (link_portal_on_auth) and admin-link-account only.

  IF NOT _has_role THEN
    _intended := lower(coalesce(NEW.raw_user_meta_data->>'intended_role', ''));
    IF _intended IN ('student', 'parent') THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (NEW.id, _intended::public.app_role)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.handle_new_user() IS
  'Creates profile without default school. Tenant bind via invite/admin/link_portal_on_auth only.';
