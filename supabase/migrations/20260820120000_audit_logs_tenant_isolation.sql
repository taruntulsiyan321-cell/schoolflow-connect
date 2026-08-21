-- Close a cross-tenant RLS hole on audit_logs. Two separate gaps, both fixed
-- here:
--   1. READ: "audit principal admin read" is role-only (is_principal_or_admin),
--      no school_id check, despite school_id existing since the Aug-2026
--      backfill. Exploitable directly via the API today. The one component
--      that reads this table, ActivityLogPage (src/pages/shared/
--      SchoolFeatures.tsx), turned out on closer check to be completely
--      unrouted -- defined but never imported/mounted anywhere in the app,
--      confirmed via repo-wide grep -- so this was not a live in-UI leak,
--      only an API-level one. Hardened ActivityLogPage's own query with an
--      explicit school_id filter anyway (defense in depth, matches this
--      audit's own "no implicit RLS reliance" standard), in case it's ever
--      wired into a route later.
--   2. WRITE: "audit auth insert" lets ANY authenticated user (any role, any
--      school) insert a row with an arbitrary school_id -- only
--      actor_user_id = auth.uid() is checked. Confirmed live via pg_policies.
--      This is an integrity gap, not just confidentiality: a user from
--      School B could currently write fabricated entries into School A's
--      audit trail. Closed the same way as leave_requests/school_complaints:
--      force school_id server-side via a BEFORE INSERT trigger and require
--      it match in WITH CHECK.

CREATE TRIGGER trg_audit_logs_set_school
  BEFORE INSERT ON public.audit_logs
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP POLICY IF EXISTS "audit auth insert" ON public.audit_logs;
CREATE POLICY "audit auth insert" ON public.audit_logs FOR INSERT TO authenticated
  WITH CHECK (
    actor_user_id = auth.uid()
    AND school_id = public.get_my_school_id()
  );

DROP POLICY IF EXISTS "audit principal admin read" ON public.audit_logs;
CREATE POLICY "audit principal admin read" ON public.audit_logs FOR SELECT
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));
