-- Enforce attendance_locks on the actual write path. The table, its RLS,
-- and a cosmetic "Locked" badge in the admin UI all existed, but nothing
-- checked it before writing: AttendanceService.mark()/markBulk() went
-- straight to upsertAttendance/bulkUpsertAttendance with zero reference to
-- attendance_locks, and rpc_bulk_upsert_attendance (the single source of
-- truth for the atomic bulk path, per its own migration's rationale) never
-- selected from or joined attendance_locks either. A day explicitly locked
-- after a payroll/reporting cutoff could be silently rewritten by any
-- teacher assigned to the class, or by an admin, with no error or warning.
--
-- Locks apply uniformly, including to admins: the intended workflow is that
-- editing a locked day requires first deleting the lock (an already-real,
-- separate admin-only action per "locks admin delete" RLS), never writing
-- straight through. The client-side single-row path (attendanceRepository.ts
-- upsertAttendance) got the same check in the same commit as this migration
-- -- this migration hardens the server-side atomic bulk path so neither can
-- be used to bypass the other.

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
      IF NOT public.teacher_teaches_class(auth.uid(), _cid) THEN
        RAISE EXCEPTION 'Not authorized to mark attendance for class %', _cid;
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
