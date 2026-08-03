-- ============================================================================
-- Auth / RLS / Session auditor closures (critical)
-- ============================================================================
-- C1. Notices SELECT — restore same_school after published-status regression
-- C2. Stop pinning every signup/bootstrap to default_school_id()
-- C3. ensure_default_role — never invent 'student'; fail closed
-- C4. profiles/roles SELECT — admin reads must be same_school scoped
-- C5. classes SELECT — drop open school_id IS NULL branch
-- Also: link_portal unambiguous fallback when wrongly pinned to default school;
--       battle_reports UPDATE WITH CHECK mirrors USING (integrity)
-- ============================================================================

-- ── C1. Notices — tenant + published + non-revoked ───────────────────────────
DROP POLICY IF EXISTS "notices read all" ON public.notices;
CREATE POLICY "notices read all"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'all'
    AND status = 'published'
    AND revoked_at IS NULL
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read teachers" ON public.notices;
CREATE POLICY "notices read teachers"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'teachers'
    AND status = 'published'
    AND revoked_at IS NULL
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read students" ON public.notices;
CREATE POLICY "notices read students"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'students'
    AND status = 'published'
    AND revoked_at IS NULL
    AND public.has_role(auth.uid(), 'student'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read parents" ON public.notices;
CREATE POLICY "notices read parents"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'parents'
    AND status = 'published'
    AND revoked_at IS NULL
    AND public.has_role(auth.uid(), 'parent'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read class" ON public.notices;
CREATE POLICY "notices read class"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'class'::public.notice_audience
    AND class_id IS NOT NULL
    AND status = 'published'
    AND revoked_at IS NULL
    AND public.same_school(school_id)
    AND (
      public.student_class_id(auth.uid()) = class_id
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = notices.class_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.parent_students ps
        JOIN public.parents p ON p.id = ps.parent_id
        JOIN public.students s ON s.id = ps.student_id
        WHERE p.user_id = auth.uid() AND s.class_id = notices.class_id
      )
    )
  );

DROP POLICY IF EXISTS "notices read section" ON public.notices;
CREATE POLICY "notices read section"
  ON public.notices FOR SELECT TO authenticated
  USING (
    audience = 'section'::public.notice_audience
    AND class_id IS NOT NULL
    AND status = 'published'
    AND revoked_at IS NULL
    AND public.same_school(school_id)
    AND (
      public.student_class_id(auth.uid()) = class_id
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = notices.class_id
      )
      OR EXISTS (
        SELECT 1
        FROM public.parent_students ps
        JOIN public.parents p ON p.id = ps.parent_id
        JOIN public.students s ON s.id = ps.student_id
        WHERE p.user_id = auth.uid() AND s.class_id = notices.class_id
      )
    )
  );

-- ── C5. Classes — no global null-school read ─────────────────────────────────
DROP POLICY IF EXISTS classes_school_read ON public.classes;
CREATE POLICY classes_school_read ON public.classes
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    OR id = public.student_class_id(auth.uid())
    OR public.teacher_teaches_class(auth.uid(), id)
    OR EXISTS (
      SELECT 1
      FROM public.students s
      WHERE s.class_id = classes.id
        AND s.parent_user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1
      FROM public.parent_students ps
      JOIN public.students s ON s.id = ps.student_id
      JOIN public.parents pr ON pr.id = ps.parent_id
      WHERE s.class_id = classes.id
        AND pr.user_id = auth.uid()
    )
  );

-- ── C4. Profiles / roles — admin SELECT is same-school only ──────────────────
DROP POLICY IF EXISTS "profiles self read" ON public.profiles;
CREATE POLICY "profiles self read" ON public.profiles
  FOR SELECT TO authenticated
  USING (
    auth.uid() = id
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND public.same_school(school_id)
    )
  );

DROP POLICY IF EXISTS "roles self read" ON public.user_roles;
CREATE POLICY "roles self read" ON public.user_roles
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      AND EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = user_roles.user_id
          AND public.same_school(p.school_id)
      )
    )
  );

-- ── C3. Never invent a student role ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.ensure_default_role()
RETURNS public.app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing public.app_role;
BEGIN
  IF _uid IS NULL THEN
    RETURN NULL;
  END IF;
  -- Portal link may assign a real role; we never INSERT a synthetic student.
  BEGIN
    PERFORM public.link_portal_on_auth(_uid);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  RETURN _existing;
END;
$$;

COMMENT ON FUNCTION public.ensure_default_role() IS
  'Links portal rows if needed and returns the existing user_roles row. Never invents student.';

-- ── C2. handle_new_user — leave school_id NULL until invite/portal bind ──────
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
    NULL, -- tenant binding is invite / admin / portal link only
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        full_name = CASE
          WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END;
        -- never invent or overwrite school_id from metadata / default school

  PERFORM public.link_portal_on_auth(NEW.id);

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = NEW.id) INTO _has_role;

  -- Never auto-link by client metadata admission_number (account-takeover vector).
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

-- ── C2. get_auth_context — no default-school coalesce; no invented role ──────
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
SET search_path = public, auth
AS $$
DECLARE
  _uid uuid := auth.uid();
  _intended text;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  PERFORM public.link_portal_on_auth(_uid);

  INSERT INTO public.profiles (id, full_name, email, school_id, is_active)
  SELECT _uid,
         coalesce((SELECT raw_user_meta_data->>'full_name' FROM auth.users WHERE id = _uid), ''),
         (SELECT email FROM auth.users WHERE id = _uid),
         NULL,
         true
  ON CONFLICT (id) DO NOTHING;

  -- Apply intended_role if still missing (student|parent only). Never invent student.
  IF NOT EXISTS (SELECT 1 FROM public.user_roles WHERE user_id = _uid) THEN
    SELECT lower(coalesce(raw_user_meta_data->>'intended_role', ''))
      INTO _intended FROM auth.users WHERE id = _uid;
    IF _intended IN ('student', 'parent') THEN
      INSERT INTO public.user_roles (user_id, role)
      VALUES (_uid, _intended::public.app_role)
      ON CONFLICT (user_id) DO NOTHING;
    END IF;
  END IF;

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

-- ── link_portal: unambiguous fallback + overwrite school from portal ─────────
-- Fixes accounts wrongly pinned to default_school that could not match other tenants.
CREATE OR REPLACE FUNCTION public.link_portal_on_auth(_uid uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _email text;
  _phone text;
  _profile_school uuid;
  _default_school uuid := public.default_school_id();
  _allow_global boolean;
  _teacher_id uuid;
  _student_id uuid;
  _parent_student_id uuid;
  _has_role boolean;
  _match_count int;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot link portal for another user';
  END IF;

  SELECT lower(email), public.normalize_phone(phone) INTO _email, _phone
  FROM auth.users WHERE id = _uid;

  SELECT school_id INTO _profile_school FROM public.profiles WHERE id = _uid;
  _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid) INTO _has_role;

  -- Teacher by email
  IF _email IS NOT NULL THEN
    _teacher_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _teacher_id
      FROM public.teachers
      WHERE lower(email) = _email
        AND user_id IS NULL
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    -- Unambiguous global only when unbound or stuck on default school
    IF _teacher_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.teachers
      WHERE lower(email) = _email AND user_id IS NULL;
      IF _match_count = 1 THEN
        SELECT id INTO _teacher_id
        FROM public.teachers
        WHERE lower(email) = _email AND user_id IS NULL
        LIMIT 1;
      END IF;
    END IF;

    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = t.school_id
        FROM public.teachers t
        WHERE p.id = _uid AND t.id = _teacher_id AND t.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.teachers WHERE id = _teacher_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Student by portal_email
  IF _email IS NOT NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id
      FROM public.students
      WHERE user_id IS NULL
        AND lower(portal_email) = _email
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE user_id IS NULL AND lower(portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id
        FROM public.students
        WHERE user_id IS NULL AND lower(portal_email) = _email
        LIMIT 1;
      END IF;
    END IF;

    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.students WHERE id = _student_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Student by portal_phone
  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id
      FROM public.students
      WHERE user_id IS NULL
        AND portal_phone = _phone
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE user_id IS NULL AND portal_phone = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id
        FROM public.students
        WHERE user_id IS NULL AND portal_phone = _phone
        LIMIT 1;
      END IF;
    END IF;

    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.students WHERE id = _student_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Parent by parent_portal_email
  IF _email IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id
      FROM public.students
      WHERE parent_user_id IS NULL
        AND lower(parent_portal_email) = _email
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _parent_student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id
        FROM public.students
        WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email
        LIMIT 1;
      END IF;
    END IF;

    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _parent_student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
      _profile_school := coalesce((SELECT school_id FROM public.students WHERE id = _parent_student_id), _profile_school);
      _allow_global := (_profile_school IS NULL OR _profile_school = _default_school);
    END IF;
  END IF;

  -- Parent by parent_mobile
  IF _phone IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id
      FROM public.students
      WHERE parent_user_id IS NULL
        AND public.normalize_phone(parent_mobile) = _phone
        AND school_id = _profile_school
      LIMIT 1;
    END IF;
    IF _parent_student_id IS NULL AND _allow_global THEN
      SELECT count(*)::int INTO _match_count
      FROM public.students
      WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id
        FROM public.students
        WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone
        LIMIT 1;
      END IF;
    END IF;

    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id) DO NOTHING;
      END IF;
      UPDATE public.profiles p
        SET school_id = s.school_id
        FROM public.students s
        WHERE p.id = _uid AND s.id = _parent_student_id AND s.school_id IS NOT NULL
          AND (p.school_id IS NULL OR p.school_id = _default_school);
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.link_portal_on_auth(uuid) IS
  'Links teacher/student/parent portal rows by email/phone. School-scoped when profile has school; unambiguous global fallback recovers default-school pins. Overwrites profile.school_id from portal.';

-- Identity RPC: keep ensure_default_role (now safe) — no invented student
CREATE OR REPLACE FUNCTION public.rpc_get_my_student_identity()
RETURNS TABLE (
  user_id uuid,
  role public.app_role,
  has_student_role boolean,
  student_id uuid,
  school_id uuid,
  class_id uuid,
  class_name text,
  class_section text,
  class_display_name text,
  class_category text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _role public.app_role;
  _has_student_role boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RETURN;
  END IF;

  BEGIN
    PERFORM public.link_portal_on_auth(_uid);
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
  BEGIN
    PERFORM public.ensure_default_role();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  _has_student_role := EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = _uid AND ur.role = 'student'::public.app_role
  );
  _role := CASE
    WHEN _has_student_role
     AND EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = _uid)
    THEN 'student'::public.app_role
    ELSE public.get_my_role()
  END;

  UPDATE public.profiles p
  SET school_id = s.school_id
  FROM public.students s
  WHERE p.id = _uid
    AND s.user_id = _uid
    AND s.school_id IS NOT NULL
    AND p.school_id IS DISTINCT FROM s.school_id;

  RETURN QUERY
  SELECT
    _uid,
    _role,
    _has_student_role,
    s.id,
    COALESCE(s.school_id, public.get_my_school_id()),
    s.class_id,
    c.name,
    c.section,
    c.display_name,
    c.category
  FROM (SELECT _uid AS uid) AS u
  LEFT JOIN public.students s ON s.user_id = u.uid
  LEFT JOIN public.classes c ON c.id = s.class_id;
END;
$$;

-- ── battle_reports UPDATE integrity (WITH CHECK must not be open) ────────────
DROP POLICY IF EXISTS "br ai update self" ON public.battle_reports;
CREATE POLICY "br ai update self" ON public.battle_reports
  FOR UPDATE TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.battles b
      WHERE b.id = battle_id
        AND (
          b.creator_user_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR (b.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  )
  WITH CHECK (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.battles b
      WHERE b.id = battle_id
        AND (
          b.creator_user_id = auth.uid()
          OR public.has_role(auth.uid(), 'admin'::public.app_role)
          OR (b.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), b.class_id))
        )
    )
  );
