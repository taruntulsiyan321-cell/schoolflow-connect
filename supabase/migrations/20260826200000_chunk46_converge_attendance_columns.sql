-- =====================================================================
-- CHUNK 4.6 — CONVERGE THE ATTENDANCE COLUMNS
--
-- Chunk 4 made attendance_submissions the authority for "was this section
-- marked on this day" and declared the stale copies rather than hiding them.
-- This chunk removes them. THREE sources, not two:
--
--   authority     attendance_submissions (section_id, date)
--   stale copy 1  attendance.class_id
--   stale copy 2  attendance.date
--   stale copy 3  attendance_locks (class_id, date)
--
-- HOW THE CONVERGENCE IS EXPRESSED — the students_current pattern again,
-- because it applies again. Eight client queries and eight SQL functions read
-- these columns. Writing the submission join sixteen times would put one rule
-- in sixteen places, so it is written ONCE as a view:
--
--   public.attendance_current = attendance.* + the submission's section and date
--
-- The view exposes them under their EXISTING names (class_id, date) so every
-- caller's select/filter/order works verbatim and only the table name moves.
-- That keeps this chunk a rename, not a rewrite of sixteen queries.
--
-- security_invoker = true, so the view inherits attendance's RLS instead of
-- running as its owner. A view without it is a service-role-shaped hole around
-- every policy on the table it wraps.
--
-- WHAT REPLACES THE UNIQUE CONSTRAINT — this is the part with a real edge:
-- `UNIQUE (student_id, date)` backs the ON CONFLICT in both write paths. Its
-- structural successor is `UNIQUE (student_id, submission_id)`. Those are NOT
-- identical: a student who moves section mid-year could, in principle, be
-- marked by two different sections' submissions on the same date, which the
-- old constraint forbade and the new one allows. So the old guarantee is
-- restored explicitly by a trigger that rejects a second attendance row for
-- the same student on the same date. Both are kept — the structural one and
-- the behavioural one — rather than quietly trading one for the other.
--
-- attendance_locks: locked decision 5 defines the edit window as "24 hours
-- after submission", so a lock is a property OF a submission. It keys on
-- submission_id. Verified before writing: 1 lock exists, 0 without a
-- matching submission.
--
-- G9 — remaining, reported not hidden: whether an explicit lock ROW should
-- exist at all, when attendance_submissions.submitted_at + 24h already
-- expresses the window, is a further question. That is a product decision
-- about explicit vs computed locking, not a stale copy, so it is raised
-- rather than decided here.
--
-- PRESERVED, not changed: the lock INSERT policy still admits the principal.
-- Chunk 4's rule is that the principal may never MARK or EDIT attendance;
-- closing the edit window is neither. A convergence chunk moves a column, it
-- does not quietly redraw a permission — raised rather than altered.
--
-- Reverse: supabase/migrations/rollback/20260826200000_chunk46_down.sql
-- =====================================================================


-- ---------------------------------------------------------------------
-- SECTION 1 — refuse to proceed if anything would be lost
-- ---------------------------------------------------------------------

DO $$
DECLARE _bad int;
BEGIN
  SELECT count(*) INTO _bad
    FROM public.attendance a
    JOIN public.attendance_submissions s ON s.id = a.submission_id
   WHERE a.class_id IS DISTINCT FROM s.section_id OR a.date IS DISTINCT FROM s.date;
  IF _bad > 0 THEN
    RAISE EXCEPTION
      'Chunk 4.6: % attendance row(s) disagree with their submission; resolve before dropping the columns', _bad;
  END IF;

  SELECT count(*) INTO _bad
    FROM public.attendance_locks al
   WHERE NOT EXISTS (
     SELECT 1 FROM public.attendance_submissions s
      WHERE s.section_id = al.class_id AND s.date = al.date);
  IF _bad > 0 THEN
    RAISE EXCEPTION
      'Chunk 4.6: % lock(s) have no submission to attach to; a lock is a property of a submission (locked decision 5)', _bad;
  END IF;

  SELECT count(*) INTO _bad FROM public.attendance WHERE submission_id IS NULL;
  IF _bad > 0 THEN
    RAISE EXCEPTION 'Chunk 4.6: % attendance row(s) are not anchored on a submission', _bad;
  END IF;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 2 — attendance_locks keys on the submission
-- ---------------------------------------------------------------------

ALTER TABLE public.attendance_locks
  ADD COLUMN IF NOT EXISTS submission_id uuid;

UPDATE public.attendance_locks al
   SET submission_id = s.id
  FROM public.attendance_submissions s
 WHERE al.submission_id IS NULL
   AND s.section_id = al.class_id
   AND s.date = al.date;

ALTER TABLE public.attendance_locks ALTER COLUMN submission_id SET NOT NULL;

ALTER TABLE public.attendance_locks DROP CONSTRAINT IF EXISTS attendance_locks_pkey CASCADE;
ALTER TABLE public.attendance_locks
  ADD CONSTRAINT attendance_locks_pkey PRIMARY KEY (submission_id);

ALTER TABLE public.attendance_locks DROP CONSTRAINT IF EXISTS attendance_locks_submission_fk;
ALTER TABLE public.attendance_locks
  ADD CONSTRAINT attendance_locks_submission_fk
  FOREIGN KEY (submission_id) REFERENCES public.attendance_submissions(id) ON DELETE CASCADE;

-- The INSERT policy resolved the teacher's section from the lock's own
-- class_id. It now resolves it through the submission — the authority. This
-- is rewritten rather than CASCADE-dropped: dropping a policy to get a column
-- out of the way is a silent authorization change.
DROP POLICY IF EXISTS "locks teacher insert" ON public.attendance_locks;
CREATE POLICY "locks teacher insert" ON public.attendance_locks
  FOR INSERT
  WITH CHECK (
    (
      EXISTS (
        SELECT 1 FROM public.attendance_submissions s
         WHERE s.id = attendance_locks.submission_id
           AND public.teacher_teaches_class(auth.uid(), s.section_id)
      )
      OR public.is_principal_or_admin(auth.uid())
    )
    AND public.same_school(school_id)
  );

ALTER TABLE public.attendance_locks DROP CONSTRAINT IF EXISTS attendance_locks_class_id_fkey;
ALTER TABLE public.attendance_locks DROP COLUMN IF EXISTS class_id;
ALTER TABLE public.attendance_locks DROP COLUMN IF EXISTS date;

COMMENT ON TABLE public.attendance_locks IS
  'The 24-hour edit window (locked decision 5) is a property of a submission, so a lock keys on submission_id. It no longer carries its own copy of (section, date).';


-- ---------------------------------------------------------------------
-- SECTION 3 — the lock trigger reads the submission
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_reject_locked_attendance_write()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM public.attendance_locks al
     WHERE al.submission_id = NEW.submission_id
  ) THEN
    RAISE EXCEPTION 'Attendance for this class and date is locked and cannot be edited';
  END IF;
  RETURN NEW;
END;
$$;


-- ---------------------------------------------------------------------
-- SECTION 4 — the student-section guard resolves the section via the submission
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_student_section_must_match()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _student_section uuid;
  _record_section  uuid;
BEGIN
  SELECT s.class_id INTO _student_section
    FROM public.students s WHERE s.id = NEW.student_id;

  IF _student_section IS NULL THEN
    RETURN NEW;   -- student not placed in a section yet
  END IF;

  IF TG_TABLE_NAME = 'attendance' THEN
    -- Chunk 4.6: the section comes from the submission, which is the authority.
    SELECT sub.section_id INTO _record_section
      FROM public.attendance_submissions sub WHERE sub.id = NEW.submission_id;
  ELSIF TG_TABLE_NAME = 'homework_submissions' THEN
    SELECT h.class_id INTO _record_section
      FROM public.homework h WHERE h.id = NEW.homework_id;
  ELSIF TG_TABLE_NAME = 'marks' THEN
    SELECT e.class_id INTO _record_section
      FROM public.exams e WHERE e.id = NEW.exam_id;
  END IF;

  IF _record_section IS NULL THEN
    RETURN NEW;   -- the record itself names no section
  END IF;

  IF _record_section IS DISTINCT FROM _student_section THEN
    RAISE EXCEPTION
      'student % is in section %, but this % row is attached to section %',
      NEW.student_id, _student_section, TG_TABLE_NAME, _record_section;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_student_section ON public.attendance;
CREATE TRIGGER trg_attendance_student_section
  BEFORE INSERT OR UPDATE OF student_id, submission_id ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_student_section_must_match();


-- ---------------------------------------------------------------------
-- SECTION 5 — swap the unique constraint, and keep the guarantee it carried
-- ---------------------------------------------------------------------

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_student_id_date_key;

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_student_submission_key;
ALTER TABLE public.attendance
  ADD CONSTRAINT attendance_student_submission_key UNIQUE (student_id, submission_id);

-- UNIQUE(student_id, submission_id) is structurally right but strictly weaker
-- than what it replaces: two sections could each submit for the same date and
-- both mark a student who moved between them. The old guarantee is restored
-- explicitly rather than silently dropped.
CREATE OR REPLACE FUNCTION public.tg_attendance_one_row_per_student_per_day()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _d date; _clash int;
BEGIN
  SELECT s.date INTO _d
    FROM public.attendance_submissions s WHERE s.id = NEW.submission_id;
  IF _d IS NULL THEN RETURN NEW; END IF;

  SELECT count(*) INTO _clash
    FROM public.attendance a
    JOIN public.attendance_submissions s2 ON s2.id = a.submission_id
   WHERE a.student_id = NEW.student_id
     AND s2.date = _d
     -- Only a clash under a DIFFERENT submission is a violation. A repeat
     -- write to the SAME submission is an ordinary re-mark, resolved by
     -- ON CONFLICT (student_id, submission_id) — and this trigger fires
     -- BEFORE that resolution, so without this it would reject every
     -- legitimate upsert. Caught by the seed gate, not by any type check.
     AND a.submission_id IS DISTINCT FROM NEW.submission_id;

  IF _clash > 0 THEN
    RAISE EXCEPTION
      'student % already has attendance recorded for % under a different submission',
      NEW.student_id, _d;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_attendance_one_per_day ON public.attendance;
CREATE TRIGGER trg_attendance_one_per_day
  BEFORE INSERT OR UPDATE OF student_id, submission_id ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_attendance_one_row_per_student_per_day();

REVOKE EXECUTE ON FUNCTION public.tg_attendance_one_row_per_student_per_day() FROM public, anon, authenticated;


-- ---------------------------------------------------------------------
-- SECTION 6 — drop the stale copies
--
-- tg_attendance_matches_submission existed only to stop these columns
-- diverging from the submission. With the columns gone there is nothing left
-- to diverge, so the guard goes with them.
-- ---------------------------------------------------------------------

DROP TRIGGER IF EXISTS trg_attendance_matches_submission ON public.attendance;
DROP FUNCTION IF EXISTS public.tg_attendance_matches_submission();

-- Two policies resolved the teacher's section from attendance.class_id. Both
-- now resolve it through the submission. Rewritten, never CASCADE-dropped:
-- a teacher losing read access to their own class is not a schema detail.
-- The read policy keeps its original grant (any teacher who TEACHES the
-- class) and the write policy keeps its narrower one (the CLASS TEACHER
-- only) — the distinction between them is preserved exactly.
DROP POLICY IF EXISTS "att teacher read class" ON public.attendance;
CREATE POLICY "att teacher read class" ON public.attendance
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_submissions s
       WHERE s.id = attendance.submission_id
         AND public.teacher_teaches_class(auth.uid(), s.section_id)
    )
  );

DROP POLICY IF EXISTS "att teacher write class" ON public.attendance;
CREATE POLICY "att teacher write class" ON public.attendance
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.attendance_submissions s
       WHERE s.id = attendance.submission_id
         AND public.is_class_teacher_of_class(auth.uid(), s.section_id)
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.attendance_submissions s
       WHERE s.id = attendance.submission_id
         AND public.is_class_teacher_of_class(auth.uid(), s.section_id)
    )
  );

ALTER TABLE public.attendance DROP CONSTRAINT IF EXISTS attendance_class_id_fkey;
ALTER TABLE public.attendance DROP COLUMN IF EXISTS class_id;
ALTER TABLE public.attendance DROP COLUMN IF EXISTS date;


-- ---------------------------------------------------------------------
-- SECTION 7 — the single place the submission join is written
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS public.attendance_current;
CREATE VIEW public.attendance_current
WITH (security_invoker = true) AS
SELECT
  a.*,
  s.section_id AS class_id,
  s.date       AS date
FROM public.attendance a
JOIN public.attendance_submissions s ON s.id = a.submission_id;

COMMENT ON VIEW public.attendance_current IS
  'attendance plus its submission''s section and date, under the names callers already use. attendance_submissions is the authority; these columns no longer exist on the table. security_invoker: attendance''s RLS applies to every read through it.';

GRANT SELECT ON public.attendance_current TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 8 — every SQL function reads the view
--
-- Regenerated from each function's OWN live body with a single textual swap,
-- signature and language read back from the catalogue rather than retyped.
-- ---------------------------------------------------------------------

DO $$
DECLARE _p record; _src text; _n int := 0;
BEGIN
  FOR _p IN
    SELECT p.proname, p.prosrc,
           pg_get_function_arguments(p.oid) AS args,
           pg_get_function_result(p.oid)    AS ret,
           l.lanname,
           CASE p.provolatile WHEN 'i' THEN 'IMMUTABLE' WHEN 's' THEN 'STABLE'
                              ELSE 'VOLATILE' END AS vol,
           CASE WHEN p.prosecdef THEN 'SECURITY DEFINER'
                ELSE 'SECURITY INVOKER' END       AS secdef
      FROM pg_proc p
      JOIN pg_namespace n ON n.oid = p.pronamespace
      JOIN pg_language  l ON l.oid = p.prolang
     WHERE n.nspname = 'public'
       AND p.prosrc ~ 'public\.attendance\M'
       AND p.proname NOT LIKE 'tg\_%'
       AND p.proname <> 'rpc_bulk_upsert_attendance'
  LOOP
    _src := regexp_replace(_p.prosrc, 'public\.attendance\M', 'public.attendance_current', 'g');
    IF _src = _p.prosrc THEN CONTINUE; END IF;

    EXECUTE format(
      'CREATE OR REPLACE FUNCTION public.%I(%s) RETURNS %s LANGUAGE %s %s %s SET search_path TO ''public'' AS %L',
      _p.proname, _p.args, _p.ret, _p.lanname, _p.vol, _p.secdef, _src);
    _n := _n + 1;
  END LOOP;

  RAISE NOTICE 'Chunk 4.6: % SQL function(s) repointed at attendance_current', _n;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 9 — assertions
-- ---------------------------------------------------------------------

DO $$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'attendance'
     AND column_name IN ('class_id', 'date');
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 4.6: attendance still carries % stale column(s)', _n; END IF;

  SELECT count(*) INTO _n FROM information_schema.columns
   WHERE table_schema = 'public' AND table_name = 'attendance_locks'
     AND column_name IN ('class_id', 'date');
  IF _n > 0 THEN RAISE EXCEPTION 'Chunk 4.6: attendance_locks still carries % stale column(s)', _n; END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_views WHERE schemaname='public' AND viewname='attendance_current') THEN
    RAISE EXCEPTION 'Chunk 4.6: attendance_current view missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname='public' AND c.relname='attendance_current'
       AND c.reloptions::text LIKE '%security_invoker=true%') THEN
    RAISE EXCEPTION 'Chunk 4.6: attendance_current is not security_invoker — it would bypass attendance RLS';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_constraint
                  WHERE conrelid='public.attendance'::regclass
                    AND conname='attendance_student_submission_key') THEN
    RAISE EXCEPTION 'Chunk 4.6: the replacement unique constraint is missing';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_trigger
                  WHERE tgrelid='public.attendance'::regclass
                    AND tgname='trg_attendance_one_per_day' AND NOT tgisinternal) THEN
    RAISE EXCEPTION 'Chunk 4.6: the one-row-per-student-per-day guarantee was not preserved';
  END IF;

  SELECT count(*) INTO _n FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname='public' AND p.prosrc ~ 'public\.attendance\M[^;]*\m(class_id|date)\M'
     AND p.proname NOT LIKE 'tg\_%';
  RAISE NOTICE 'Chunk 4.6: % non-trigger function(s) still name attendance with class_id/date', _n;
END $$;


-- ---------------------------------------------------------------------
-- SECTION 8b — the bulk write path, rewritten by hand
--
-- Excluded from the automatic swap above because it WRITES: it inserted
-- class_id/date and conflicted on (student_id, date), both of which are gone.
-- The insert now carries only submission_id, and the conflict target is the
-- replacement constraint. Validation ordering — everything checked before
-- anything is written, which is what makes the batch atomic — is unchanged.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.rpc_bulk_upsert_attendance(_rows jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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

  -- A lock now hangs off the submission, so the check joins through it.
  SELECT s.section_id, s.date INTO _locked_class, _locked_date
  FROM jsonb_array_elements(_rows) r
  JOIN public.attendance_submissions s
    ON s.section_id = (r->>'class_id')::uuid
   AND s.date = (r->>'date')::date
  JOIN public.attendance_locks al ON al.submission_id = s.id
  WHERE s.school_id = _school_id
  LIMIT 1;
  IF _locked_class IS NOT NULL THEN
    RAISE EXCEPTION 'Attendance is locked for class % on % — unlock it first', _locked_class, _locked_date;
  END IF;

  FOR _row IN SELECT * FROM jsonb_array_elements(_rows) LOOP
    _student_id := (_row->>'student_id')::uuid;
    _class_id := (_row->>'class_id')::uuid;
    _date := (_row->>'date')::date;
    _status := _row->>'status';

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

  FOR _pair IN
    SELECT DISTINCT (r->>'class_id')::uuid AS cid, (r->>'date')::date AS d
      FROM jsonb_array_elements(_rows) r
  LOOP
    PERFORM public.rpc_ensure_attendance_submission(_pair.cid, _pair.d);
  END LOOP;

  -- The record no longer carries its own section/date: the submission holds them.
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
END; $fn$;


-- ---------------------------------------------------------------------
-- SECTION 10 — the same treatment for locks
--
-- Three call sites read a lock by (class_id, date). They read the view; the
-- one DELETE stays on the table, because a view is not writable and an unlock
-- is a real deletion, not a projection of one.
-- ---------------------------------------------------------------------

DROP VIEW IF EXISTS public.attendance_locks_current;
CREATE VIEW public.attendance_locks_current
WITH (security_invoker = true) AS
SELECT
  al.*,
  s.section_id AS class_id,
  s.date       AS date
FROM public.attendance_locks al
JOIN public.attendance_submissions s ON s.id = al.submission_id;

COMMENT ON VIEW public.attendance_locks_current IS
  'attendance_locks plus its submission''s section and date, under the names callers already use. security_invoker: the table''s RLS applies to every read through it.';

GRANT SELECT ON public.attendance_locks_current TO authenticated;


-- ---------------------------------------------------------------------
-- SECTION 11 — the two attendance TRIGGER functions
--
-- Section 8 deliberately skipped tg_* functions, since a blind textual swap
-- inside a trigger is dangerous. That left these two reading NEW.class_id and
-- NEW.date, which no longer exist — caught by this chunk's own verification on
-- the first INSERT, not by any type check. Both now resolve section and date
-- from the submission.
--
-- The other three tg_emit_*_event functions name class_id/date on THEIR own
-- tables (homework, notices, remarks) and are untouched.
-- ---------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.tg_emit_attendance_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _row public.attendance%ROWTYPE;
  _section uuid;
  _date date;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  SELECT s.section_id, s.date INTO _section, _date
    FROM public.attendance_submissions s WHERE s.id = _row.submission_id;

  PERFORM public.emit_academic_event(
    CASE TG_OP WHEN 'INSERT' THEN 'attendance.marked' WHEN 'DELETE' THEN 'attendance.deleted' ELSE 'attendance.updated' END,
    'attendance',
    _row.id,
    _row.school_id,
    _row.student_id,
    _section,
    NULL,
    jsonb_build_object(
      'date', _date,
      'status', _row.status,
      'previous_status', CASE WHEN TG_OP = 'UPDATE' THEN OLD.status ELSE NULL END
    )
  );
  PERFORM public.write_academic_audit(
    'attendance', _row.id,
    lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    _row.school_id
  );
  RETURN _row;
END;
$fn$;


CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _school uuid;
  _section uuid;
  _date date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT s.section_id, s.date INTO _section, _date
      FROM public.attendance_submissions s WHERE s.id = NEW.submission_id;

    SELECT school_id INTO _school FROM public.classes WHERE id = _section;

    -- attendance_audit keeps its own class_id/date: it is an immutable record
    -- of what was true at the time of the edit, not a live projection of the
    -- submission. Freezing them here is the point of an audit row.
    INSERT INTO public.attendance_audit (
      attendance_id, student_id, class_id, date,
      prev_status, new_status, edited_by, school_id, submission_id
    )
    VALUES (
      NEW.id, NEW.student_id, _section, _date,
      OLD.status::text, NEW.status::text, auth.uid(),
      coalesce(_school, NEW.school_id, public.default_school_id()),
      NEW.submission_id
    );
  END IF;
  RETURN NEW;
END;
$fn$;
