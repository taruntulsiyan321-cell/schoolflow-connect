-- AUTH-C2: stop auto-tenanting self-signup into default_school_id.
-- See docs/APPLY_AUTH_SIGNUP_NO_DEFAULT_SCHOOL.sql for APPLY clipboard.

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
    NULL,
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        full_name = CASE
          WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END;

  PERFORM public.link_portal_on_auth(NEW.id);

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

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
