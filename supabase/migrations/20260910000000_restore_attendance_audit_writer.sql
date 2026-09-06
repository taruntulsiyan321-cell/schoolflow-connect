-- ═══════════════════════════════════════════════════════════════════════════
-- Correcting attendance was impossible: a replay had put a pre-consolidation
-- trigger back on top of the consolidated one
--
-- ── THE SYMPTOM ──────────────────────────────────────────────────────────
--
-- §10.5 (docs/locked-decisions.md:203-205): attendance is "submitted once.
-- After submission, only admin can edit." `rpc_bulk_upsert_attendance`
-- implements exactly that — it refuses a non-admin with "Attendance for this
-- section on % has already been submitted. Only an admin can change it." and
-- lets an admin through to the UPDATE.
--
-- The UPDATE then always failed:
--
--     42703  record "new" has no field "class_id"
--
-- So the correction the spec reserves to admins could never be performed by
-- anyone, and `attendance_audit` — the table the failing statement wrote —
-- held ZERO rows. The insert path was untouched, which is why first-time
-- marking worked and this stayed invisible until someone tried to fix a
-- mistake. Measured as the admin over real HTTP:
-- `POST /rest/v1/rpc/rpc_bulk_upsert_attendance` on a submitted day returned
-- `{"code":"42703","message":"record \"new\" has no field \"class_id\""}`.
--
-- ── THE CAUSE IS NOT A MISSING FIX. THE FIX WAS OVERWRITTEN. ─────────────
--
-- 20260904100000 (audit consolidation, ruling 4) ALREADY repointed this
-- trigger correctly: it resolves section and date from
-- `attendance_submissions`, writes to `academic_audit`, and never touches a
-- `class_id` column on `attendance`. That migration applied — the evidence is
-- in the database:
--
--   · 48 rows carry metadata.migrated_from = 'attendance_audit'
--   · `audit_logs` is gone, exactly as it dropped it
--   · the ledger records 20260904100000
--
-- ...and yet the LIVE function body was chunk46's, and
-- `public.attendance_audit` still existed although that same migration ends
-- with `DROP TABLE public.attendance_audit`.
--
-- Both facts have one explanation. 20260826200000_chunk46 CREATEs the table
-- and CREATE OR REPLACEs the old function, and `npm run db:migrate` replays
-- every file from the 20260509 cutoff (KNOWN_ISSUES 4). A replay after
-- 2026-09-04 re-ran chunk46 and put both back, on top of a consolidation that
-- had already succeeded. Re-running 20260904100000 cannot repair it either:
-- its verification block asserts `academic_audit` holds exactly 8878 rows, and
-- the table has grown since, so it now aborts before reaching the function.
--
-- This migration therefore re-applies ONLY the two things the replay undid,
-- and asserts SHAPE rather than row counts so it cannot rot the same way.
--
-- ── WHAT IS NOT LOST BY DROPPING attendance_audit ────────────────────────
--
-- Nothing reads it. `attendance_day_edits` — the view `attendanceService.ts`
-- consumes — was repointed to `academic_audit` by the same consolidation and
-- is already reading from there. The table holds 0 rows; its original 48 are
-- in `academic_audit` under metadata.migrated_from. And the surviving
-- `tg_emit_attendance_event` trigger independently records every attendance
-- INSERT, UPDATE and DELETE to `academic_audit` with the full before/after row
-- and a `previous_status`, so the audit trail is strictly richer than the
-- table being removed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── The writer, as 20260904100000 wrote it ───────────────────────────────
-- Byte-for-byte the consolidation's body. Kept identical on purpose: if these
-- two ever diverge, the next replay silently picks a winner.
CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _school uuid;
  _section uuid;
  _date date;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    SELECT s.section_id, s.date INTO _section, _date
      FROM public.attendance_submissions s WHERE s.id = NEW.submission_id;

    SELECT school_id INTO _school FROM public.classes WHERE id = _section;

    -- class_id and date are FROZEN copies of what was true at the moment of
    -- the edit, not a live projection of the submission. That was the point of
    -- the dedicated table and it survives the move: they go into metadata,
    -- which nothing recomputes.
    INSERT INTO public.academic_audit (
      school_id, entity_type, entity_id, action, actor_user_id,
      previous_value, new_value, metadata
    )
    VALUES (
      coalesce(_school, NEW.school_id, public.default_school_id()),
      'attendance',
      NEW.id,
      'attendance.status_edited',
      auth.uid(),
      to_jsonb(OLD.status::text),
      to_jsonb(NEW.status::text),
      jsonb_strip_nulls(jsonb_build_object(
        'student_id',    NEW.student_id,
        'class_id',      _section,
        'date',          _date,
        'submission_id', NEW.submission_id
      ))
    );
  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.tg_log_attendance_change() IS
  'Records an attendance STATUS change to academic_audit. Restored '
  '20260910000000 after a db:migrate replay reinstated the pre-consolidation '
  'body, which referenced NEW.class_id and NEW.date -- columns attendance lost '
  'when the submissions refactor moved them to attendance_submissions -- and '
  'so raised 42703 on every correction.';

-- ── The table the consolidation had already dropped ──────────────────────
DROP TABLE IF EXISTS public.attendance_audit;

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION
--
-- Runs as `postgres`, which bypasses RLS, so it proves NOTHING about who may
-- correct attendance (rule 6). It checks the shape of what was installed. That
-- an admin CAN now correct a submitted day, that the audit row lands, and that
-- a teacher is still refused, are asserted as the caller in probe21 (rule 7).
--
-- Deliberately asserts no row COUNT. The migration this repairs failed to be
-- re-runnable precisely because it asserted `academic_audit` held exactly 8878
-- rows; an audit table grows, so that check had a shelf life.
--
-- Comments are stripped before matching: this file names `NEW.class_id` and
-- `attendance_audit` many times in prose, and an unstripped match would fail a
-- correct change.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _fn    text;
  _strip constant text := '--[^\n]*|/\*.*?\*/';
BEGIN
  SELECT regexp_replace(pg_get_functiondef(p.oid), _strip, '', 'g')
    INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'tg_log_attendance_change';

  IF _fn IS NULL THEN
    RAISE EXCEPTION 'ABORT: tg_log_attendance_change is missing';
  END IF;

  -- The defect, in both of its forms.
  IF _fn ~ 'NEW\.class_id' OR _fn ~ 'NEW\.date' THEN
    RAISE EXCEPTION 'ABORT: the writer still reads columns attendance does not have';
  END IF;
  IF _fn ~ 'INTO\s+public\.attendance_audit' THEN
    RAISE EXCEPTION 'ABORT: the writer still targets the dropped attendance_audit table';
  END IF;

  -- ...and the consolidated shape must actually be there.
  IF _fn !~ 'academic_audit' THEN
    RAISE EXCEPTION 'ABORT: the writer does not target academic_audit';
  END IF;
  IF _fn !~ 'attendance_submissions' THEN
    RAISE EXCEPTION 'ABORT: the writer no longer resolves section/date from the submission';
  END IF;
  IF _fn !~ 'attendance\.status_edited' THEN
    RAISE EXCEPTION 'ABORT: the audit action name was lost';
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables
              WHERE table_schema = 'public' AND table_name = 'attendance_audit') THEN
    RAISE EXCEPTION 'ABORT: attendance_audit still exists';
  END IF;

  -- The trigger itself must survive: replacing the function while the trigger
  -- was gone would leave a correct writer nothing calls.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger t
      JOIN pg_class c ON c.oid = t.tgrelid
      JOIN pg_proc p ON p.oid = t.tgfoid
     WHERE c.relname = 'attendance' AND t.tgname = 'attendance_audit_trg'
       AND p.proname = 'tg_log_attendance_change' AND NOT t.tgisinternal
  ) THEN
    RAISE EXCEPTION 'ABORT: attendance_audit_trg no longer runs this function';
  END IF;

  RAISE NOTICE 'attendance status edits write academic_audit again; behaviour is in probe21.';
END $verify$;
