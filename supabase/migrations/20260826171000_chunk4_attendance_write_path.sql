-- =====================================================================
-- CHUNK 4 (part 2) — the attendance WRITE PATH
--
-- 20260826170000 made attendance.submission_id NOT NULL. This is the other
-- half: the paths that write attendance now have to create the submission
-- first. tsc caught it immediately (attendanceRepository.ts:180), which is the
-- constraint doing its job.
--
-- DELIBERATELY NOT A TRIGGER. The obvious shortcut — a BEFORE INSERT trigger
-- that auto-creates the submission when submission_id is NULL — would restore
-- the exact inference this chunk exists to destroy: "a per-student row implies
-- the section was marked". Marking a section is an explicit act by an
-- authorised person, so it gets an explicit call.
--
-- Reverse: supabase/migrations/rollback/20260826171000_chunk4_write_path_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- rpc_ensure_attendance_submission — idempotent, authorised, returns the id
--
-- Class teacher of that section, or admin (who may mark on any day). The
-- principal is refused here as well as by policy: this is SECURITY DEFINER,
-- so RLS would not otherwise apply to it.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_ensure_attendance_submission(
  _section_id uuid,
  _date date
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _school uuid;
  _caller uuid := auth.uid();
  _id uuid;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _section_id IS NULL OR _date IS NULL THEN
    RAISE EXCEPTION 'section and date are required';
  END IF;

  SELECT c.school_id INTO _school FROM public.classes c WHERE c.id = _section_id;
  IF _school IS NULL THEN RAISE EXCEPTION 'Section % does not exist', _section_id; END IF;
  IF NOT public.same_school(_school) THEN
    RAISE EXCEPTION 'Section % is outside the current institution', _section_id;
  END IF;

  -- The principal may never mark (locked decision 10, and Chunk 4's rules).
  IF public.has_role(_caller, 'principal'::public.app_role)
     AND NOT public.has_role(_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'The principal cannot mark attendance';
  END IF;

  IF NOT (public.has_role(_caller, 'admin'::public.app_role)
          OR public.is_class_teacher_of_class(_caller, _section_id)) THEN
    RAISE EXCEPTION 'Only the class teacher or an admin may mark attendance for this section';
  END IF;

  INSERT INTO public.attendance_submissions
    (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_school,
          (SELECT ay.id FROM public.academic_years ay
            WHERE ay.school_id = _school AND ay.is_current LIMIT 1),
          _section_id, _date, _caller)
  ON CONFLICT (section_id, date) DO UPDATE
    -- Re-marking an existing day is an edit, not a new submission: keep the
    -- original submitted_by/submitted_at (the 24h edit window keys off it) and
    -- record who touched it instead.
    SET edited_by = _caller, edited_at = now()
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_ensure_attendance_submission(uuid, date) FROM public, anon;
GRANT  EXECUTE ON FUNCTION public.rpc_ensure_attendance_submission(uuid, date) TO authenticated;


-- ---------------------------------------------------------------------
-- rpc_bulk_upsert_attendance — same function, now submission-anchored.
--
-- Unchanged from the live definition except for the submission step and the
-- submission_id on the insert. The validate-everything-before-writing-anything
-- ordering that makes the batch atomic is preserved exactly.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_bulk_upsert_attendance(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
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
  _pair record;
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

  -- Validate every row before writing anything.
  FOR _row IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _student_id := (_row->>'student_id')::uuid;
    _class_id := (_row->>'class_id')::uuid;
    _date := (_row->>'date')::date;
    _status := _row->>'status';

    IF _student_id IS NULL OR _class_id IS NULL OR _date IS NULL OR _status IS NULL THEN
      RAISE EXCEPTION 'Each row requires student_id, class_id, date and status';
    END IF;

    -- Present/absent only (locked decision 5). Named here so the caller gets a
    -- product-level message rather than a raw CHECK violation.
    IF _status NOT IN ('present', 'absent') THEN
      RAISE EXCEPTION 'Attendance status must be present or absent (got %)', _status;
    END IF;

    SELECT id, school_id, class_id INTO _stu FROM public.students WHERE id = _student_id;
    IF NOT FOUND OR _stu.school_id IS DISTINCT FROM _school_id THEN
      RAISE EXCEPTION 'Student % is outside the current school', _student_id;
    END IF;
    IF _stu.class_id IS DISTINCT FROM _class_id THEN
      RAISE EXCEPTION 'Student % does not belong to class %', _student_id, _class_id;
    END IF;
  END LOOP;

  -- Every (section, date) in the batch gets its submission first: the register
  -- is marked, and only then are the per-student rows written under it.
  FOR _pair IN
    SELECT DISTINCT (r->>'class_id')::uuid AS cid, (r->>'date')::date AS d
      FROM jsonb_array_elements(_rows) r
  LOOP
    PERFORM public.rpc_ensure_attendance_submission(_pair.cid, _pair.d);
  END LOOP;

  -- All rows validated -- one atomic multi-row upsert for the whole batch.
  INSERT INTO public.attendance (student_id, class_id, date, status, school_id, marked_by, submission_id)
  SELECT
    (r->>'student_id')::uuid,
    (r->>'class_id')::uuid,
    (r->>'date')::date,
    (r->>'status')::public.attendance_status,
    _school_id,
    auth.uid(),
    s.id
  FROM jsonb_array_elements(_rows) r
  JOIN public.attendance_submissions s
    ON s.section_id = (r->>'class_id')::uuid
   AND s.date = (r->>'date')::date
  ON CONFLICT (student_id, date) DO UPDATE SET
    status = EXCLUDED.status,
    class_id = EXCLUDED.class_id,
    marked_by = EXCLUDED.marked_by,
    submission_id = EXCLUDED.submission_id;

  GET DIAGNOSTICS _n = ROW_COUNT;

  RETURN jsonb_build_object('upserted_count', _n);
END; $$;


DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_ensure_attendance_submission'
  ) THEN
    RAISE EXCEPTION 'Chunk 4: rpc_ensure_attendance_submission missing';
  END IF;

  IF (SELECT p.prosrc FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public' AND p.proname = 'rpc_bulk_upsert_attendance')
     NOT LIKE '%rpc_ensure_attendance_submission%' THEN
    RAISE EXCEPTION 'Chunk 4: the bulk write path does not create a submission';
  END IF;
END $$;
