-- Close a cross-tenant RLS hole on leave_requests: "leaves principal admin
-- all" only checked role (admin/principal) via is_principal_or_admin(),
-- never school_id -- even though leave_requests has had a school_id column
-- since the Aug-2026 multi-tenant backfill (20260730010000). Confirmed live:
-- any admin/principal JWT could read/approve/reject/delete every other
-- school's leave requests (reason text + applicant identity included).
--
-- Root cause is two-sided, fixed on both sides so it can't regress from
-- either alone:
--   1. DB: no BEFORE INSERT trigger ever populated school_id on this table
--      (unlike school_complaints/school_inquiries, which already reuse
--      tg_set_school_id_from_session() for exactly this). Confirmed live via
--      pg_trigger: zero triggers on leave_requests before this migration.
--   2. App: leaveService.ts's submit() never set school_id in its insert
--      payload either (its own comment claimed "leave_requests has no
--      school_id" -- false, confirmed live). Fixed in the same app change
--      that ships this migration.
-- Scoping the admin/principal policy to same_school() without also fixing
-- the insert path would have silently hidden every NEW leave request from
-- every school's admin/principal (school_id would insert as NULL, and
-- same_school(NULL) is never true) -- confirmed this failure mode before
-- writing the fix, not just patched the read side.

-- 1. Force school_id server-side on insert (defense in depth alongside the
--    app-side ctx.schoolId set in leaveService.ts -- neither depends solely
--    on the other). Reuses the existing generic trigger fn, unmodified.
CREATE TRIGGER trg_leave_requests_set_school
  BEFORE INSERT ON public.leave_requests
  FOR EACH ROW EXECUTE FUNCTION public.tg_set_school_id_from_session();

-- 2. Prevent a client from spoofing a different school's id on insert,
--    matching the school_complaints/school_inquiries WITH CHECK pattern.
DROP POLICY IF EXISTS "leaves applicant insert" ON public.leave_requests;
CREATE POLICY "leaves applicant insert" ON public.leave_requests FOR INSERT
  WITH CHECK (
    applicant_user_id = auth.uid()
    AND school_id = public.get_my_school_id()
  );

-- 3. The actual cross-tenant hole: scope admin/principal's FOR ALL policy to
--    their own school, matching the same_school() pattern already applied to
--    fees/teachers/school_complaints/school_inquiries.
DROP POLICY IF EXISTS "leaves principal admin all" ON public.leave_requests;
CREATE POLICY "leaves principal admin all" ON public.leave_requests FOR ALL
  USING (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id))
  WITH CHECK (public.is_principal_or_admin(auth.uid()) AND public.same_school(school_id));

-- "leaves class teacher read"/"leaves class teacher review" and "leaves
-- parent read child" are intentionally untouched: is_class_teacher_of_student
-- and the parent-child EXISTS check already join through a real class/student
-- row, which cannot itself span schools (classes/students are already
-- tenant-scoped), so they are inherently same-school by construction.
