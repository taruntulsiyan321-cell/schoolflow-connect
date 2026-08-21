-- BUG (previously root-caused in this campaign's Priority-0 audit, never
-- fixed until now): TeacherAttendancePage.tsx's own canMark logic is
-- `!!selected?.isClassTeacher` and its UI text is explicit -- "View only.
-- Only the class teacher can mark attendance." -- but every real
-- authorization boundary behind that UI accepted ANY teacher assigned to
-- the class in any capacity (subject-only teachers included), via
-- teacher_teaches_class(), which ORs together teacher_classes (subject
-- mapping) and class_teacher_of (homeroom). This is the same
-- "cosmetic-restriction-not-actually-enforced" shape as the attendance_locks
-- bug fixed earlier this session (20260820160000/161000), in the same
-- service file.
--
-- Three independent write paths all had this gap:
--   1. attendance table RLS "att teacher manage class" (ALL command) --
--      the true boundary for AttendanceService.mark()'s single-row upsert,
--      and for any direct PostgREST write.
--   2. rpc_bulk_upsert_attendance -- the true boundary for markBulk().
--   3. src/academic/services/attendanceService.ts's assertTeacherMayMarkClass
--      -- app-level early rejection (fixed separately in this pass, client
--      code only, not a security boundary on its own).
--
-- Reads must stay broad (a subject teacher legitimately views the roster
-- and attendance for classes they teach, matching
-- AttendanceService.listClassStudents/listForClassDate, which
-- intentionally keep using the broader assertTeacherOwnsClass check) --
-- only WRITES are being restricted here.

CREATE OR REPLACE FUNCTION public.is_class_teacher_of_class(_uid uuid, _class_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT EXISTS (
    SELECT 1 FROM public.teachers t
    WHERE t.user_id = _uid AND t.class_teacher_of = _class_id
  )
$function$;

-- Split the old ALL policy into a broad read + a narrow write, instead of
-- tightening the single ALL policy (which would also have broken subject
-- teachers' legitimate ability to view the roster/attendance for classes
-- they teach but don't own).
DROP POLICY IF EXISTS "att teacher manage class" ON public.attendance;

CREATE POLICY "att teacher read class" ON public.attendance
  FOR SELECT
  USING (teacher_teaches_class(auth.uid(), class_id));

CREATE POLICY "att teacher write class" ON public.attendance
  FOR ALL
  USING (is_class_teacher_of_class(auth.uid(), class_id))
  WITH CHECK (is_class_teacher_of_class(auth.uid(), class_id));

CREATE OR REPLACE FUNCTION public.rpc_bulk_upsert_attendance(_rows jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _school_id uuid;
  _is_admin boolean;
  _row jsonb;
  _class_id uuid;
  _student_id uuid;
  _date date;
  _status text;
  _distinct_class_ids uuid[];
  _cid uuid;
  _stu record;
  _n int := 0;
  _locked_class uuid;
  _locked_date date;
BEGIN
  _school_id := public.get_my_school_id();
  IF _school_id IS NULL THEN
    RAISE EXCEPTION 'No school context for caller';
  END IF;

  _is_admin := public.has_role(auth.uid(), 'admin'::public.app_role);

  IF jsonb_typeof(_rows) IS DISTINCT FROM 'array' OR jsonb_array_length(_rows) = 0 THEN
    RAISE EXCEPTION 'rows must be a non-empty array';
  END IF;

  -- Authorize every distinct class in the batch up front, before touching any data.
  SELECT array_agg(DISTINCT (r->>'class_id')::uuid)
    INTO _distinct_class_ids
    FROM jsonb_array_elements(_rows) r;

  IF NOT _is_admin THEN
    FOREACH _cid IN ARRAY _distinct_class_ids LOOP
      IF NOT public.is_class_teacher_of_class(auth.uid(), _cid) THEN
        RAISE EXCEPTION 'Only the class teacher can mark attendance for class %', _cid;
      END IF;
    END LOOP;
  END IF;

  -- Reject the whole batch if ANY (class_id, date) pair touched is locked.
  -- Checked before any per-row validation/write, same "validate everything
  -- before writing anything" ordering the rest of this function already uses.
  SELECT al.class_id, al.date INTO _locked_class, _locked_date
  FROM jsonb_array_elements(_rows) r
  JOIN public.attendance_locks al
    ON al.class_id = (r->>'class_id')::uuid
   AND al.date = (r->>'date')::date
  WHERE al.school_id = _school_id
  LIMIT 1;
  IF _locked_class IS NOT NULL THEN
    RAISE EXCEPTION 'Attendance is locked for class % on % — unlock it first', _locked_class, _locked_date;
  END IF;

  -- Validate every row before writing anything. This validation-before-any-write
  -- ordering is what makes the batch atomic: a RAISE here aborts the whole
  -- function with zero rows written, since the write step (below) hasn't run yet.
  FOR _row IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _student_id := (_row->>'student_id')::uuid;
    _class_id := (_row->>'class_id')::uuid;
    _date := (_row->>'date')::date;
    _status := _row->>'status';

    IF _student_id IS NULL OR _class_id IS NULL OR _date IS NULL OR _status IS NULL THEN
      RAISE EXCEPTION 'Each row requires student_id, class_id, date and status';
    END IF;

    SELECT id, school_id, class_id INTO _stu FROM public.students WHERE id = _student_id;
    IF NOT FOUND OR _stu.school_id IS DISTINCT FROM _school_id THEN
      RAISE EXCEPTION 'Student % is outside the current school', _student_id;
    END IF;
    IF _stu.class_id IS DISTINCT FROM _class_id THEN
      RAISE EXCEPTION 'Student % does not belong to class %', _student_id, _class_id;
    END IF;
  END LOOP;

  -- All rows validated -- one atomic multi-row upsert for the whole batch.
  INSERT INTO public.attendance (student_id, class_id, date, status, school_id, marked_by)
  SELECT
    (r->>'student_id')::uuid,
    (r->>'class_id')::uuid,
    (r->>'date')::date,
    (r->>'status')::public.attendance_status,
    _school_id,
    auth.uid()
  FROM jsonb_array_elements(_rows) r
  ON CONFLICT (student_id, date) DO UPDATE SET
    status = EXCLUDED.status,
    class_id = EXCLUDED.class_id,
    marked_by = EXCLUDED.marked_by;

  GET DIAGNOSTICS _n = ROW_COUNT;

  RETURN jsonb_build_object('upserted_count', _n);
END; $function$;
