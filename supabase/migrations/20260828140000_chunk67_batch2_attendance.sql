-- =====================================================================
-- CHUNK 6.7 — BATCH 2: the attendance surface
--
-- This is a change to the isolation boundary, not a performance change
-- that happens to touch policies. Every predicate below is the same
-- predicate it replaces, expressed so the planner resolves it once per
-- statement instead of once per candidate row. Nothing gains access.
--
-- WHY ATTENDANCE BEFORE NOTIFICATIONS: 9.5 ms per row against 2 ms, and
-- it is the daily-use surface — every teacher, every morning. Already
-- past half the 8 s budget at 158 rows.
--
-- MEASURED BEFORE (fixture volume, 158 attendance rows):
--
--   attendance              admin 4,526 ms · parent 4,351 ms · student 3,994 ms
--                           principal 693 ms · teacher 772 ms
--                           2.6-9.5 ms PER ROW, ~0 setup
--   attendance_submissions  ~180 ms, 3.9 ms/row, every role
--   attendance_audit        221-297 ms, 4.6-6.2 ms/row
--
-- Two findings at current volume; every path projects past the timeout at
-- 10,000 rows. A year of one school is roughly 200 school days x 6
-- sections x 35 students = 42,000 attendance rows, so 10,000 is not the
-- pessimistic case.
--
-- THE SHAPES BEING REMOVED
--
--   1. attendance_tenant_fence calls same_school(school_id) per row
--      (2.73 ms), and being RESTRICTIVE it runs before anything else.
--   2. "att teacher read class" runs EXISTS against attendance_submissions
--      — a policy reaching an RLS-protected table, so a teacher pays that
--      table's ENTIRE policy stack per attendance row. This is the exact
--      pattern G12 names, still live here.
--   3. "att admin all" is FOR ALL, so it is evaluated on SELECT too, and
--      every reader paid the admin check before reaching their own arm.
--   4. is_my_child() and is_my_student_record() scan students per row.
--
-- WHAT IS NOT CHANGED: the write policies. "att teacher write class" and
-- both principal_never_writes rules keep their per-row form. Per-row is
-- correct for a write, the row counts are tiny, and rewriting an INSERT
-- check as `IN (SELECT ...)` risks the one-time InitPlan not seeing the
-- row being inserted.
-- =====================================================================

-- ---------------------------------------------------------------------
-- SECTION 1 — the submissions a teacher may read, resolved once
--
-- Replaces the nested EXISTS. As SECURITY DEFINER it does not pay
-- attendance_submissions' policy stack at all, so it re-states what it
-- bypasses: active role, active local person, institution — all of which
-- my_teacher_class_ids() asserts for itself.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.my_teacher_submission_ids()
RETURNS SETOF uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT s.id
    FROM public.attendance_submissions s
   WHERE s.school_id IN (SELECT public.my_accessible_school_ids())
     AND s.section_id IN (SELECT public.my_teacher_class_ids())
$$;

COMMENT ON FUNCTION public.my_teacher_submission_ids() IS
  'Chunk 6.7 batch 2. Attendance submissions for the sections this teacher teaches, resolved once per statement. Replaces an EXISTS inside the attendance policy that made a teacher pay attendance_submissions RLS per attendance row.';

GRANT EXECUTE ON FUNCTION public.my_teacher_submission_ids() TO anon, authenticated;

-- ---------------------------------------------------------------------
-- SECTION 2 — attendance
--
-- Four SELECT policies collapse into one. Their union is reproduced
-- exactly: admin OR principal OR my own record OR my child OR a section I
-- teach. "att admin all" stays, because it is what grants admin writes,
-- but its own checks are hoisted so it stops costing every reader.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_tenant_fence ON public.attendance;
CREATE POLICY attendance_tenant_fence ON public.attendance
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS "att parent read child"    ON public.attendance;
DROP POLICY IF EXISTS "att student read self"    ON public.attendance;
DROP POLICY IF EXISTS "att teacher read class"   ON public.attendance;
DROP POLICY IF EXISTS "attendance principal read" ON public.attendance;

CREATE POLICY attendance_read ON public.attendance
  FOR SELECT
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND (
      (SELECT public.is_principal_or_admin(auth.uid()))
      OR student_id    IN (SELECT public.my_own_or_children_student_ids())
      OR submission_id IN (SELECT public.my_teacher_submission_ids())
    )
  );

DROP POLICY IF EXISTS "att admin all" ON public.attendance;
CREATE POLICY "att admin all" ON public.attendance
  FOR ALL
  USING (
    (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
    AND school_id IN (SELECT public.my_accessible_school_ids())
  )
  WITH CHECK (
    (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
    AND school_id IN (SELECT public.my_accessible_school_ids())
  );

-- ---------------------------------------------------------------------
-- SECTION 3 — attendance_submissions
--
-- The read arm was already "anyone in the institution", so it needs only
-- the set form. The admin FOR ALL keeps its shape with its checks hoisted.
-- The class-teacher INSERT policy and the principal_never_writes
-- RESTRICTIVE rule are deliberately untouched: both are write-side, and
-- the latter's USING is already `true`, so it costs a reader nothing.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_submissions_tenant_fence ON public.attendance_submissions;
CREATE POLICY attendance_submissions_tenant_fence ON public.attendance_submissions
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS attendance_submissions_read ON public.attendance_submissions;
CREATE POLICY attendance_submissions_read ON public.attendance_submissions
  FOR SELECT
  USING (school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS attendance_submissions_admin_all ON public.attendance_submissions;
-- WITH CHECK spelled out rather than left to default to USING. Postgres
-- does fall back to USING when WITH CHECK is absent, so omitting it would
-- have been equivalent — but the original states it, and a write rule that
-- depends on a reader knowing that fallback is a rule waiting to be
-- misread.
CREATE POLICY attendance_submissions_admin_all ON public.attendance_submissions
  FOR ALL
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
  )
  WITH CHECK (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
  );

-- ---------------------------------------------------------------------
-- SECTION 4 — attendance_audit
--
-- Same three role checks, hoisted. This is the table the edited-day
-- marker resolves from, so it is read from the same screens.
-- ---------------------------------------------------------------------
DROP POLICY IF EXISTS attendance_audit_tenant_fence ON public.attendance_audit;
CREATE POLICY attendance_audit_tenant_fence ON public.attendance_audit
  AS RESTRICTIVE FOR ALL TO anon, authenticated
  USING      (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()))
  WITH CHECK (school_id IS NULL OR school_id IN (SELECT public.my_accessible_school_ids()));

DROP POLICY IF EXISTS "audit school staff read" ON public.attendance_audit;
CREATE POLICY "audit school staff read" ON public.attendance_audit
  FOR SELECT
  USING (
    school_id IN (SELECT public.my_accessible_school_ids())
    AND (
      (SELECT public.has_role(auth.uid(), 'admin'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'principal'::public.app_role))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
    )
  );

INSERT INTO public.schema_migrations (version)
VALUES ('20260828140000_chunk67_batch2_attendance')
ON CONFLICT DO NOTHING;
