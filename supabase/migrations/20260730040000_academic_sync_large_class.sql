-- ============================================================================
-- Gurukul Academic Engine — Phase 4b: large-class sync optimization
-- ============================================================================
-- Homework class fan-out no longer refreshes every student inline.
-- Instead enqueue per-student refresh events (batched via process_pending).

CREATE OR REPLACE FUNCTION public.process_academic_event(_event_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  e public.academic_events%ROWTYPE;
  _title text;
  _body text;
  _type text;
  _link text;
  r record;
  _enqueued int := 0;
BEGIN
  SELECT * INTO e FROM public.academic_events WHERE id = _event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF e.status = 'processed' THEN
    RETURN true;
  END IF;

  UPDATE public.academic_events
  SET status = 'processing', error = NULL
  WHERE id = _event_id;

  BEGIN
    -- Direct student refresh
    IF e.student_id IS NOT NULL AND e.event_type <> 'student.profile.refresh_requested' THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type = 'student.profile.refresh_requested' AND e.student_id IS NOT NULL THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type LIKE 'homework%' AND e.class_id IS NOT NULL AND e.student_id IS NULL THEN
      -- Large-class safe: enqueue one refresh event per student (processed asynchronously)
      FOR r IN
        SELECT id FROM public.students WHERE class_id = e.class_id
      LOOP
        INSERT INTO public.academic_events (
          school_id, event_type, entity_type, entity_id,
          actor_user_id, student_id, class_id, payload, status
        ) VALUES (
          e.school_id,
          'student.profile.refresh_requested',
          'student_academic_profile',
          r.id,
          e.actor_user_id,
          r.id,
          e.class_id,
          jsonb_build_object('source_event', e.id, 'source_type', e.event_type),
          'pending'
        );
        _enqueued := _enqueued + 1;
        -- Cap inline enqueue storm; remainder recovered by process_pending
        EXIT WHEN _enqueued >= 100;
      END LOOP;
    END IF;

    _type := split_part(e.event_type, '.', 1);
    _title := initcap(replace(e.event_type, '.', ' '));
    _body := coalesce(e.payload->>'title', e.payload->>'subject', e.event_type);
    _link := NULL;

    IF e.event_type IN ('attendance.marked', 'attendance.updated') AND e.student_id IS NOT NULL THEN
      _title := 'Attendance updated';
      _body := 'Status: ' || coalesce(e.payload->>'status', 'recorded');
      _link := '/parent';
      PERFORM public._notify_student_circle(e.student_id, 'attendance', _title, _body, 'calendar-check', _link);
    ELSIF e.event_type IN ('homework.assigned', 'homework.published') AND e.class_id IS NOT NULL THEN
      _title := 'New homework';
      _body := coalesce(e.payload->>'title', 'A new homework was assigned');
      _link := '/student';
      PERFORM public._notify_class_students(e.class_id, 'homework', _title, _body, 'book-open', _link);
    ELSIF e.event_type IN ('marks.published', 'marks.updated') AND e.student_id IS NOT NULL THEN
      _title := 'Marks published';
      _body := 'Score: ' || coalesce(e.payload->>'marks_obtained', '');
      _link := '/student';
      PERFORM public._notify_student_circle(e.student_id, 'result', _title, _body, 'clipboard-check', _link);
    ELSIF e.event_type = 'announcement.published' THEN
      _title := coalesce(e.payload->>'title', 'New announcement');
      _body := 'A school announcement was published';
      _link := '/student';
      IF e.class_id IS NOT NULL THEN
        PERFORM public._notify_class_students(e.class_id, 'general', _title, _body, 'megaphone', _link);
      END IF;
    ELSIF e.event_type = 'remark.created' AND e.student_id IS NOT NULL THEN
      _title := 'New teacher remark';
      _body := coalesce(e.payload->>'remark_type', 'general');
      PERFORM public._notify_student_circle(e.student_id, 'general', _title, _body, 'message-square', '/parent');
    ELSIF e.event_type = 'homework.submission.graded' AND e.student_id IS NOT NULL THEN
      _title := 'Homework reviewed';
      PERFORM public._notify_student_circle(e.student_id, 'homework', _title, _body, 'check-circle', '/student');
    ELSIF e.event_type = 'practice.session.completed' AND e.student_id IS NOT NULL THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type IN ('doubt.created', 'doubt.replied') THEN
      IF e.student_id IS NOT NULL THEN
        PERFORM public.refresh_student_academic_profile(e.student_id);
      END IF;
    END IF;

    IF e.event_type <> 'student.profile.refresh_requested'
       AND EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='school_activity_feed') THEN
      INSERT INTO public.school_activity_feed (
        school_id, actor_user_id, action, entity_type, entity_id, metadata
      ) VALUES (
        e.school_id,
        e.actor_user_id,
        e.event_type,
        e.entity_type,
        e.entity_id,
        coalesce(e.payload, '{}'::jsonb)
      );
    END IF;

    UPDATE public.academic_events
    SET status = 'processed', processed_at = now(), error = NULL
    WHERE id = _event_id;

    RETURN true;
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.academic_events
    SET status = 'failed', error = SQLERRM, processed_at = now()
    WHERE id = _event_id;
    RETURN false;
  END;
END;
$$;

-- Prevent infinite recursion: refresh_requested events skip the autoprocess
-- notification fan-out storm; they only refresh profile (handled above).
-- Autoprocess trigger still runs — that is intentional for near-realtime.

COMMENT ON FUNCTION public.process_academic_event(uuid) IS
  'Sync one outbox event; homework class fan-out enqueues per-student refreshes (max 100 inline)';

-- Skip autoprocess for queued profile refreshes — drain via process_pending_academic_events
DROP TRIGGER IF EXISTS trg_academic_events_autoprocess ON public.academic_events;
CREATE TRIGGER trg_academic_events_autoprocess
  AFTER INSERT ON public.academic_events
  FOR EACH ROW
  WHEN (
    NEW.status = 'pending'
    AND NEW.event_type IS DISTINCT FROM 'student.profile.refresh_requested'
  )
  EXECUTE FUNCTION public.tg_academic_events_autprocess();
