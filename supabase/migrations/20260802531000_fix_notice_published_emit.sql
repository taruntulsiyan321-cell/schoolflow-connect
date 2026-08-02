-- Only emit announcement.published when a notice is actually published
-- (status = published on INSERT, or transition to published on UPDATE).
-- Draft/scheduled inserts must not fan out parent/student notifications.

CREATE OR REPLACE FUNCTION public.tg_emit_notice_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' AND NEW.status = 'published' THEN
    PERFORM public.emit_academic_event(
      'announcement.published',
      'announcement',
      NEW.id,
      NEW.school_id,
      NULL,
      NEW.class_id,
      NULL,
      jsonb_build_object('title', NEW.title, 'audience', NEW.audience, 'priority', NEW.priority)
    );
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status = 'published' THEN
    PERFORM public.emit_academic_event(
      'announcement.published',
      'announcement',
      NEW.id,
      NEW.school_id,
      NULL,
      NEW.class_id,
      NULL,
      jsonb_build_object('title', NEW.title, 'audience', NEW.audience, 'priority', NEW.priority)
    );
  END IF;

  PERFORM public.write_academic_audit(
    'announcement', NEW.id, lower(TG_OP),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    NEW.school_id
  );
  RETURN NEW;
END;
$$;
