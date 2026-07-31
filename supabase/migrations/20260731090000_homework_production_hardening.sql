-- ============================================================================
-- Homework production hardening — profile sync, events, audit completeness
-- ============================================================================
-- Apply AFTER considering Homework gold-standard for future academic modules.

-- ── 1. Profile refresh: count all turn-in statuses + homework metrics ────────
CREATE OR REPLACE FUNCTION public.refresh_student_academic_profile(_student_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _school uuid;
  _class uuid;
  _profile uuid;
  _att_present numeric := 0;
  _att_total int := 0;
  _hw_assigned int := 0;
  _hw_submitted int := 0;
  _hw_late int := 0;
  _hw_returned int := 0;
  _hw_reviewed int := 0;
  _hw_graded int := 0;
  _hw_pending int := 0;
  _tests_n int := 0;
  _tests_avg numeric := 0;
  _exams_n int := 0;
  _exams_avg numeric := 0;
  _practice_n int := 0;
  _practice_avg numeric := 0;
  _doubts_asked int := 0;
  _doubts_resolved int := 0;
  _remarks int := 0;
  _user uuid;
  _metrics jsonb := '{}'::jsonb;
BEGIN
  SELECT school_id, class_id, user_id
    INTO _school, _class, _user
  FROM public.students
  WHERE id = _student_id;

  IF _school IS NULL THEN
    RAISE EXCEPTION 'student % not found', _student_id;
  END IF;

  PERFORM public.ensure_student_academic_profile(_student_id);

  SELECT
    coalesce(sum(
      CASE
        WHEN status IN ('present', 'late') THEN 1
        WHEN status = 'half_day' THEN 0.5
        ELSE 0
      END
    ), 0),
    count(*)
  INTO _att_present, _att_total
  FROM public.attendance
  WHERE student_id = _student_id;

  IF _class IS NOT NULL THEN
    SELECT count(*) INTO _hw_assigned
    FROM public.homework
    WHERE class_id = _class
      AND school_id = _school
      AND coalesce(status, 'published') IN ('published', 'active');
  END IF;

  -- Turned in (counts toward completion): any post-submit state including late/returned
  SELECT count(*) INTO _hw_submitted
  FROM public.homework_submissions
  WHERE student_id = _student_id
    AND school_id = _school
    AND status IN ('submitted', 'late', 'reviewed', 'returned', 'graded', 'completed');

  SELECT count(*) INTO _hw_late
  FROM public.homework_submissions
  WHERE student_id = _student_id
    AND school_id = _school
    AND (is_late IS TRUE OR status = 'late');

  SELECT count(*) INTO _hw_returned
  FROM public.homework_submissions
  WHERE student_id = _student_id
    AND school_id = _school
    AND status = 'returned';

  SELECT count(*) INTO _hw_reviewed
  FROM public.homework_submissions
  WHERE student_id = _student_id
    AND school_id = _school
    AND status IN ('reviewed', 'graded', 'completed');

  SELECT count(*) INTO _hw_graded
  FROM public.homework_submissions
  WHERE student_id = _student_id
    AND school_id = _school
    AND status IN ('graded', 'completed');

  _hw_pending := greatest(_hw_assigned - _hw_submitted, 0);

  SELECT count(*), coalesce(avg(
    CASE WHEN max_score > 0 THEN (score::numeric / max_score) * 100 ELSE NULL END
  ), 0)
  INTO _tests_n, _tests_avg
  FROM public.dpp_attempts
  WHERE (student_id = _student_id OR (_user IS NOT NULL AND user_id = _user))
    AND status = 'submitted';

  SELECT count(*), coalesce(avg(
    CASE
      WHEN e.max_marks IS NOT NULL AND e.max_marks > 0
        THEN (m.marks_obtained / e.max_marks) * 100
      ELSE NULL
    END
  ), 0)
  INTO _exams_n, _exams_avg
  FROM public.marks m
  JOIN public.exams e ON e.id = m.exam_id
  WHERE m.student_id = _student_id;

  SELECT count(*), coalesce(avg(
    CASE WHEN question_count > 0 THEN (correct_count::numeric / question_count) * 100 ELSE NULL END
  ), 0)
  INTO _practice_n, _practice_avg
  FROM public.practice_sessions
  WHERE student_id = _student_id
     OR (_user IS NOT NULL AND user_id = _user);

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='community_doubts') THEN
    SELECT count(*),
           count(*) FILTER (WHERE status IN ('solved', 'teacher_answered', 'community_solved'))
    INTO _doubts_asked, _doubts_resolved
    FROM public.community_doubts
    WHERE student_id = _student_id
       OR (_user IS NOT NULL AND user_id = _user);
  END IF;

  SELECT count(*) INTO _remarks
  FROM public.teacher_remarks
  WHERE student_id = _student_id;

  SELECT coalesce(metrics, '{}'::jsonb) INTO _metrics
  FROM public.student_academic_profiles
  WHERE student_id = _student_id;

  _metrics := _metrics
    || jsonb_build_object(
      'homeworkPending', _hw_pending,
      'homeworkLate', _hw_late,
      'homeworkReturned', _hw_returned,
      'homeworkReviewed', _hw_reviewed,
      'homeworkGraded', _hw_graded,
      'homeworkConsistencyPct', CASE
        WHEN _hw_assigned > 0 THEN round(
          ((_hw_submitted - _hw_late)::numeric / _hw_assigned) * 100, 2
        )
        ELSE 0
      END
    );

  UPDATE public.student_academic_profiles SET
    attendance_present = round(_att_present)::integer,
    attendance_total = _att_total,
    attendance_pct = CASE WHEN _att_total > 0 THEN round((_att_present / _att_total) * 100, 2) ELSE 0 END,
    homework_assigned = _hw_assigned,
    homework_submitted = _hw_submitted,
    homework_completion_pct = CASE
      WHEN _hw_assigned > 0 THEN round(least(_hw_submitted, _hw_assigned)::numeric / _hw_assigned * 100, 2)
      ELSE 0
    END,
    tests_attempted = _tests_n,
    tests_avg_pct = round(coalesce(_tests_avg, 0), 2),
    exams_recorded = _exams_n,
    exams_avg_pct = round(coalesce(_exams_avg, 0), 2),
    practice_sessions = _practice_n,
    practice_accuracy_pct = round(coalesce(_practice_avg, 0), 2),
    doubts_asked = coalesce(_doubts_asked, 0),
    doubts_resolved = coalesce(_doubts_resolved, 0),
    remarks_count = _remarks,
    metrics = _metrics,
    last_event_type = 'student.profile.refreshed',
    last_event_at = now(),
    refreshed_at = now(),
    updated_at = now()
  WHERE student_id = _student_id
  RETURNING id INTO _profile;

  IF _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'academic_agent_cache'
  ) THEN
    DELETE FROM public.academic_agent_cache WHERE user_id = _user;
  END IF;

  RETURN _profile;
END;
$$;

COMMENT ON FUNCTION public.refresh_student_academic_profile(uuid) IS
  'Homework-hardened: completion counts submitted|late|reviewed|returned|graded|completed; metrics store late/returned/reviewed/pending';

-- ── 2. Homework row events: archived / deleted specificity ───────────────────
CREATE OR REPLACE FUNCTION public.tg_emit_homework_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _etype text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM public.emit_academic_event(
      'homework.deleted',
      'homework',
      OLD.id,
      OLD.school_id,
      NULL,
      OLD.class_id,
      NULL,
      jsonb_build_object(
        'title', OLD.title,
        'subject', OLD.subject,
        'status', OLD.status,
        'created_by', OLD.created_by
      )
    );
    PERFORM public.write_academic_audit(
      'homework', OLD.id, 'delete', to_jsonb(OLD), NULL, OLD.school_id
    );
    RETURN OLD;
  END IF;

  IF TG_OP = 'INSERT' THEN
    IF NEW.status IN ('published', 'active') THEN
      _etype := 'homework.published';
    ELSE
      _etype := 'homework.created';
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('published', 'active') THEN
    _etype := 'homework.published';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status = 'archived' THEN
    _etype := 'homework.archived';
  ELSE
    _etype := 'homework.updated';
  END IF;

  PERFORM public.emit_academic_event(
    _etype,
    'homework',
    NEW.id,
    NEW.school_id,
    NULL,
    NEW.class_id,
    NULL,
    jsonb_build_object(
      'title', NEW.title,
      'subject', NEW.subject,
      'status', NEW.status,
      'subject_id', NEW.subject_id,
      'due_date', NEW.due_date,
      'created_by', NEW.created_by,
      'priority', NEW.priority
    )
  );

  PERFORM public.write_academic_audit(
    'homework', NEW.id,
    lower(TG_OP),
    CASE WHEN TG_OP = 'UPDATE' THEN to_jsonb(OLD) ELSE NULL END,
    to_jsonb(NEW),
    NEW.school_id
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_emit_homework_event ON public.homework;
CREATE TRIGGER trg_emit_homework_event
  AFTER INSERT OR UPDATE OR DELETE ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_homework_event();

-- ── 3. Submission events: submitted / resubmitted / returned / graded ───────
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
    AND OLD.status IS DISTINCT FROM NEW.status
    AND coalesce(OLD.version, 1) < coalesce(NEW.version, 1) THEN
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

DROP TRIGGER IF EXISTS trg_emit_homework_submission_event ON public.homework_submissions;
CREATE TRIGGER trg_emit_homework_submission_event
  AFTER INSERT OR UPDATE ON public.homework_submissions
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_homework_submission_event();

-- ── 4. Sync processor — handle new homework event names without duplicates ──
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
  _teacher uuid;
  _hw_title text;
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
    IF e.student_id IS NOT NULL AND e.event_type <> 'student.profile.refresh_requested' THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type = 'student.profile.refresh_requested' AND e.student_id IS NOT NULL THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type LIKE 'homework%' AND e.class_id IS NOT NULL AND e.student_id IS NULL
          AND e.event_type IN (
            'homework.published', 'homework.assigned', 'homework.archived', 'homework.deleted'
          ) THEN
      FOR r IN
        SELECT id FROM public.students WHERE class_id = e.class_id AND school_id = e.school_id
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
      _link := '/student/homework';
      PERFORM public._notify_class_students(e.class_id, 'homework', _title, _body, 'book-open', _link);
    ELSIF e.event_type IN ('homework.submitted', 'homework.resubmitted', 'homework.submission.created') THEN
      _title := CASE WHEN e.event_type = 'homework.resubmitted' THEN 'Homework resubmitted' ELSE 'Homework submitted' END;
      _body := coalesce(e.payload->>'title', 'A student submitted homework');
      _link := '/teacher/classes';
      SELECT h.created_by, h.title INTO _teacher, _hw_title
      FROM public.homework h
      WHERE h.id = coalesce((e.payload->>'homework_id')::uuid, (e.payload->>'homeworkId')::uuid);
      IF _teacher IS NOT NULL THEN
        PERFORM public._notify(
          _teacher, 'homework', _title,
          coalesce(_hw_title, _body), 'book-open', _link
        );
      END IF;
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
    ELSIF e.event_type IN (
      'homework.reviewed', 'homework.graded', 'homework.returned', 'homework.submission.graded'
    ) AND e.student_id IS NOT NULL THEN
      _title := CASE
        WHEN e.event_type = 'homework.returned' THEN 'Homework returned'
        WHEN e.event_type = 'homework.graded' THEN 'Homework graded'
        ELSE 'Homework reviewed'
      END;
      _body := coalesce(e.payload->>'title', _body);
      PERFORM public._notify_student_circle(e.student_id, 'homework', _title, _body, 'check-circle', '/student/homework');
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

COMMENT ON FUNCTION public.process_academic_event(uuid) IS
  'Homework gold-standard sync: profile, notify, activity; failures logged on academic_events.error';
