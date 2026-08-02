-- =============================================================================
-- APPLY_SUPERVISOR_D_TENANT_ISOLATION.sql
-- Source: supabase/migrations/20260802540000_supervisor_d_tenant_isolation_closures.sql
-- Paste into Supabase SQL Editor after APPLY_AUTH_TENANT_HARDENING.
-- Idempotent. Closes remaining cross-tenant RLS gaps (inquiries/complaints,
-- library, student_xp, progression history/achievements).
-- =============================================================================
-- ============================================================================
-- Supervisor D — tenant isolation closures (post auth hardening)
-- ============================================================================
-- Closes remaining cross-tenant leaks:
--   1. school_inquiries / school_complaints staff policies (role-only, no same_school)
--   2. library_books open SELECT (USING true) + admin checkout ALL without school
--   3. student_xp admin read without school scope
--   4. progression student tables: admin/principal read without same_school
--   5. inquiry INSERT WITH CHECK (true); complaint INSERT allowing submitted_by NULL
-- ============================================================================

-- ── 0. Ensure school_id columns + backfill ───────────────────────────────────
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'school_inquiries', 'school_complaints',
    'library_books', 'library_checkouts',
    'student_xp'
  ];
BEGIN
  FOREACH t IN ARRAY tables LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = t
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id)',
        t
      );
    END IF;
  END LOOP;
END $$;

UPDATE public.school_inquiries
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

UPDATE public.school_complaints
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

UPDATE public.library_books
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

UPDATE public.library_checkouts
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

UPDATE public.student_xp sx
SET school_id = p.school_id
FROM public.profiles p
WHERE sx.user_id = p.id
  AND sx.school_id IS NULL
  AND p.school_id IS NOT NULL;

UPDATE public.student_xp
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

-- ── 1. Inquiries — tenant-bind staff + inserts ───────────────────────────────
DROP POLICY IF EXISTS "inquiries staff all" ON public.school_inquiries;
CREATE POLICY "inquiries staff all" ON public.school_inquiries
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "inquiries anyone insert" ON public.school_inquiries;
CREATE POLICY "inquiries anyone insert" ON public.school_inquiries
  FOR INSERT TO authenticated
  WITH CHECK (
    school_id = public.get_my_school_id()
    AND (created_by IS NULL OR created_by = auth.uid())
  );

-- ── 2. Complaints — tenant-bind staff + submit/read ──────────────────────────
DROP POLICY IF EXISTS "complaints staff all" ON public.school_complaints;
CREATE POLICY "complaints staff all" ON public.school_complaints
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

DROP POLICY IF EXISTS "complaints submit" ON public.school_complaints;
CREATE POLICY "complaints submit" ON public.school_complaints
  FOR INSERT TO authenticated
  WITH CHECK (
    submitted_by = auth.uid()
    AND school_id = public.get_my_school_id()
  );

DROP POLICY IF EXISTS "complaints read own" ON public.school_complaints;
CREATE POLICY "complaints read own" ON public.school_complaints
  FOR SELECT TO authenticated
  USING (
    submitted_by = auth.uid()
    OR (
      public.same_school(school_id)
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
      )
    )
  );

-- ── 3. Library books — drop open catalog reads ───────────────────────────────
DROP POLICY IF EXISTS "Anyone can view books" ON public.library_books;
DROP POLICY IF EXISTS "books read auth" ON public.library_books;
DROP POLICY IF EXISTS "books school read" ON public.library_books;
CREATE POLICY "books school read" ON public.library_books
  FOR SELECT TO authenticated
  USING (public.same_school(school_id));

DROP POLICY IF EXISTS "Admins manage books" ON public.library_books;
DROP POLICY IF EXISTS "books admin all" ON public.library_books;
CREATE POLICY "books admin all" ON public.library_books
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

-- ── 4. Library checkouts — scope admin ALL to same_school ────────────────────
DROP POLICY IF EXISTS "Admins manage checkouts" ON public.library_checkouts;
DROP POLICY IF EXISTS "checkouts admin all" ON public.library_checkouts;
CREATE POLICY "checkouts admin all" ON public.library_checkouts
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
    )
  );

-- ── 5. student_xp — staff read must be same-school ───────────────────────────
DROP POLICY IF EXISTS "xp self read" ON public.student_xp;
CREATE POLICY "xp self read" ON public.student_xp
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      public.same_school(school_id)
      AND (
        public.has_role(auth.uid(), 'admin'::public.app_role)
        OR public.has_role(auth.uid(), 'principal'::public.app_role)
        OR public.has_role(auth.uid(), 'teacher'::public.app_role)
      )
    )
  );

-- Keep self upsert as-is (own row only); ensure WITH CHECK binds school when present
DROP POLICY IF EXISTS "xp self upsert" ON public.student_xp;
CREATE POLICY "xp self upsert" ON public.student_xp
  FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND (school_id IS NULL OR school_id = public.get_my_school_id())
  );

-- ── 6. Progression student tables — tenant-scope staff reads ─────────────────
DROP POLICY IF EXISTS student_achievements_self_read ON public.student_achievements;
CREATE POLICY student_achievements_self_read ON public.student_achievements
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = student_achievements.user_id
        AND public.same_school(p.school_id)
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'principal'::public.app_role)
        )
    )
  );

DROP POLICY IF EXISTS progression_history_self_read ON public.progression_history;
CREATE POLICY progression_history_self_read ON public.progression_history
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = progression_history.user_id
        AND public.same_school(p.school_id)
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'principal'::public.app_role)
        )
    )
  );

DROP POLICY IF EXISTS progression_league_history_self_read ON public.progression_league_history;
CREATE POLICY progression_league_history_self_read ON public.progression_league_history
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = progression_league_history.user_id
        AND public.same_school(p.school_id)
        AND (
          public.has_role(auth.uid(), 'admin'::public.app_role)
          OR public.has_role(auth.uid(), 'principal'::public.app_role)
        )
    )
  );

-- ── 7. Constraint hardening (idempotent) ─────────────────────────────────────
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parent_students'
  ) AND NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'parent_students_parent_id_student_id_key'
  ) THEN
    BEGIN
      ALTER TABLE public.parent_students
        ADD CONSTRAINT parent_students_parent_id_student_id_key UNIQUE (parent_id, student_id);
    EXCEPTION WHEN duplicate_table OR duplicate_object OR unique_violation THEN
      NULL;
    END;
  END IF;
END $$;

-- ── 8. Server-side school_id default on case inserts ─────────────────────────
CREATE OR REPLACE FUNCTION public.tg_set_school_id_from_session()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.school_id IS NULL THEN
    NEW.school_id := public.get_my_school_id();
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS school_inquiries_set_school ON public.school_inquiries;
CREATE TRIGGER school_inquiries_set_school
  BEFORE INSERT ON public.school_inquiries
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP TRIGGER IF EXISTS school_complaints_set_school ON public.school_complaints;
CREATE TRIGGER school_complaints_set_school
  BEFORE INSERT ON public.school_complaints
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();


-- ========== APPLY_QA_AUDITOR_DB_API_AUTH ==========

-- =============================================================================
-- APPLY_QA_AUDITOR_DB_API_AUTH.sql
-- Source: supabase/migrations/20260802551000_qa_auditor_db_api_auth_closures.sql
-- Paste AFTER APPLY_AUTH_TENANT_HARDENING.sql and APPLY_SUPERVISOR_D_TENANT_ISOLATION.sql.
-- Idempotent. Closes portal link, attendance_audit, parent DPP, schools/parents tenant gaps.
-- =============================================================================
-- ============================================================================
-- QA Auditor ΓÇö Database + API + Auth/RLS closures
-- ============================================================================
-- Fixes critical residual holes after auth tenant hardening + Supervisor D:
--   1. link_portal_on_auth: stop cross-tenant email/phone LIMIT 1 takeover
--   2. attendance_audit: deny open INSERT; tenant-scope SELECT; FKs
--   3. attendance_locks: FK class_id / locked_by (best-effort)
-- ΓöÇΓöÇ 4. Parent DPP RLS ΓÇö same_school + parent_students path ΓöÇΓöÇ
--   5. schools SELECT: admin/principal limited to own school_id
-- ΓöÇΓöÇ 6. Parents / parent_students ΓÇö staff reads require same_school ΓöÇΓöÇ
-- ============================================================================

---- 1. Portal auto-link: school-scoped or unambiguous single match ----------------------
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
    ELSE
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
        SET school_id = coalesce(p.school_id, t.school_id)
        FROM public.teachers t
        WHERE p.id = _uid AND t.id = _teacher_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.teachers WHERE id = _teacher_id));
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
    ELSE
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
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s
        WHERE p.id = _uid AND s.id = _student_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.students WHERE id = _student_id));
    END IF;
  END IF;

  -- Student by portal_phone (only if not already linked as student)
  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    _student_id := NULL;
    IF _profile_school IS NOT NULL THEN
      SELECT id INTO _student_id
      FROM public.students
      WHERE user_id IS NULL
        AND portal_phone = _phone
        AND school_id = _profile_school
      LIMIT 1;
    ELSE
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
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s
        WHERE p.id = _uid AND s.id = _student_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.students WHERE id = _student_id));
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
    ELSE
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
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s
        WHERE p.id = _uid AND s.id = _parent_student_id;
      _profile_school := coalesce(_profile_school, (SELECT school_id FROM public.students WHERE id = _parent_student_id));
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
    ELSE
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
        SET school_id = coalesce(p.school_id, s.school_id)
        FROM public.students s
        WHERE p.id = _uid AND s.id = _parent_student_id;
    END IF;
  END IF;
END;
$$;

COMMENT ON FUNCTION public.link_portal_on_auth(uuid) IS
  'Links auth user to teacher/student/parent portals. Matches within profile.school_id when set; otherwise only when exactly one unlinked candidate exists globally (no cross-tenant LIMIT 1).';

---- 2. Attendance audit ΓÇö FKs + tenant RLS (trigger is SECURITY DEFINER) ----------
ALTER TABLE public.attendance_audit
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);

UPDATE public.attendance_audit aa
SET school_id = c.school_id
FROM public.classes c
WHERE aa.class_id = c.id
  AND aa.school_id IS NULL
  AND c.school_id IS NOT NULL;

UPDATE public.attendance_audit
SET school_id = public.default_school_id()
WHERE school_id IS NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_attendance_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_audit
        ADD CONSTRAINT attendance_audit_attendance_id_fkey
        FOREIGN KEY (attendance_id) REFERENCES public.attendance(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_student_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_audit
        ADD CONSTRAINT attendance_audit_student_id_fkey
        FOREIGN KEY (student_id) REFERENCES public.students(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_class_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_audit
        ADD CONSTRAINT attendance_audit_class_id_fkey
        FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_audit_edited_by_fkey'
  ) THEN
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

-- Client inserts forbidden; SECURITY DEFINER trigger bypasses RLS
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

---- 3. Attendance locks FKs (best-effort) ------------------------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_locks_class_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_locks
        ADD CONSTRAINT attendance_locks_class_id_fkey
        FOREIGN KEY (class_id) REFERENCES public.classes(id) ON DELETE CASCADE;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'attendance_locks_locked_by_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.attendance_locks
        ADD CONSTRAINT attendance_locks_locked_by_fkey
        FOREIGN KEY (locked_by) REFERENCES auth.users(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

---- 4. Parent DPP RLS ΓÇö same_school + parent_students path --------------------------------------
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

---- 5. Schools catalog ΓÇö no cross-tenant staff listing ----------------------------------------------
DROP POLICY IF EXISTS schools_select_own ON public.schools;
CREATE POLICY schools_select_own ON public.schools
  FOR SELECT TO authenticated
  USING (
    id = (SELECT school_id FROM public.profiles WHERE id = auth.uid())
  );

---- 6. Parents / parent_students ΓÇö staff reads require same_school ----------------------
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
