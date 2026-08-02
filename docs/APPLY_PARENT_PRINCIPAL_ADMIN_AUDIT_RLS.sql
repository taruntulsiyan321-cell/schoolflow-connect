-- =============================================================================
-- APPLY_PARENT_PRINCIPAL_ADMIN_AUDIT_RLS.sql
-- Source: supabase/migrations/20260802620000_parent_principal_admin_audit_rls.sql
-- Paste AFTER APPLY_QA_AUDITOR_DB_API_AUTH.sql (tenant pack: after AUTH_TENANT_HARDENING
-- + SUPERVISOR_D_TENANT_ISOLATION + QA_AUDITOR). Idempotent.
-- Parent self-update, parent DPP/notices join paths, principal/admin school-scoped
-- staff reads, tenant-scoped rpc_principal_school_health.
-- =============================================================================

-- ============================================================================
-- Parent + Principal + Admin audit — RLS closures
-- ============================================================================
-- 1. parents_self_update — parents may update their own row; school_id immutable
-- 2. dpps / dpp_attempts parent read — both parent_user_id and parent_students
--    join paths, tenant-scoped via same_school (idempotent re-create; matches
--    the fix already shipped in 20260802551000, kept here so this migration is
--    self-contained regardless of apply order)
-- 3. notices read class / section — add parent_students join path alongside
--    the existing student_class_id / teacher_teaches_class / parent_user_id paths
-- 4. Close the "principal reads every school" hole: drop the ungated
--    "students principal read" / "teachers principal read" / "teachers privileged
--    read" policies and replace with school-scoped staff reads
-- 5. rpc_principal_school_health — require get_my_school_id() and filter every
--    aggregate by that school (previously aggregated across ALL schools)
-- ============================================================================

-- ── 1. parents_self_update ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "parents_self_update" ON public.parents;
CREATE POLICY "parents_self_update" ON public.parents
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND school_id IS NOT DISTINCT FROM (
      SELECT pr.school_id FROM public.parents pr WHERE pr.user_id = auth.uid()
    )
  );

-- ── 2. dpps / dpp_attempts parent read — both join paths + same_school ──────
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

-- ── 3. notices read class / section — add parent_students path ─────────────
DROP POLICY IF EXISTS "notices read class" ON public.notices;
CREATE POLICY "notices read class" ON public.notices
  FOR SELECT TO authenticated
  USING (
    audience = 'class'::notice_audience
    AND class_id IS NOT NULL
    AND status = 'published'
    AND revoked_at IS NULL
    AND (
      student_class_id(auth.uid()) = class_id
      OR teacher_teaches_class(auth.uid(), class_id)
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
CREATE POLICY "notices read section" ON public.notices
  FOR SELECT TO authenticated
  USING (
    audience = 'section'::notice_audience
    AND class_id IS NOT NULL
    AND status = 'published'
    AND revoked_at IS NULL
    AND (
      student_class_id(auth.uid()) = class_id
      OR teacher_teaches_class(auth.uid(), class_id)
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

-- ── 4. Close cross-tenant principal/teacher read holes ──────────────────────
-- These legacy policies had no school scoping: any principal (or, for teachers,
-- any authenticated user via the later "teachers privileged read") could read
-- every student/teacher row across every school.
DROP POLICY IF EXISTS "students principal read" ON public.students;
DROP POLICY IF EXISTS "teachers principal read" ON public.teachers;
DROP POLICY IF EXISTS "teachers privileged read" ON public.teachers;

DROP POLICY IF EXISTS "students school staff read" ON public.students;
CREATE POLICY "students school staff read" ON public.students
  FOR SELECT TO authenticated
  USING (
    (
      public.has_role(auth.uid(), 'principal'::public.app_role)
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
    )
    AND public.same_school(school_id)
  );

DROP POLICY IF EXISTS "teachers school staff read" ON public.teachers;
CREATE POLICY "teachers school staff read" ON public.teachers
  FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      (
        public.has_role(auth.uid(), 'principal'::public.app_role)
        OR public.has_role(auth.uid(), 'admin'::public.app_role)
      )
      AND public.same_school(school_id)
    )
  );

-- ── 5. rpc_principal_school_health — tenant-scoped aggregates only ──────────
CREATE OR REPLACE FUNCTION public.rpc_principal_school_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _school uuid;
BEGIN
  IF NOT public.has_role(_uid, 'admin'::public.app_role)
     AND NOT public.has_role(_uid, 'principal'::public.app_role) THEN
    RAISE EXCEPTION 'Principal or admin only';
  END IF;

  _school := public.get_my_school_id();
  IF _school IS NULL THEN
    RAISE EXCEPTION 'No school linked to this account';
  END IF;

  RETURN jsonb_build_object(
    'engagement_score', (
      SELECT round(avg(CASE WHEN x.total_battles > 0 OR x.xp > 50 THEN 100 ELSE 40 END), 0)
      FROM public.student_xp x
      WHERE x.school_id = _school
    ),
    'attendance_today_pct', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE status = 'present') / count(*), 1)
        ELSE 0
      END
      FROM public.attendance
      WHERE date = CURRENT_DATE AND school_id = _school
    ),
    'dpp_completion_pct', (
      SELECT CASE WHEN count(DISTINCT d.id) > 0
        THEN round(100.0 * count(DISTINCT att.dpp_id) / count(DISTINCT d.id), 1)
        ELSE 0
      END
      FROM public.dpps d
      LEFT JOIN public.dpp_attempts att ON att.dpp_id = d.id AND att.status = 'submitted'
      WHERE d.is_published AND d.school_id = _school
    ),
    'classes', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'class_id', c.id,
        'name', COALESCE(c.display_name, c.name || '-' || c.section),
        'students', (
          SELECT count(*) FROM public.students s
          WHERE s.class_id = c.id AND s.school_id = _school
        ),
        'avg_xp', (
          SELECT round(avg(x.xp), 0)
          FROM public.students s
          JOIN public.student_xp x ON x.user_id = s.user_id
          WHERE s.class_id = c.id AND s.school_id = _school AND x.school_id = _school
        )
      )), '[]'::jsonb)
      FROM public.classes c
      WHERE (c.kind = 'class' OR c.kind IS NULL) AND c.school_id = _school
    ),
    'declining_classes', '[]'::jsonb,
    'improving_classes', '[]'::jsonb
  );
END; $$;
GRANT EXECUTE ON FUNCTION public.rpc_principal_school_health() TO authenticated;
