-- Close a cross-tenant RLS hole on staff_attendance, the direct sibling of
-- the attendance-table leak already closed in
-- 20260804000000_close_admin_principal_tenant_leaks.sql -- staff_attendance
-- was simply never revisited by that pass. "staff_att principal admin all"
-- is FOR ALL, gated only by is_principal_or_admin(), no school_id check,
-- despite school_id existing on this table since the Aug-2026 backfill
-- (confirmed live: column exists, fully populated on today's 3 rows).
--
-- Blast radius, confirmed by repo-wide grep before writing this fix: zero
-- application code (services/repositories/components) reads or writes
-- staff_attendance today -- only migrations, the generated Supabase types
-- file, and the demo seed reference it. This is currently dormant schema,
-- not a live feature, so there is no in-app code path to update alongside
-- this migration (unlike leave_requests). The trigger below is added purely
-- as future-proofing: if/when a staff-attendance UI is ever built, its
-- inserts will already be safe by construction instead of silently
-- reproducing the "new rows insert with school_id = NULL, same_school(NULL)
-- is never true, admin/principal can't see them" trap this campaign already
-- found and fixed once on leave_requests.

CREATE TRIGGER trg_staff_attendance_set_school
  BEFORE INSERT ON public.staff_attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

DROP POLICY IF EXISTS "staff_att principal admin all" ON public.staff_attendance;
CREATE POLICY "staff_att principal admin all" ON public.staff_attendance FOR ALL
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id))
  WITH CHECK (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

-- "staff_att self read" is untouched: it already scopes via a real
-- teachers.id join (t.user_id = auth.uid()), which cannot itself span
-- schools, so it is inherently same-school by construction.
