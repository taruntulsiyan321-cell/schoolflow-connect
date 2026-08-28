-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — DPP privacy leak closure (20260828190000_dpp_privacy_leak_closure)
--
-- ⚠ READ THIS BEFORE RUNNING IT. This rollback REOPENS A KNOWN PRIVACY LEAK.
--
-- The migration it reverses closed five permissive read policies and one
-- SECURITY DEFINER function that together served one student's DPP practice
-- answers — including per-named-student accuracy — to teachers, parents and
-- admins. §10.8 says practice is readable by the student and nobody else.
--
-- Running this restores that access. It exists because a rollback that cannot
-- be run is not a rollback, and because the forward migration deliberately
-- broke teacher surfaces ("WHAT BREAKS, DELIBERATELY") — if that breakage is
-- worse than the leak for the hours it takes to fix forward, this is the
-- lever. It is not a routine revert. Prefer fixing forward.
--
-- Restoring the policies is the part that matters: policies are what gate the
-- data. rpc_teacher_class_insights is one call site on top of them and is NOT
-- reproduced here — see section 3.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. dpp_answers — the two dropped read policies ──────────────────────────
-- Verbatim from 20260514005018_e4f64d6f-f8a2-499c-ba0b-280459fb70b4.sql.
CREATE POLICY "dppans admin all" ON public.dpp_answers FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE POLICY "dppans teacher read" ON public.dpp_answers FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
    WHERE a.id = attempt_id AND teacher_teaches_class(auth.uid(), d.class_id)
  ));

-- ── 2. dpp_attempts — the three dropped read policies ───────────────────────
-- "dppa admin all" and "dppa teacher read" verbatim from
-- 20260514005018; "dppa parent read child" verbatim from
-- 20260802620000_parent_principal_admin_audit_rls.sql.
CREATE POLICY "dppa admin all" ON public.dpp_attempts FOR ALL
  USING (has_role(auth.uid(),'admin')) WITH CHECK (has_role(auth.uid(),'admin'));

CREATE POLICY "dppa teacher read" ON public.dpp_attempts FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.dpps d
     WHERE d.id = dpp_id AND teacher_teaches_class(auth.uid(), d.class_id)
  ));

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

-- ── 3. rpc_teacher_class_insights is NOT restored here ──────────────────────
-- It was last defined by:
--   supabase/migrations/20260822240000_gap_closure_admin_principal_cross_school_leaks.sql
--
-- It is not inlined into this rollback for two reasons. It is long, and a
-- hand-copied SECURITY DEFINER body that loses its search_path, volatility or
-- grants is a worse outcome than not having the function — that is precisely
-- how a definer quietly loses its fence. And restoring a function whose whole
-- problem was that it served another student's practice data should be a
-- deliberate act, not a side effect of running a script.
--
-- If it is genuinely needed, re-apply its definition from that migration by
-- hand, after re-reading it. With the policies above restored, the data it
-- served is reachable again regardless — the function was convenience, not
-- the gate.

COMMIT;
