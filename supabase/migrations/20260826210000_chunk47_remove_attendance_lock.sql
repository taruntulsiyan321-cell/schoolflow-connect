-- =====================================================================
-- CHUNK 4.7 — REMOVE THE ATTENDANCE LOCK
--
-- The lock question was raised during Chunk 4 and has now been decided.
-- locked-decisions §5 and Chunk 4's rules both changed:
--
--   1. No edit window at all. The 24-hour rule is removed. A teacher submits
--      and can never edit. An admin can edit any date, any time.
--   2. attendance_locks is deleted entirely — no table, no view, no policy,
--      no code reference.
--   3. The principal question is moot: there is nothing to lock.
--   4. Provisional/final is removed. Nothing is ever final, so the trend shows
--      every day.
--   5. Any edited day carries a visible marker, resolving from the edit record.
--
-- Rationale recorded in the decision: an explicit lock row and a computed
-- 24-hour window were two things both answering "is this editable" — the same
-- redundancy shape as user_roles vs memberships. The simpler rule needs
-- neither.
--
-- ---------------------------------------------------------------------
-- DOC/SCHEMA CONTRADICTION — FLAGGED, NOT SILENTLY FOLLOWED
--
-- Both documents call the edit record `attendance_edits` and describe it as
-- `id · submission_id · student_id · old_status · new_status · edited_by ·
-- edited_at`. No such table exists and none ever did.
--
-- What exists is `public.attendance_audit`, holding 48 rows, written by the
-- trigger tg_log_attendance_change on UPDATE whenever a status actually
-- changes. Its columns are a superset of the spec's:
--   submission_id, student_id, prev_status, new_status, edited_by, edited_at
--   (+ attendance_id, class_id, date, school_id frozen at edit time)
--
-- Creating `attendance_edits` would put a second table behind the same
-- question — precisely the redundancy this chunk exists to remove. So this
-- migration uses attendance_audit and the docs should be corrected to name it.
-- Raised rather than resolved unilaterally.
-- ---------------------------------------------------------------------
--
-- NOT a redundancy, for the record: attendance_submissions.edited_at marks
-- "an admin re-marked this day", which can happen with no status changing.
-- attendance_audit records "a status actually changed". The marker keys on
-- the latter, because a day where nothing changed has nothing to show.
--
-- Reverse: supabase/migrations/rollback/20260826210000_chunk47_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — delete the lock apparatus
--
-- Dropped in dependency order and WITHOUT cascade, so that if anything else
-- had quietly come to depend on these, the migration fails loudly instead of
-- taking that dependency down with it. Verified first: attendance_locks has
-- zero inbound foreign keys, and attendance_locks_current is its only
-- dependent object.
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_attendance_reject_if_locked ON public.attendance;
DROP FUNCTION IF EXISTS public.tg_reject_locked_attendance_write();

DROP VIEW  IF EXISTS public.attendance_locks_current;
DROP TABLE IF EXISTS public.attendance_locks;


-- ---------------------------------------------------------------------
-- SECTION 2 — a teacher submits once and can never edit
--
-- Previously this function's ON CONFLICT quietly turned a re-mark into an
-- edit for anybody who could reach it. Now the conflict path is admin-only.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_ensure_attendance_submission(
  _section_id uuid, _date date)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _school uuid;
  _caller uuid := auth.uid();
  _is_admin boolean;
  _existing uuid;
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

  -- The principal may never mark or edit (locked decision 10, Chunk 4).
  IF public.has_role(_caller, 'principal'::public.app_role)
     AND NOT public.has_role(_caller, 'admin'::public.app_role) THEN
    RAISE EXCEPTION 'The principal cannot mark attendance';
  END IF;

  _is_admin := public.has_role(_caller, 'admin'::public.app_role);

  IF NOT (_is_admin OR public.is_class_teacher_of_class(_caller, _section_id)) THEN
    RAISE EXCEPTION 'Only the class teacher or an admin may mark attendance for this section';
  END IF;

  SELECT s.id INTO _existing
    FROM public.attendance_submissions s
   WHERE s.section_id = _section_id AND s.date = _date;

  IF _existing IS NOT NULL THEN
    -- The day already has a submission, so this is an edit. No window, no
    -- lock — simply, only an admin may edit, and forever.
    IF NOT _is_admin THEN
      RAISE EXCEPTION
        'Attendance for this section on % has already been submitted. Only an admin can change it.', _date;
    END IF;

    UPDATE public.attendance_submissions
       SET edited_by = _caller, edited_at = now()
     WHERE id = _existing;

    RETURN _existing;
  END IF;

  INSERT INTO public.attendance_submissions
    (school_id, academic_year_id, section_id, date, submitted_by)
  VALUES (_school,
          (SELECT ay.id FROM public.academic_years ay
            WHERE ay.school_id = _school AND ay.is_current LIMIT 1),
          _section_id, _date, _caller)
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;


-- ---------------------------------------------------------------------
-- SECTION 3 — the bulk write path loses its lock check
--
-- The teacher-cannot-edit rule is enforced by
-- rpc_ensure_attendance_submission, which this function calls for every
-- (section, date) pair before writing any row. That call now raises for a
-- teacher touching an existing day, so the guard is in one place rather than
-- duplicated here.
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

  FOR _row IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _student_id := (_row->>'student_id')::uuid;
    _class_id   := (_row->>'class_id')::uuid;
    _date       := (_row->>'date')::date;
    _status     := _row->>'status';

    IF _student_id IS NULL OR _class_id IS NULL OR _date IS NULL OR _status IS NULL THEN
      RAISE EXCEPTION 'Each row requires student_id, class_id, date and status';
    END IF;

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

  -- Raises for a teacher whose day already exists — the single edit guard.
  FOR _pair IN
    SELECT DISTINCT (r->>'class_id')::uuid AS cid, (r->>'date')::date AS d
      FROM jsonb_array_elements(_rows) r
  LOOP
    PERFORM public.rpc_ensure_attendance_submission(_pair.cid, _pair.d);
  END LOOP;

  INSERT INTO public.attendance (student_id, status, school_id, marked_by, submission_id)
  SELECT
    (r->>'student_id')::uuid,
    (r->>'status')::public.attendance_status,
    _school_id,
    auth.uid(),
    s.id
  FROM jsonb_array_elements(_rows) r
  JOIN public.attendance_submissions s
    ON s.section_id = (r->>'class_id')::uuid
   AND s.date = (r->>'date')::date
  ON CONFLICT (student_id, submission_id) DO UPDATE SET
    status = EXCLUDED.status,
    marked_by = EXCLUDED.marked_by;

  GET DIAGNOSTICS _n = ROW_COUNT;

  RETURN jsonb_build_object('upserted_count', _n);
END;
$$;


-- ---------------------------------------------------------------------
-- SECTION 4 — the teacher's write policy becomes INSERT-only
--
-- "A teacher attempts to edit their own submission — rejected by policy"
-- (Chunk 4 verification 9). It was FOR ALL, which allowed UPDATE and DELETE
-- on any row of a section they are class teacher of. Now they may only insert.
-- Admin keeps FOR ALL through "att admin all".
-- ---------------------------------------------------------------------

DROP POLICY IF EXISTS "att teacher write class" ON public.attendance;
CREATE POLICY "att teacher write class" ON public.attendance
  FOR INSERT
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_submissions s
       WHERE s.id = attendance.submission_id
         AND public.is_class_teacher_of_class(auth.uid(), s.section_id)
    )
  );


-- ---------------------------------------------------------------------
-- SECTION 5 — the edited-day marker
--
-- One definition, so every screen showing that day's figure marks it the same
-- way (locked decision 11: no metric computed in more than one place).
-- Resolves from attendance_audit alone — the record of what actually changed.
--
-- security_invoker so the view is subject to the caller's policies on
-- attendance_audit rather than the owner's. Without it a view becomes a hole
-- around every policy on its base table (Chunk 11, Sweep 5).
-- ---------------------------------------------------------------------

CREATE OR REPLACE VIEW public.attendance_day_edits
WITH (security_invoker = true) AS
SELECT
  aa.submission_id,
  s.section_id,
  s.date,
  s.school_id,
  count(*)                                   AS edit_count,
  count(DISTINCT aa.student_id)              AS students_changed,
  max(aa.edited_at)                          AS last_edited_at,
  (array_agg(aa.edited_by ORDER BY aa.edited_at DESC))[1] AS last_edited_by
FROM public.attendance_audit aa
JOIN public.attendance_submissions s ON s.id = aa.submission_id
GROUP BY aa.submission_id, s.section_id, s.date, s.school_id;

COMMENT ON VIEW public.attendance_day_edits IS
  'The edited-day marker. One row per submission that has at least one real status change, from attendance_audit. A day re-marked with nothing changed does not appear — there would be nothing to show.';

GRANT SELECT ON public.attendance_day_edits TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 6 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int; _d text;
BEGIN
  -- The lock is gone from every kind of object.
  SELECT count(*), string_agg(c.relname, ', ') INTO _n, _d
    FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
   WHERE ns.nspname = 'public' AND c.relkind IN ('r','v','m')
     AND c.relname LIKE '%attendance_lock%';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 4.7: attendance lock relation(s) still present: %', _d;
  END IF;

  SELECT count(*) INTO _n FROM pg_policies
   WHERE schemaname = 'public'
     AND (tablename LIKE '%attendance_lock%'
       OR (coalesce(qual,'') || ' ' || coalesce(with_check,'')) ILIKE '%attendance_lock%');
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 4.7: % policy/policies still reference the lock', _n;
  END IF;

  SELECT count(*), string_agg(p.proname, ', ') INTO _n, _d
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public' AND p.prosrc ILIKE '%attendance_lock%';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 4.7: function(s) still reference the lock: %', _d;
  END IF;

  -- No edit window survives anywhere in the attendance path.
  SELECT count(*), string_agg(p.proname, ', ') INTO _n, _d
    FROM pg_proc p JOIN pg_namespace ns ON ns.oid = p.pronamespace
   WHERE ns.nspname = 'public'
     AND p.proname LIKE '%attendance%'
     AND p.prosrc ~* '(24 hour|24h|edit_window)';
  IF _n > 0 THEN
    RAISE EXCEPTION 'Chunk 4.7: edit-window logic still present in: %', _d;
  END IF;

  -- The teacher can no longer update.
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public' AND tablename = 'attendance'
       AND policyname = 'att teacher write class' AND cmd <> 'INSERT'
  ) THEN
    RAISE EXCEPTION 'Chunk 4.7: the teacher attendance write policy is not INSERT-only';
  END IF;

  -- The marker exists and is invoker-scoped.
  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = 'attendance_day_edits' AND c.relkind = 'v'
  ) THEN
    RAISE EXCEPTION 'Chunk 4.7: the edited-day marker view is missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace ns ON ns.oid = c.relnamespace
     WHERE ns.nspname = 'public' AND c.relname = 'attendance_day_edits'
       AND c.reloptions::text ILIKE '%security_invoker=true%'
  ) THEN
    RAISE EXCEPTION 'Chunk 4.7: attendance_day_edits is not security_invoker — it would bypass policies on attendance_audit';
  END IF;

  -- The edit history that predates this chunk is untouched.
  SELECT count(*) INTO _n FROM public.attendance_audit;
  IF _n < 48 THEN
    RAISE EXCEPTION 'Chunk 4.7: attendance_audit lost rows (% remain, 48 expected)', _n;
  END IF;
END $$;
