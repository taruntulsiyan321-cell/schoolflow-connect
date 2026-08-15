-- =============================================================================
-- Atomic bulk attendance upsert.
--
-- Problem: bulkUpsertAttendance (src/academic/repository/attendanceRepository.ts)
-- looped client-side, awaiting one single-row upsertAttendance() call per
-- student -- N sequential writes with nothing wrapping the batch. A mid-batch
-- validation failure (e.g. a student moved to another class between
-- roster-load and Save) left the rows already written committed, while the
-- live-refresh broadcast and attendance-XP award -- which only run after the
-- whole batch resolves -- were skipped for the students whose rows DID save.
-- A client-side "validate then batch-write" approach still leaves a race
-- window between the validation query and the write, so it cannot provide
-- real atomicity either. This migration adds one server-side function that
-- validates the entire batch and writes it as a single atomic multi-row
-- upsert: either the whole batch lands, or a RAISE EXCEPTION rolls back
-- everything the function did (nothing is written before the write step, so
-- a failed validation touches zero rows).
--
-- Authorization mirrors the existing "att admin all" / "att teacher manage
-- class" RLS policies on public.attendance exactly (same has_role/same_school
-- and public.teacher_teaches_class() checks already used by those policies
-- and already relied on by the client-side assertTeacherOwnsClass path this
-- RPC is meant to sit behind). This function is SECURITY DEFINER, which does
-- NOT automatically enforce table RLS on its own writes -- so it re-checks
-- the same authorization those policies already express, rather than
-- silently relying on RLS to catch anything.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.rpc_bulk_upsert_attendance(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
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
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_bulk_upsert_attendance(jsonb) TO authenticated;
