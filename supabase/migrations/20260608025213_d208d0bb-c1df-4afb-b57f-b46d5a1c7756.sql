CREATE OR REPLACE FUNCTION public.normalize_phone(_raw text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT NULLIF(regexp_replace(coalesce(_raw, ''), '\D', '', 'g'), '');
$$;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS portal_email text,
  ADD COLUMN IF NOT EXISTS portal_phone text,
  ADD COLUMN IF NOT EXISTS parent_portal_email text;

CREATE UNIQUE INDEX IF NOT EXISTS students_portal_email_unique
  ON public.students (lower(portal_email))
  WHERE portal_email IS NOT NULL AND user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS students_portal_phone_unique
  ON public.students (portal_phone)
  WHERE portal_phone IS NOT NULL AND user_id IS NULL;

CREATE OR REPLACE FUNCTION public.link_portal_on_auth(_uid uuid DEFAULT auth.uid())
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE _email text; _phone text; _teacher_id uuid; _student_id uuid; _parent_student_id uuid;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  SELECT lower(email), public.normalize_phone(phone) INTO _email, _phone
  FROM auth.users WHERE id = _uid;

  IF _email IS NOT NULL THEN
    SELECT id INTO _teacher_id FROM public.teachers WHERE lower(email) = _email AND user_id IS NULL LIMIT 1;
    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher') ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students WHERE user_id IS NULL AND lower(portal_email) = _email LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    SELECT id INTO _student_id FROM public.students WHERE user_id IS NULL AND portal_phone = _phone LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email LIMIT 1;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF _phone IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone LIMIT 1;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
END; $$;

GRANT EXECUTE ON FUNCTION public.link_portal_on_auth(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth, extensions AS $$
DECLARE _student_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (NEW.id, COALESCE(NEW.raw_user_meta_data->>'full_name', ''), NEW.email, NEW.phone)
  ON CONFLICT (id) DO NOTHING;
  PERFORM public.link_portal_on_auth(NEW.id);
  IF NEW.raw_user_meta_data->>'admission_number' IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students
      WHERE admission_number = NEW.raw_user_meta_data->>'admission_number' AND user_id IS NULL LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = NEW.id WHERE id = _student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student') ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;
  RETURN NEW;
END; $$;

CREATE OR REPLACE FUNCTION public.ensure_default_role()
RETURNS app_role LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _existing app_role;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;
  PERFORM public.link_portal_on_auth(_uid);
  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN 'student'::app_role;
END; $$;

DROP FUNCTION IF EXISTS public.admin_connect_student_account(uuid, text);
CREATE OR REPLACE FUNCTION public.admin_connect_student_account(_student_id uuid, _identifier text, _as text DEFAULT 'student')
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, auth AS $$
DECLARE _uid uuid; _id text; _phone text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only admins can connect student accounts'; END IF;
  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;
  IF lower(coalesce(_as, 'student')) = 'parent' THEN
    IF position('@' IN _id) > 0 THEN
      SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
      IF _uid IS NULL THEN UPDATE public.students SET parent_portal_email = lower(_id) WHERE id = _student_id; RETURN NULL; END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_portal_email = lower(_id) WHERE id = _student_id;
    ELSE
      _phone := public.normalize_phone(_id);
      IF _phone IS NULL OR length(_phone) < 7 THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
      SELECT id INTO _uid FROM auth.users WHERE public.normalize_phone(phone) = _phone LIMIT 1;
      IF _uid IS NULL THEN UPDATE public.students SET parent_mobile = _phone WHERE id = _student_id; RETURN NULL; END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_mobile = _phone WHERE id = _student_id;
    END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id, role) DO NOTHING;
    RETURN _uid;
  END IF;
  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
    IF _uid IS NULL THEN
      UPDATE public.students SET portal_email = lower(_id), portal_phone = NULL WHERE id = _student_id;
      RETURN NULL;
    END IF;
    UPDATE public.students SET user_id = _uid, portal_email = lower(_id) WHERE id = _student_id;
  ELSE
    _phone := public.normalize_phone(_id);
    IF _phone IS NULL OR length(_phone) < 7 THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
    SELECT id INTO _uid FROM auth.users WHERE public.normalize_phone(phone) = _phone LIMIT 1;
    IF _uid IS NULL THEN
      UPDATE public.students SET portal_phone = _phone, portal_email = NULL WHERE id = _student_id;
      RETURN NULL;
    END IF;
    UPDATE public.students SET user_id = _uid, portal_phone = _phone WHERE id = _student_id;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id, role) DO NOTHING;
  RETURN _uid;
END; $$;

CREATE OR REPLACE FUNCTION public.admin_revoke_student_account(_student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN RAISE EXCEPTION 'Only admins can revoke student accounts'; END IF;
  SELECT user_id INTO _uid FROM public.students WHERE id = _student_id;
  UPDATE public.students SET user_id = NULL, portal_email = NULL, portal_phone = NULL WHERE id = _student_id;
  IF _uid IS NOT NULL THEN DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'student'::app_role; END IF;
END; $$;