-- Fix: same-status resubmit (version bump, status stays submitted/late)
-- must emit homework.resubmitted so teachers are notified.

CREATE OR REPLACE FUNCTION public.tg_emit_homework_submission_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _etype text;
  _hw record;
BEGIN
  SELECT * INTO _hw FROM public.homework WHERE id = NEW.homework_id;

  IF TG_OP = 'INSERT' AND NEW.status IN ('submitted', 'late') THEN
    _etype := 'homework.submitted';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('submitted', 'late')
    AND coalesce(OLD.version, 1) < coalesce(NEW.version, 1) THEN
    -- Replace / resubmit even when status stays submitted|late
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
    NEW.id,
    coalesce(NEW.school_id, _hw.school_id),
    NEW.student_id,
    _hw.class_id,
    NULL,
    jsonb_build_object(
      'homework_id', NEW.homework_id,
      'status', NEW.status,
      'is_late', NEW.is_late,
      'grade', NEW.grade,
      'version', NEW.version,
      'title', _hw.title
    )
  );

  PERFORM public.write_academic_audit(
    'homework_submission', NEW.id,
    lower(TG_OP),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    coalesce(NEW.school_id, _hw.school_id)
  );
  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.tg_emit_homework_submission_event() IS
  'Emits homework.resubmitted on version bump even when status stays submitted/late';
