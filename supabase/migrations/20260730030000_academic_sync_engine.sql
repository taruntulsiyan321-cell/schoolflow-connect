-- ============================================================================
-- Gurukul Academic Engine — Phase 4: Synchronization Engine
-- ============================================================================
-- Processes academic_events outbox → refreshes student_academic_profiles,
-- emits notifications, and appends school_activity_feed.
-- Prerequisites: 20260730020000_academic_engine_foundation.sql

-- ── 1. Refresh academic profile from source tables (single rollup) ───────────
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
  _att_present int := 0;
  _att_total int := 0;
  _hw_assigned int := 0;
  _hw_submitted int := 0;
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
    count(*) FILTER (WHERE status = 'present'),
    count(*)
  INTO _att_present, _att_total
  FROM public.attendance
  WHERE student_id = _student_id;

  IF _class IS NOT NULL THEN
    SELECT count(*) INTO _hw_assigned
    FROM public.homework
    WHERE class_id = _class
      AND coalesce(status, 'active') IN ('active', 'published');
  END IF;

  SELECT count(*) INTO _hw_submitted
  FROM public.homework_submissions
  WHERE student_id = _student_id
    AND status IN ('submitted', 'graded');

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

  SELECT count(*),
         count(*) FILTER (WHERE status IN ('solved', 'teacher_answered', 'community_solved'))
  INTO _doubts_asked, _doubts_resolved
  FROM public.community_doubts
  WHERE student_id = _student_id
     OR (_user IS NOT NULL AND user_id = _user);

  SELECT count(*) INTO _remarks
  FROM public.teacher_remarks
  WHERE student_id = _student_id;

  UPDATE public.student_academic_profiles SET
    attendance_present = _att_present,
    attendance_total = _att_total,
    attendance_pct = CASE WHEN _att_total > 0 THEN round((_att_present::numeric / _att_total) * 100, 2) ELSE 0 END,
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
    last_event_type = 'student.profile.refreshed',
    last_event_at = now(),
    refreshed_at = now(),
    updated_at = now()
  WHERE student_id = _student_id
  RETURNING id INTO _profile;

  RETURN _profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_student_academic_profile(uuid) TO authenticated;

-- ── 2. Notify student + linked parents for an academic event ─────────────────
CREATE OR REPLACE FUNCTION public._notify_student_circle(
  _student_id uuid,
  _type text,
  _title text,
  _body text DEFAULT NULL,
  _icon text DEFAULT NULL,
  _link text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _parent uuid;
BEGIN
  SELECT user_id INTO _uid FROM public.students WHERE id = _student_id;
  IF _uid IS NOT NULL THEN
    PERFORM public._notify(_uid, _type, _title, _body, _icon, _link);
  END IF;

  SELECT parent_user_id INTO _parent FROM public.students WHERE id = _student_id;
  IF _parent IS NOT NULL AND _parent IS DISTINCT FROM _uid THEN
    PERFORM public._notify(_parent, _type, _title, _body, _icon, _link);
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='parent_students') THEN
    FOR _parent IN
      SELECT p.user_id
      FROM public.parent_students ps
      JOIN public.parents p ON p.id = ps.parent_id
      WHERE ps.student_id = _student_id AND p.user_id IS NOT NULL
    LOOP
      IF _parent IS DISTINCT FROM _uid THEN
        PERFORM public._notify(_parent, _type, _title, _body, _icon, _link);
      END IF;
    END LOOP;
  END IF;
END;
$$;

-- ── 3. Notify all students in a class (homework / announcement fan-out) ──────
CREATE OR REPLACE FUNCTION public._notify_class_students(
  _class_id uuid,
  _type text,
  _title text,
  _body text DEFAULT NULL,
  _icon text DEFAULT NULL,
  _link text DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT id FROM public.students
    WHERE class_id = _class_id
  LOOP
    PERFORM public._notify_student_circle(r.id, _type, _title, _body, _icon, _link);
  END LOOP;
END;
$$;

-- ── 4. Process a single academic event ───────────────────────────────────────
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
    -- Profile refresh when student-scoped
    IF e.student_id IS NOT NULL THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type LIKE 'homework%' AND e.class_id IS NOT NULL THEN
      -- Refresh all students in class for homework assignment volume
      PERFORM public.refresh_student_academic_profile(s.id)
      FROM public.students s
      WHERE s.class_id = e.class_id;
    END IF;

    -- Notifications
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
    END IF;

    -- Activity feed
    IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema='public' AND table_name='school_activity_feed') THEN
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

GRANT EXECUTE ON FUNCTION public.process_academic_event(uuid) TO authenticated;

-- ── 5. Batch processor ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.process_pending_academic_events(_limit integer DEFAULT 50)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r record;
  _n int := 0;
  _lim int := greatest(1, least(coalesce(_limit, 50), 200));
BEGIN
  FOR r IN
    SELECT id FROM public.academic_events
    WHERE status IN ('pending', 'failed')
    ORDER BY created_at ASC
    LIMIT _lim
    FOR UPDATE SKIP LOCKED
  LOOP
    IF public.process_academic_event(r.id) THEN
      _n := _n + 1;
    END IF;
  END LOOP;
  RETURN _n;
END;
$$;

GRANT EXECUTE ON FUNCTION public.process_pending_academic_events(integer) TO authenticated;

-- ── 6. Auto-process after insert (near-realtime sync, same transaction) ──────
CREATE OR REPLACE FUNCTION public.tg_academic_events_autprocess()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Deferred-style: process this row immediately so dashboards stay fresh
  PERFORM public.process_academic_event(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_academic_events_autoprocess ON public.academic_events;
CREATE TRIGGER trg_academic_events_autoprocess
  AFTER INSERT ON public.academic_events
  FOR EACH ROW
  WHEN (NEW.status = 'pending')
  EXECUTE FUNCTION public.tg_academic_events_autprocess();

COMMENT ON FUNCTION public.refresh_student_academic_profile(uuid) IS
  'Recompute student_academic_profiles from attendance/homework/tests/exams/practice/doubts/remarks — single rollup source';
COMMENT ON FUNCTION public.process_academic_event(uuid) IS
  'Sync one outbox event: profile refresh + notifications + activity feed';
COMMENT ON FUNCTION public.process_pending_academic_events(integer) IS
  'Drain pending/failed academic_events (batch / recovery)';
