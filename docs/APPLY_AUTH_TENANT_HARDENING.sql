-- ============================================================================
-- Investigator 5/8 — Auth / tenant isolation hardening
-- ============================================================================
-- Fixes:
--   1. Ignore client-supplied school_id on signup (metadata hop)
--   2. Freeze profiles.school_id / is_active against self-update
--   3. Drop legacy USING (true) SELECT policies that OR with same_school
--   4. Scope admin/principal ALL policies to same_school
--   5. Scope notices audience reads to same_school
--   6. Patch rpc_leaderboard school scope
--   7. Tenant-bind admin SECURITY DEFINER RPCs + link_portal_on_auth
-- ============================================================================

-- ── 0a. Ensure tenant columns exist (idempotent; live DBs may lag migrations) ─
-- profiles.school_id / is_active and school_id on policy-target tables must exist
-- BEFORE any function, trigger, or RLS policy references them.
CREATE TABLE IF NOT EXISTS public.schools (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text UNIQUE,
  logo_url text,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.schools (id, name, slug)
VALUES ('00000000-0000-4000-8000-000000000001', 'Wisdom Campus', 'wisdom-campus')
ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS school_id uuid REFERENCES public.schools(id);
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

-- Tables this script scopes with same_school(school_id) / admin RPCs
DO $$
DECLARE
  t text;
  tables text[] := ARRAY[
    'classes', 'students', 'teachers', 'teacher_classes',
    'attendance_locks', 'exams', 'marks', 'fees', 'notices',
    'class_timetables', 'community_doubts'
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

-- ── 0. Active-session helper (defense in depth for DEFINER RPCs) ─────────────
CREATE OR REPLACE FUNCTION public.require_active_profile()
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _active boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;
  SELECT is_active INTO _active FROM public.profiles WHERE id = _uid;
  IF _active IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Account disabled';
  END IF;
  RETURN _uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.require_active_profile() TO authenticated;

-- ── 1. Freeze tenant / activation columns on profiles ───────────────────────
CREATE OR REPLACE FUNCTION public.protect_profile_tenant_fields()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _jwt_role text := coalesce(
    current_setting('request.jwt.claim.role', true),
    current_setting('role', true),
    ''
  );
BEGIN
  -- Service role / auth trigger context may provision profiles.
  IF _jwt_role IN ('service_role', 'supabase_admin') THEN
    RETURN NEW;
  END IF;

  -- auth.uid() is null during handle_new_user / service provisioning — allow.
  IF TG_OP = 'UPDATE' THEN
    IF NEW.school_id IS DISTINCT FROM OLD.school_id THEN
      IF auth.uid() IS NULL THEN
        NULL; -- provisioning path
      ELSIF OLD.school_id IS NULL AND NEW.school_id IS NOT NULL AND auth.uid() = NEW.id THEN
        NULL; -- first-time portal bind into a school
      ELSIF public.has_role(auth.uid(), 'admin'::public.app_role)
         AND public.same_school(OLD.school_id)
         AND NEW.school_id = public.get_my_school_id() THEN
        NULL; -- school admin re-home within tenant
      ELSE
        RAISE EXCEPTION 'school_id cannot be changed by this principal';
      END IF;
    END IF;

    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      IF auth.uid() IS NULL THEN
        NULL;
      ELSIF public.has_role(auth.uid(), 'admin'::public.app_role)
         AND public.same_school(OLD.school_id) THEN
        NULL;
      ELSE
        RAISE EXCEPTION 'is_active cannot be changed by this principal';
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_protect_profile_tenant_fields ON public.profiles;
CREATE TRIGGER trg_protect_profile_tenant_fields
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.protect_profile_tenant_fields();

-- Tighten self-update policy WITH CHECK (defense in depth alongside trigger)
DROP POLICY IF EXISTS "profiles self update" ON public.profiles;
CREATE POLICY "profiles self update" ON public.profiles
  FOR UPDATE TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (
    auth.uid() = id
    AND school_id IS NOT DISTINCT FROM (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
    AND is_active IS NOT DISTINCT FROM (SELECT p.is_active FROM public.profiles p WHERE p.id = auth.uid())
  );

-- Scope admin profile access to own school
DROP POLICY IF EXISTS "profiles admin all" ON public.profiles;
CREATE POLICY "profiles admin all" ON public.profiles
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

-- Scope role writes to target users in the admin's school
DROP POLICY IF EXISTS "roles admin write" ON public.user_roles;
CREATE POLICY "roles admin write" ON public.user_roles
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND public.same_school(p.school_id)
    )
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = user_roles.user_id
        AND public.same_school(p.school_id)
    )
  );

-- ── 2. handle_new_user — never trust metadata school_id ─────────────────────
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  _default_school uuid := public.default_school_id();
  _intended text;
  _has_role boolean;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone, school_id, is_active)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.phone,
    _default_school, -- tenant binding is invite/admin/provisioning only
    true
  )
  ON CONFLICT (id) DO UPDATE
    SET email = EXCLUDED.email,
        phone = COALESCE(EXCLUDED.phone, public.profiles.phone),
        full_name = CASE
          WHEN EXCLUDED.full_name <> '' THEN EXCLUDED.full_name
          ELSE public.profiles.full_name
        END,
        school_id = COALESCE(public.profiles.school_id, _default_school);
        -- never overwrite an existing school_id from metadata

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

-- ── 3. Drop open SELECT policies (OR with same_school = cross-tenant leak) ──
DROP POLICY IF EXISTS "classes read" ON public.classes;
-- classes_school_read already scopes by same_school

DROP POLICY IF EXISTS "tc read all auth" ON public.teacher_classes;
DROP POLICY IF EXISTS "tc school read" ON public.teacher_classes;
CREATE POLICY "tc school read" ON public.teacher_classes
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    OR EXISTS (
      SELECT 1 FROM public.teachers t
      WHERE t.id = teacher_classes.teacher_id AND t.user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "exams read auth" ON public.exams;
DROP POLICY IF EXISTS "exams school read" ON public.exams;
CREATE POLICY "exams school read" ON public.exams
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR public.student_class_id(auth.uid()) = class_id
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = exams.class_id
      )
      OR EXISTS (
        SELECT 1 FROM public.parent_students ps
        JOIN public.students s ON s.id = ps.student_id
        JOIN public.parents p ON p.id = ps.parent_id
        WHERE p.user_id = auth.uid() AND s.class_id = exams.class_id
      )
    )
  );

DROP POLICY IF EXISTS "locks read auth" ON public.attendance_locks;
DROP POLICY IF EXISTS "locks school read" ON public.attendance_locks;
CREATE POLICY "locks school read" ON public.attendance_locks
  FOR SELECT TO authenticated
  USING (public.same_school(school_id));

DROP POLICY IF EXISTS "timetable read" ON public.class_timetables;
DROP POLICY IF EXISTS "timetable school read" ON public.class_timetables;
CREATE POLICY "timetable school read" ON public.class_timetables
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    OR EXISTS (
      SELECT 1 FROM public.classes c
      WHERE c.id = class_timetables.class_id AND public.same_school(c.school_id)
    )
  );

DROP POLICY IF EXISTS "badges read class" ON public.student_badges;
DROP POLICY IF EXISTS "badges school read" ON public.student_badges;
CREATE POLICY "badges school read" ON public.student_badges
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = student_badges.user_id
        AND public.same_school(p.school_id)
    )
  );

DROP POLICY IF EXISTS "community doubts read" ON public.community_doubts;
DROP POLICY IF EXISTS "community doubts school read" ON public.community_doubts;
CREATE POLICY "community doubts school read" ON public.community_doubts
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    OR class_id = public.student_class_id(auth.uid())
    OR public.teacher_teaches_class(auth.uid(), class_id)
  );

DROP POLICY IF EXISTS "community answers read" ON public.community_doubt_answers;
DROP POLICY IF EXISTS "community answers school read" ON public.community_doubt_answers;
CREATE POLICY "community answers school read" ON public.community_doubt_answers
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.community_doubts d
      WHERE d.id = community_doubt_answers.doubt_id
        AND (
          public.same_school(d.school_id)
          OR d.class_id = public.student_class_id(auth.uid())
          OR public.teacher_teaches_class(auth.uid(), d.class_id)
        )
    )
  );

DROP POLICY IF EXISTS "community reputation read" ON public.community_reputation;
DROP POLICY IF EXISTS "community reputation school read" ON public.community_reputation;
CREATE POLICY "community reputation school read" ON public.community_reputation
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.profiles p
      WHERE p.id = community_reputation.user_id
        AND public.same_school(p.school_id)
    )
  );

-- Drop stale open AI explanation policy if still present (tenant policy already added)
DROP POLICY IF EXISTS "ai_expl read" ON public.ai_explanations;

-- ── 4. Scope legacy admin/principal ALL policies to same_school ─────────────
DROP POLICY IF EXISTS "students admin and principal all" ON public.students;
CREATE POLICY "students admin and principal all" ON public.students
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

DROP POLICY IF EXISTS "classes admin and principal write" ON public.classes;
CREATE POLICY "classes admin and principal write" ON public.classes
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

DROP POLICY IF EXISTS "fees admin all" ON public.fees;
CREATE POLICY "fees admin all" ON public.fees
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "fees principal read" ON public.fees;
CREATE POLICY "fees principal read" ON public.fees
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "exams admin all" ON public.exams;
CREATE POLICY "exams admin all" ON public.exams
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "exams principal read" ON public.exams;
CREATE POLICY "exams principal read" ON public.exams
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "marks admin all" ON public.marks;
CREATE POLICY "marks admin all" ON public.marks
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "tc admin all" ON public.teacher_classes;
CREATE POLICY "tc admin all" ON public.teacher_classes
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "tc principal read" ON public.teacher_classes;
CREATE POLICY "tc principal read" ON public.teacher_classes
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

-- ── 5. Notices — audience reads must stay in-tenant ─────────────────────────
DROP POLICY IF EXISTS "notices admin full" ON public.notices;
CREATE POLICY "notices admin full" ON public.notices
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices principal full" ON public.notices;
CREATE POLICY "notices principal full" ON public.notices
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read all" ON public.notices;
CREATE POLICY "notices read all" ON public.notices
  FOR SELECT TO authenticated
  USING (audience = 'all' AND public.same_school(school_id));

DROP POLICY IF EXISTS "notices read teachers" ON public.notices;
CREATE POLICY "notices read teachers" ON public.notices
  FOR SELECT TO authenticated
  USING (
    audience = 'teachers'
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read parents" ON public.notices;
CREATE POLICY "notices read parents" ON public.notices
  FOR SELECT TO authenticated
  USING (
    audience = 'parents'
    AND public.has_role(auth.uid(), 'parent'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read students" ON public.notices;
CREATE POLICY "notices read students" ON public.notices
  FOR SELECT TO authenticated
  USING (
    audience = 'students'
    AND public.has_role(auth.uid(), 'student'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "notices read class" ON public.notices;
CREATE POLICY "notices read class" ON public.notices
  FOR SELECT TO authenticated
  USING (
    audience = 'class'::public.notice_audience
    AND class_id IS NOT NULL
    AND public.same_school(school_id)
    AND (
      public.student_class_id(auth.uid()) = class_id
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = notices.class_id
      )
    )
  );

DROP POLICY IF EXISTS "notices read section" ON public.notices;
CREATE POLICY "notices read section" ON public.notices
  FOR SELECT TO authenticated
  USING (
    audience = 'section'::public.notice_audience
    AND class_id IS NOT NULL
    AND public.same_school(school_id)
    AND (
      public.student_class_id(auth.uid()) = class_id
      OR public.teacher_teaches_class(auth.uid(), class_id)
      OR EXISTS (
        SELECT 1 FROM public.students s
        WHERE s.parent_user_id = auth.uid() AND s.class_id = notices.class_id
      )
    )
  );

-- ── 6. rpc_leaderboard — school scope must filter by caller's school ─────────
CREATE OR REPLACE FUNCTION public.rpc_leaderboard(
  _scope    text DEFAULT 'class',
  _category text DEFAULT 'xp',
  _subject  text DEFAULT NULL,
  _limit    int  DEFAULT 50
)
RETURNS TABLE (
  user_id        uuid,
  full_name      text,
  roll_number    text,
  class_label    text,
  score          numeric,
  detail         text,
  equipped_badge text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _cls uuid;
  _school uuid;
BEGIN
  PERFORM public.require_active_profile();
  _cls := public.student_class_id(auth.uid());
  SELECT s.school_id INTO _school
  FROM public.students s
  WHERE s.user_id = auth.uid()
  LIMIT 1;
  _school := coalesce(_school, public.get_my_school_id());

  IF _school IS NULL THEN
    RAISE EXCEPTION 'No school context';
  END IF;

  -- Class scope requires a class membership
  IF lower(coalesce(_scope, 'class')) <> 'school' AND _cls IS NULL THEN
    RETURN;
  END IF;

  RETURN QUERY
  WITH base AS (
    SELECT s.user_id AS uid, s.id AS sid, s.class_id AS cid, s.full_name, s.roll_number,
           COALESCE(c.name || '-' || c.section, 'Unassigned') AS class_label
    FROM public.students s
    LEFT JOIN public.classes c ON c.id = s.class_id
    WHERE s.user_id IS NOT NULL
      AND s.school_id = _school
      AND (
        lower(coalesce(_scope, 'class')) = 'school'
        OR s.class_id = _cls
      )
  ),
  scored AS (
    SELECT
      b.uid, b.full_name, b.roll_number, b.class_label,
      CASE _category
        WHEN 'xp'      THEN COALESCE(x.xp, 0)::numeric
        WHEN 'wins'    THEN COALESCE(x.wins, 0)::numeric
        WHEN 'streak'  THEN COALESCE(x.current_streak, 0)::numeric
        WHEN 'weekly'  THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('week', now())), 0)::numeric
        WHEN 'monthly' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('month', now())), 0)::numeric
        WHEN 'subject' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       JOIN public.battles bt ON bt.id = bp.battle_id
                                       WHERE bp.user_id = b.uid AND _subject IS NOT NULL
                                         AND lower(bt.subject) = lower(_subject)), 0)::numeric
        WHEN 'marks' THEN COALESCE((
            SELECT CASE WHEN SUM(e.max_marks) > 0
                        THEN ROUND(SUM(m.marks_obtained)::numeric / SUM(e.max_marks) * 100, 1) ELSE 0 END
            FROM public.marks m JOIN public.exams e ON e.id = m.exam_id
            WHERE m.student_id = b.sid), 0)::numeric
        WHEN 'attendance' THEN COALESCE((
            SELECT CASE WHEN COUNT(*) > 0
                        THEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(*) * 100, 0) ELSE 0 END
            FROM public.attendance a WHERE a.student_id = b.sid), 0)::numeric
        WHEN 'homework' THEN COALESCE((
            SELECT CASE WHEN (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) > 0
                        THEN ROUND(
                          (SELECT COUNT(*) FROM public.homework_submissions hs
                             JOIN public.homework h2 ON h2.id = hs.homework_id
                             WHERE hs.student_id = b.sid AND hs.status IN ('submitted','graded') AND h2.class_id = b.cid)::numeric
                          / (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) * 100, 0)
                        ELSE 0 END), 0)::numeric
        WHEN 'dpp' THEN COALESCE((
            SELECT ROUND(AVG(best), 0) FROM (
              SELECT MAX(CASE WHEN da.max_score > 0 THEN da.score::numeric / da.max_score * 100 ELSE 0 END) AS best
              FROM public.dpp_attempts da JOIN public.dpps dp ON dp.id = da.dpp_id
              WHERE da.user_id = b.uid AND da.status = 'submitted' AND dp.is_published
              GROUP BY da.dpp_id) t), 0)::numeric
        ELSE COALESCE(x.xp, 0)::numeric
      END AS score,
      CASE _category
        WHEN 'xp'     THEN 'Lvl ' || COALESCE(x.level,1) || ' · ' || COALESCE(x.wins,0) || ' wins'
        WHEN 'wins'   THEN COALESCE(x.total_battles,0) || ' battles'
        WHEN 'streak' THEN COALESCE(x.current_streak,0) || '-day streak'
        ELSE NULL
      END AS detail,
      x.equipped_badge AS equipped_badge
    FROM base b
    LEFT JOIN public.student_xp x ON x.user_id = b.uid
  )
  SELECT s.uid, s.full_name, s.roll_number, s.class_label, s.score, s.detail, s.equipped_badge
  FROM scored s
  ORDER BY s.score DESC, s.full_name ASC
  LIMIT GREATEST(_limit, 1);
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_leaderboard(text, text, text, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_leaderboard(text, text, text, int) TO authenticated;

-- ── 7. Admin DEFINER RPCs — require same_school on targets ───────────────────
CREATE OR REPLACE FUNCTION public.admin_set_unique_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only school admins can assign roles';
  END IF;
  IF _role::text = 'super_admin' THEN
    RAISE EXCEPTION 'super_admin cannot be assigned from the school admin panel';
  END IF;

  SELECT school_id INTO _target_school FROM public.profiles WHERE id = _user_id;
  IF _target_school IS NULL OR NOT public.same_school(_target_school) THEN
    RAISE EXCEPTION 'Target user is outside your school';
  END IF;

  DELETE FROM public.user_roles WHERE user_id = _user_id;
  INSERT INTO public.user_roles (user_id, role) VALUES (_user_id, _role);
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_assign_role(_identifier text, _role public.app_role)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _id text;
  _target_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can assign roles';
  END IF;
  IF _role IN ('principal'::public.app_role, 'admin'::public.app_role) THEN
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

  SELECT school_id INTO _target_school FROM public.profiles WHERE id = _uid;
  IF _target_school IS NULL OR NOT public.same_school(_target_school) THEN
    RAISE EXCEPTION 'Target user is outside your school';
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN _uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_remove_role(_user_id uuid, _role public.app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _target_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can remove roles';
  END IF;
  IF _role IN ('principal'::public.app_role, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Principal and Admin roles are managed by the platform owner only';
  END IF;
  SELECT school_id INTO _target_school FROM public.profiles WHERE id = _user_id;
  IF _target_school IS NULL OR NOT public.same_school(_target_school) THEN
    RAISE EXCEPTION 'Target user is outside your school';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_list_users_with_roles()
RETURNS TABLE(user_id uuid, email text, phone text, created_at timestamptz, roles public.app_role[])
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _school uuid := public.get_my_school_id();
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can list users';
  END IF;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'No school context';
  END IF;

  RETURN QUERY
  SELECT u.id, u.email::text, u.phone::text, u.created_at,
         COALESCE(array_agg(ur.role) FILTER (WHERE ur.role IS NOT NULL), ARRAY[]::public.app_role[])
  FROM auth.users u
  JOIN public.profiles p ON p.id = u.id AND p.school_id = _school
  LEFT JOIN public.user_roles ur ON ur.user_id = u.id
  GROUP BY u.id
  ORDER BY u.created_at DESC;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_connect_student_account(
  _student_id uuid,
  _identifier text,
  _as text DEFAULT 'student'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _uid uuid;
  _id text;
  _phone text;
  _student_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can connect student accounts';
  END IF;

  SELECT school_id INTO _student_school FROM public.students WHERE id = _student_id;
  IF _student_school IS NULL OR NOT public.same_school(_student_school) THEN
    RAISE EXCEPTION 'Student is outside your school';
  END IF;

  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF lower(coalesce(_as, 'student')) = 'parent' THEN
    IF position('@' IN _id) > 0 THEN
      SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
      IF _uid IS NULL THEN
        UPDATE public.students SET parent_portal_email = lower(_id) WHERE id = _student_id;
        RETURN NULL;
      END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_portal_email = lower(_id) WHERE id = _student_id;
    ELSE
      _phone := public.normalize_phone(_id);
      IF _phone IS NULL OR length(_phone) < 7 THEN RAISE EXCEPTION 'Invalid phone number'; END IF;
      SELECT id INTO _uid FROM auth.users WHERE public.normalize_phone(phone) = _phone LIMIT 1;
      IF _uid IS NULL THEN
        UPDATE public.students SET parent_mobile = _phone WHERE id = _student_id;
        RETURN NULL;
      END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_mobile = _phone WHERE id = _student_id;
    END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent') ON CONFLICT (user_id, role) DO NOTHING;
    UPDATE public.profiles SET school_id = coalesce(school_id, _student_school) WHERE id = _uid;
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
  UPDATE public.profiles SET school_id = coalesce(school_id, _student_school) WHERE id = _uid;
  RETURN _uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_student_account(_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _student_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can revoke student accounts';
  END IF;
  SELECT user_id, school_id INTO _uid, _student_school FROM public.students WHERE id = _student_id;
  IF _student_school IS NULL OR NOT public.same_school(_student_school) THEN
    RAISE EXCEPTION 'Student is outside your school';
  END IF;
  UPDATE public.students SET user_id = NULL, portal_email = NULL, portal_phone = NULL WHERE id = _student_id;
  IF _uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'student'::public.app_role;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_connect_teacher_account(_teacher_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _id text;
  _teacher_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can connect teacher accounts';
  END IF;
  SELECT school_id INTO _teacher_school FROM public.teachers WHERE id = _teacher_id;
  IF _teacher_school IS NULL OR NOT public.same_school(_teacher_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
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
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher'::public.app_role)
  ON CONFLICT (user_id, role) DO NOTHING;
  UPDATE public.profiles SET school_id = coalesce(school_id, _teacher_school) WHERE id = _uid;
  RETURN _uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_set_teacher_access(_teacher_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _teacher_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can change teacher access';
  END IF;
  SELECT school_id INTO _teacher_school FROM public.teachers WHERE id = _teacher_id;
  IF _teacher_school IS NULL OR NOT public.same_school(_teacher_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;
  UPDATE public.teachers SET status = CASE WHEN _active THEN 'active' ELSE 'inactive' END
    WHERE id = _teacher_id RETURNING user_id INTO _uid;
  IF _uid IS NOT NULL THEN
    IF _active THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher'::public.app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    ELSE
      DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'teacher'::public.app_role;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_teacher_account(_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _teacher_school uuid;
BEGIN
  PERFORM public.require_active_profile();
  IF NOT public.has_role(auth.uid(), 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'Only admins can revoke teacher accounts';
  END IF;
  SELECT user_id, school_id INTO _uid, _teacher_school FROM public.teachers WHERE id = _teacher_id;
  IF _teacher_school IS NULL OR NOT public.same_school(_teacher_school) THEN
    RAISE EXCEPTION 'Teacher is outside your school';
  END IF;
  UPDATE public.teachers SET user_id = NULL, status = 'inactive' WHERE id = _teacher_id;
  IF _uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'teacher'::public.app_role;
  END IF;
END;
$$;

-- link_portal_on_auth: callers may only link themselves (trigger has auth.uid() null)
CREATE OR REPLACE FUNCTION public.link_portal_on_auth(_uid uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _email text;
  _phone text;
  _teacher_id uuid;
  _student_id uuid;
  _parent_student_id uuid;
  _has_role boolean;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;
  IF auth.uid() IS NOT NULL AND _uid IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Cannot link portal for another user';
  END IF;

  SELECT lower(email), public.normalize_phone(phone) INTO _email, _phone
  FROM auth.users WHERE id = _uid;

  SELECT EXISTS(SELECT 1 FROM public.user_roles WHERE user_id = _uid) INTO _has_role;

  IF _email IS NOT NULL THEN
    SELECT id INTO _teacher_id FROM public.teachers WHERE lower(email) = _email AND user_id IS NULL LIMIT 1;
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
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students WHERE user_id IS NULL AND lower(portal_email) = _email LIMIT 1;
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
    END IF;
  END IF;

  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    SELECT id INTO _student_id FROM public.students WHERE user_id IS NULL AND portal_phone = _phone LIMIT 1;
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
    END IF;
  END IF;

  IF _email IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email LIMIT 1;
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
    END IF;
  END IF;

  IF _phone IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL AND public.normalize_phone(parent_mobile) = _phone LIMIT 1;
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

COMMENT ON FUNCTION public.require_active_profile() IS
  'Raises if JWT principal is missing or profiles.is_active is false.';
COMMENT ON FUNCTION public.protect_profile_tenant_fields() IS
  'Blocks self-service school_id / is_active changes; school admins may change within tenant.';
