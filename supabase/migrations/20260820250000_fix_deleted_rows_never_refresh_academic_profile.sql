-- BUG: student_academic_profiles (the cached attendance/homework/exams/tests
-- rollup shown across student/parent/teacher/principal panels and Nova) is
-- kept in sync by refresh_student_academic_profile(), which runs whenever
-- an academic_events row lands with a non-null student_id (generic
-- top-level dispatch in process_academic_event -- confirmed by reading it).
-- But the triggers that EMIT those events on attendance/marks/
-- homework_submissions/teacher_remarks only fire on INSERT (and, for
-- attendance/marks, UPDATE) -- never DELETE. Any deletion of a source row
-- (an admin correction, a mistaken-entry cleanup, a future "undo" feature)
-- leaves the cached profile permanently stale, since nothing ever asks it
-- to recompute afterward.
--
-- Live-reproduced, not just theorized: a real attendance row for a real
-- student was deleted during this session's verification work, and the
-- cached profile is STILL showing attendance_present=3/attendance_total=3
-- (refreshed_at frozen at the moment right before the delete) even though
-- the actual attendance table now correctly has only 2 rows -- visible
-- right now on the real parent dashboard as "3/3 days, 100%".
--
-- Fix: extend the existing emit-event trigger function for each affected
-- table to also fire AFTER DELETE (using OLD instead of NEW), reusing the
-- exact same emit_academic_event() call already used for INSERT/UPDATE --
-- process_academic_event's generic student_id dispatch picks up the new
-- event type automatically, no changes needed there. This is the same
-- mechanism already trusted for every other write path, not a new one.

CREATE OR REPLACE FUNCTION public.tg_emit_attendance_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.attendance%ROWTYPE;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;

  PERFORM public.emit_academic_event(
    CASE TG_OP WHEN 'INSERT' THEN 'attendance.marked' WHEN 'DELETE' THEN 'attendance.deleted' ELSE 'attendance.updated' END,
    'attendance',
    _row.id,
    _row.school_id,
    _row.student_id,
    _row.class_id,
    NULL,
    jsonb_build_object(
      'date', _row.date,
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
$function$;

DROP TRIGGER IF EXISTS trg_emit_attendance_event ON public.attendance;
CREATE TRIGGER trg_emit_attendance_event
  AFTER INSERT OR UPDATE OR DELETE ON public.attendance
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_attendance_event();

CREATE OR REPLACE FUNCTION public.tg_emit_marks_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.marks%ROWTYPE;
  _exam record;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO _exam FROM public.exams WHERE id = _row.exam_id;

  PERFORM public.emit_academic_event(
    CASE TG_OP WHEN 'INSERT' THEN 'marks.published' WHEN 'DELETE' THEN 'marks.deleted' ELSE 'marks.updated' END,
    'marks',
    _row.id,
    coalesce(_row.school_id, _exam.school_id),
    _row.student_id,
    _exam.class_id,
    NULL,
    jsonb_build_object(
      'exam_id', _row.exam_id,
      'marks_obtained', _row.marks_obtained,
      'max_marks', _exam.max_marks,
      'previous', CASE WHEN TG_OP = 'UPDATE' THEN OLD.marks_obtained ELSE NULL END
    )
  );
  PERFORM public.write_academic_audit(
    'marks', _row.id,
    CASE TG_OP WHEN 'INSERT' THEN 'publish' WHEN 'DELETE' THEN 'delete' ELSE 'update' END,
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    coalesce(_row.school_id, _exam.school_id)
  );
  RETURN _row;
END;
$function$;

DROP TRIGGER IF EXISTS trg_emit_marks_event ON public.marks;
CREATE TRIGGER trg_emit_marks_event
  AFTER INSERT OR UPDATE OR DELETE ON public.marks
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_marks_event();

CREATE OR REPLACE FUNCTION public.tg_emit_homework_submission_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _etype text;
  _row public.homework_submissions%ROWTYPE;
  _hw record;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  SELECT * INTO _hw FROM public.homework WHERE id = _row.homework_id;

  IF TG_OP = 'DELETE' THEN
    _etype := 'homework.submission.deleted';
  ELSIF TG_OP = 'INSERT' AND NEW.status IN ('submitted', 'late') THEN
    _etype := 'homework.submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('submitted', 'late')
    AND coalesce(OLD.version, 1) < coalesce(NEW.version, 1)
    AND OLD.status IN ('submitted', 'late', 'returned') THEN
    _etype := 'homework.resubmitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('submitted', 'late')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'returned'
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.returned';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('graded', 'completed')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.graded';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'reviewed'
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.reviewed';
  ELSE
    _etype := 'homework.updated';
  END IF;

  PERFORM public.emit_academic_event(
    _etype,
    'homework_submission',
    _row.id,
    coalesce(_row.school_id, _hw.school_id),
    _row.student_id,
    _hw.class_id,
    NULL,
    jsonb_build_object(
      'homework_id', _row.homework_id,
      'status', _row.status,
      'is_late', _row.is_late,
      'grade', _row.grade,
      'version', _row.version,
      'title', _hw.title
    )
  );

  PERFORM public.write_academic_audit(
    'homework_submission', _row.id,
    lower(TG_OP),
    CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN to_jsonb(OLD) ELSE NULL END,
    CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
    coalesce(_row.school_id, _hw.school_id)
  );
  RETURN _row;
END;
$function$;

DROP TRIGGER IF EXISTS trg_emit_homework_submission_event ON public.homework_submissions;
CREATE TRIGGER trg_emit_homework_submission_event
  AFTER INSERT OR UPDATE OR DELETE ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_homework_submission_event();

CREATE OR REPLACE FUNCTION public.tg_emit_remark_event()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _row public.teacher_remarks%ROWTYPE;
BEGIN
  _row := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  PERFORM public.emit_academic_event(
    CASE WHEN TG_OP = 'DELETE' THEN 'remark.deleted' ELSE 'remark.created' END,
    'teacher_remark',
    _row.id,
    _row.school_id,
    _row.student_id,
    _row.class_id,
    _row.teacher_id,
    jsonb_build_object('remark_type', _row.remark_type)
  );
  RETURN _row;
END;
$function$;

DROP TRIGGER IF EXISTS trg_emit_remark_event ON public.teacher_remarks;
CREATE TRIGGER trg_emit_remark_event
  AFTER INSERT OR DELETE ON public.teacher_remarks
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_remark_event();

-- One-time repair of the currently-stale profile this bug produced.
SELECT public.refresh_student_academic_profile(id)
FROM public.students
WHERE id = 'd3000001-0001-4000-8000-000000000001';
