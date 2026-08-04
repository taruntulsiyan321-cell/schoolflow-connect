-- =============================================================================
-- Close residual cross-tenant leaks on attendance/teachers/marks/homework/notices
--
-- Root cause: the original May 2026 policies granted admin/principal access by
-- has_role() alone, with no school_id check. The Aug 2026 hardening pass
-- (20260802510000_auth_tenant_security_hardening.sql and siblings) fixed this
-- pattern on students/profiles/user_roles/schools/parents/exams/classes/etc,
-- but missed these specific policies, which were never touched again after
-- their original creation:
--   - "att admin all" / "attendance principal read"      on public.attendance
--   - "teachers admin all"                                on public.teachers
--   - "marks principal read"                              on public.marks
--   - "homework admin all" / "homework principal read"    on public.homework
--   - "notices teacher class"                             on public.notices
--     (its `class_id IS NULL` branch, for school-wide notices, skipped the
--      tenant check entirely)
--
-- Net effect being closed: any admin or principal account, regardless of
-- which school they belong to, could read (and for the ALL policies, write)
-- every other school's attendance, teacher records (incl. salary), marks,
-- and homework, and any teacher could manage another school's school-wide
-- notices. All fixes below follow the same public.same_school(school_id)
-- pattern already used by the sibling policies these migrations left intact.
--
-- Verified by reconstructing the full policy history from supabase/migrations
-- in filename order; each policy touched here was created once and never
-- dropped/recreated by any later migration.
-- =============================================================================

-- ── attendance ────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "att admin all" ON public.attendance;
CREATE POLICY "att admin all" ON public.attendance
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "attendance principal read" ON public.attendance;
CREATE POLICY "attendance principal read" ON public.attendance
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

-- ── teachers ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "teachers admin all" ON public.teachers;
CREATE POLICY "teachers admin all" ON public.teachers
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

-- ── marks ─────────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "marks principal read" ON public.marks;
CREATE POLICY "marks principal read" ON public.marks
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

-- ── homework ──────────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "homework admin all" ON public.homework;
CREATE POLICY "homework admin all" ON public.homework
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "homework principal read" ON public.homework;
CREATE POLICY "homework principal read" ON public.homework
  FOR SELECT TO authenticated
  USING (
    public.has_role(auth.uid(), 'principal'::public.app_role)
    AND public.same_school(school_id)
  );

-- ── notices ───────────────────────────────────────────────────────────────
-- "notices principal post" (INSERT-only, unscoped) was superseded by the
-- properly-scoped "notices principal full" back in 20260509050014's
-- drop-all-then-recreate pass and was never recreated since — this DROP is
-- defensive/idempotent in case that reconstruction is wrong in some env.
DROP POLICY IF EXISTS "notices principal post" ON public.notices;

DROP POLICY IF EXISTS "notices teacher class" ON public.notices;
CREATE POLICY "notices teacher class" ON public.notices
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND public.same_school(school_id)
    AND (class_id IS NULL OR public.teacher_teaches_class(auth.uid(), class_id))
  )
  WITH CHECK (
    public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND public.same_school(school_id)
    AND (class_id IS NULL OR public.teacher_teaches_class(auth.uid(), class_id))
  );
