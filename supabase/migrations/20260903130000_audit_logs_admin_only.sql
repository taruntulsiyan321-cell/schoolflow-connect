-- §10.18: audit_logs readable by admin only, not principal
DROP POLICY IF EXISTS "audit principal admin read" ON public.audit_logs;
CREATE POLICY "audit admin read" ON public.audit_logs FOR SELECT
  USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    AND public.same_school(school_id)
  );
