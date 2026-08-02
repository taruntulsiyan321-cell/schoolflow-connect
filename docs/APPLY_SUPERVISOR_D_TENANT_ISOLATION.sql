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
