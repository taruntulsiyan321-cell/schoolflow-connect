-- =============================================================================
-- Close cross-tenant leaks on concept_mastery / student_mistakes /
-- student_academic_brain (found during the AI-subsystem architecture audit)
--
-- Root cause: identical to 20260804000000_close_admin_principal_tenant_leaks.sql
-- (attendance/teachers/marks/homework/notices) -- the original policies granted
-- admin/principal read access by has_role() alone, with no school_id check:
--   - "mastery teacher"  on public.concept_mastery       (20260613000000)
--   - "mistakes teacher class" on public.student_mistakes (20260606000000,
--     recreated verbatim 20260608025417)
--   - "brain teacher"    on public.student_academic_brain (20260619000000,
--     recreated verbatim 20260804020000 -- the "recreate missing table"
--     migration reproduced the same unscoped policy rather than fixing it)
--
-- These three tables are core inputs to the AI subsystem (EIE mastery
-- projections, Nova chat facts, the Gemini-backed recovery/revision/coach
-- agents' "academic brain" context) and were missed by both the 2026-08-02
-- tenant-hardening pass and the 2026-08-04 follow-up, which covered a
-- different set of tables. Net effect being closed: any admin or principal
-- account, regardless of school, could read every other school's concept
-- mastery scores, wrong-answer/mistake records, and full academic-brain
-- summaries (weak/strong subjects, mistake classification trends, recovery
-- history).
--
-- Verified live (not just from migration text) that all three tables carry a
-- school_id column in production today via PostgREST schema-error probing
-- (an invalid column name reliably 400s with code 42703; school_id did not).
-- The teacher-via-class-ownership EXISTS branch on each policy is left
-- untouched -- it was not implicated in this leak and already resolves
-- per-class, not globally.
-- =============================================================================

-- ── concept_mastery ──────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mastery teacher" ON public.concept_mastery;
CREATE POLICY "mastery teacher" ON public.concept_mastery
  FOR SELECT TO authenticated
  USING (
    (
      (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'principal'::public.app_role))
      AND public.same_school(school_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = concept_mastery.user_id
        AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── student_mistakes ─────────────────────────────────────────────────────────
DROP POLICY IF EXISTS "mistakes teacher class" ON public.student_mistakes;
CREATE POLICY "mistakes teacher class" ON public.student_mistakes
  FOR SELECT TO authenticated
  USING (
    (
      (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'principal'::public.app_role))
      AND public.same_school(school_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = student_mistakes.user_id
        AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── student_academic_brain ───────────────────────────────────────────────────
DROP POLICY IF EXISTS "brain teacher" ON public.student_academic_brain;
CREATE POLICY "brain teacher" ON public.student_academic_brain
  FOR SELECT TO authenticated
  USING (
    (
      (public.has_role(auth.uid(), 'admin'::public.app_role) OR public.has_role(auth.uid(), 'principal'::public.app_role))
      AND public.same_school(school_id)
    )
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = student_academic_brain.user_id
        AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );
