-- =============================================================================
-- APPLY_QA_AUDITOR_DB_API_AUTH.sql
-- Source: supabase/migrations/20260802560000_qa_auditor_db_api_auth_closures.sql
-- Paste into Supabase SQL Editor AFTER APPLY_AUTH_TENANT_HARDENING.sql and
-- APPLY_SUPERVISOR_D_TENANT_ISOLATION.sql. Idempotent.
-- Closes portal cross-tenant link, attendance_audit open INSERT, parent DPP
-- tenant gaps, schools/parents staff cross-tenant reads.
-- =============================================================================
-- ============================================================================
-- QA Auditor ΓÇö Database + API + Auth/RLS closures
-- ============================================================================
-- Fixes critical residual holes after auth tenant hardening + Supervisor D:
--   1. link_portal_on_auth: stop cross-tenant email/phone LIMIT 1 takeover
--   2. attendance_audit: deny open INSERT; tenant-scope SELECT; FKs
--   3. attendance_locks: FK class_id / locked_by (best-effort)
--   4. Parent DPP RLS: same_school + parent_students join path
--   5. schools SELECT: admin/principal limited to own school_id
--   6. parents / parent_students staff SELECT: require same_school
-- ============================================================================

-- ΓöÇΓöÇ 1. Portal auto-link: school-scoped or unambiguous single match ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
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

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid) INTO _has_role;

  IF _email IS NOT NULL THEN
    _teacher_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _teacher_id
      FROM public.teachers
      WHERE lower(email) = _email AND user_id IS NULL AND school_id = _profile_school
      LIMIT 1;
    ELSE
      SELECT count(*)::int INTO _match_count
      FROM public.teachers WHERE lower(email) = _email AND user_id IS NULL;
      IF _match_count = 1 THEN
        SELECT id INTO _teacher_id FROM public.teachers
        WHERE lower(email) = _email AND user_id IS NULL LIMIT 1;
      END IF;
    END IF;

    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = coalesce(p.school_id, t.school_id)
        FROM public.teachers t WHERE p.id = _uid AND t.id = _teacher_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.teachers WHERE id = _teacher_id));
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id FROM public.students
      WHERE user_id IS NULL AND lower(portal_email) = _email AND school_id = _profile_school
      LIMIT 1;
    ELSE
      SELECT count(*)::int INTO _match_count FROM public.students
      WHERE user_id IS NULL AND lower(portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id FROM public.students
        WHERE user_id IS NULL AND lower(portal_email) = _email LIMIT 1;
      END IF;
    END IF;

    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s WHERE p.id = _uid AND s.id = _student_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.students WHERE id = _student_id));
    END IF;
  END IF;

  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id FROM public.students
      WHERE user_id IS NULL AND portal_phone = _phone AND school_id = _profile_school
      LIMIT 1;
    ELSE
      SELECT count(*)::int INTO _match_count FROM public.students
      WHERE user_id IS NULL AND portal_phone = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _student_id FROM public.students
        WHERE user_id IS NULL AND portal_phone = _phone LIMIT 1;
      END IF;
    END IF;

    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s WHERE p.id = _uid AND s.id = _student_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.students WHERE id = _student_id));
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email AND school_id = _profile_school
      LIMIT 1;
    ELSE
      SELECT count(*)::int INTO _match_count FROM public.students
      WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id FROM public.students
        WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email LIMIT 1;
      END IF;
    END IF;

    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid WHERE id = _parent_student_id;
      IF NOT _has_role THEN
        INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id) DO NOTHING;
        _has_role := true;
      END IF;
      UPDATE public.profiles p
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s WHERE p.id = _uid AND s.id = _parent_student_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.students WHERE id = _parent_student_id));
    END IF;
  END IF;

  IF _phone IS NOT NULL THEN
    _parent_student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL
        AND public.normalize_phone(parent_mobile) = _phone
        AND school_id = _profile_school
      LIMIT 1;
    ELSE
      SELECT count(*)::int INTO _match_count FROM public.students
      WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone;
      IF _match_count = 1 THEN
        SELECT id INTO _parent_student_id FROM public.students
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
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s WHERE p.id = _uid AND s.id = _parent_student_id;
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.link_portal_on_auth(uuid) IS
  'Links auth user to teacher/student/parent portals. Matches within profile.school_id when set; otherwise only when exactly one unlinked candidate exists globally (no cross-tenant LIMIT 1).';

-- ΓöÇΓöÇ 2. Attendance audit ΓÇö FKs + tenant RLS (trigger is SECURITY DEFINER) ΓöÇΓöÇΓöÇΓöÇΓöÇ
ALTER TABLE public.attendance_audit
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

UPDATE public.attendance_audit aa
SET school_id = c.school_id
FROM public.classes c
WHERE aa.class_id = c.id AND aa.school_id IS NULL AND c.school_id IS NOT NULL;

UPDATE public.attendance_audit
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_attendance_id_fkey') THEN
    BEGIN
      ALTER TABLE public.attendance_audit
        ADD CONSTRAINT attendance_audit_attendance_id_fkey
        FOREIGN KEY (attendance_id) REFERENCES public.attendance(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_student_id_fkey') THEN
    BEGIN
      ALTER TABLE public.attendance_audit
        ADD CONSTRAINT attendance_audit_student_id_fkey
        FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_class_id_fkey') THEN
    BEGIN
      ALTER TABLE public.attendance_audit
        ADD CONSTRAINT attendance_audit_class_id_fkey
        FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_edited_by_fkey') THEN
    BEGIN
      ALTER TABLE public.attendance_audit
        ADD CONSTRAINT attendance_audit_edited_by_fkey
        FOREIGN KEY (edited_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

DROP POLICY IF EXISTS "audit principal admin read" ON public.attendance_audit;
DROP POLICY IF EXISTS "audit school staff read" ON public.attendance_audit;
CREATE POLICY "audit school staff read" ON public.attendance_audit
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "audit any authenticated insert" ON public.attendance_audit;
DROP POLICY IF EXISTS "audit no client insert" ON public.attendance_audit;
CREATE POLICY "audit no client insert" ON public.attendance_audit
  FOR INSERT TO authenticated
  WITH CHECK (false);

CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _school uuid;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT school_id INTO _school FROM public.classes WHERE id = NEW.class_id;
    INSERT INTO public.attendance_audit (
      attendance_id, student_id, class_id, date,
      prev_status, new_status, edited_by, school_id
    )
    VALUES (
      NEW.id, NEW.student_id, NEW.class_id, NEW.date,
      OLD.status::text, NEW.status::text, auth.uid(),
      coalesce(_school, NEW.school_id, public.default_school_id())
    );
  END IF;
  RETURN NEW;
END;
$$;

-- ΓöÇΓöÇ 3. Attendance locks FKs (best-effort) ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_locks_class_id_fkey') THEN
    BEGIN
      ALTER TABLE public.attendance_locks
        ADD CONSTRAINT attendance_locks_class_id_fkey
        FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'attendance_locks_locked_by_fkey') THEN
    BEGIN
      ALTER TABLE public.attendance_locks
        ADD CONSTRAINT attendance_locks_locked_by_fkey
        FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

-- ΓöÇΓöÇ 4. Parent DPP RLS ΓÇö same_school + parent_students path ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
DROP POLICY IF EXISTS "dpps parent read published" ON public.dpps;
CREATE POLICY "dpps parent read published" ON public.dpps
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'parent'::public.app_role)
    AND COALESCE(is_published, false) = true
    AND public.same_school(school_id)
    AND (
      EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid()
          AND s.class_id = dpps.class_id
          AND public.same_school(s.school_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.parent_students ps
        JOIN public.parents p ON p.id = ps.parent_id
        JOIN public.students s ON s.id = ps.student_id
        WHERE p.user_id = auth.uid()
          AND s.class_id = dpps.class_id
          AND public.same_school(s.school_id)
      )
    )
  );

DROP POLICY IF EXISTS "dppa parent read child" ON public.dpp_attempts;
CREATE POLICY "dppa parent read child" ON public.dpp_attempts
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'parent'::public.app_role)
    AND (
      EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid()
          AND s.user_id = dpp_attempts.user_id
          AND public.same_school(s.school_id)
      )
      OR EXISTS (
        SELECT 1
        FROM public.parent_students ps
        JOIN public.parents p ON p.id = ps.parent_id
        JOIN public.students s ON s.id = ps.student_id
        WHERE p.user_id = auth.uid()
          AND s.user_id = dpp_attempts.user_id
          AND public.same_school(s.school_id)
      )
    )
  );

-- ΓöÇΓöÇ 5. Schools catalog ΓÇö no cross-tenant staff listing ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
DROP POLICY IF EXISTS schools_select_own ON public.schools;
CREATE POLICY schools_select_own ON public.schools
  FOR SELECT TO authenticated
  USING (
    id = (SELECT school_id FROM public.profiles WHERE id = auth.uid())
  );

-- ΓöÇΓöÇ 6. Parents / parent_students ΓÇö staff reads require same_school ΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇΓöÇ
DROP POLICY IF EXISTS parents_school_select ON public.parents;
CREATE POLICY parents_school_select ON public.parents
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.same_school(school_id)
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
    )
  );

DROP POLICY IF EXISTS parent_students_select ON public.parent_students;
CREATE POLICY parent_students_select ON public.parent_students
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.parents p
      WHERE p.id = parent_id AND p.user_id = auth.uid()
    )
    OR (
      public.same_school(school_id)
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
    )
  );
