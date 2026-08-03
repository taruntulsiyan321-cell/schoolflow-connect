-- Auditor closures: Homework + Attendance + Marks + Tests/DPP
-- 1) rpc_dpp_start requires published test (SECURITY DEFINER bypassed RLS)
-- 2) process_academic_event: resolve test.attempt student_id; parent fan-out
--    for homework submit + test attempt completed

-- ─── 1) Published gate on DPP/test start ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_dpp_start(_dpp_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _aid uuid;
  _sid uuid;
  _max numeric;
  _cnt int;
  _published boolean := false;
  _class uuid;
  _status text;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  SELECT
    COALESCE(is_published, false)
      OR lower(COALESCE(status, '')) = 'published',
    class_id,
    status
  INTO _published, _class, _status
  FROM public.dpps
  WHERE id = _dpp_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Test not found';
  END IF;

  IF NOT _published THEN
    -- Teachers / operators may still preview via service paths; students may not start.
    IF NOT (
      public.has_role(auth.uid(), 'teacher')
      OR public.has_role(auth.uid(), 'admin')
      OR public.has_role(auth.uid(), 'principal')
    ) THEN
      RAISE EXCEPTION 'This test is not published yet';
    END IF;
  END IF;

  SELECT id INTO _sid FROM public.students WHERE user_id = auth.uid() LIMIT 1;
  IF _sid IS NOT NULL AND _class IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.id = _sid AND s.class_id = _class
    ) THEN
      -- Allow teachers starting preview attempts without class membership
      IF NOT (
        public.has_role(auth.uid(), 'teacher')
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'principal')
      ) THEN
        RAISE EXCEPTION 'Not enrolled in this class';
      END IF;
    END IF;
  END IF;

  SELECT COALESCE(SUM(marks), 0), count(*)
  INTO _max, _cnt
  FROM public.dpp_questions
  WHERE dpp_id = _dpp_id;

  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count)
  VALUES (_dpp_id, auth.uid(), _sid, _max, _cnt)
  ON CONFLICT (dpp_id, user_id) DO UPDATE
    SET max_score = EXCLUDED.max_score,
        total_count = EXCLUDED.total_count
  RETURNING id INTO _aid;

  RETURN _aid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_dpp_start(uuid) TO authenticated;

-- ─── 2) Parent-only notify helper (avoid re-pinging the student) ─────────────
CREATE OR REPLACE FUNCTION public._notify_student_parents(
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
  SELECT user_id, parent_user_id INTO _uid, _parent
  FROM public.students
  WHERE id = _student_id;

  IF _parent IS NOT NULL AND _parent IS DISTINCT FROM _uid THEN
    PERFORM public._notify(_parent, _type, _title, _body, _icon, _link);
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'parent_students'
  ) THEN
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

-- ─── 3) Patch process_academic_event fan-out gaps ────────────────────────────
-- Re-apply latest body with auditor closures (resolve attempt student_id;
-- homework submit → parents; test.attempt.completed → parents).

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
  _hw_class uuid;
  _last_student uuid;
  _after text;
  _kind text;
  _status text;
  _badge text;
  _xp_user uuid;
  _attempt_student uuid;
  _score_txt text;
BEGIN
  SELECT * INTO e FROM public.academic_events WHERE id = _event_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN false;
  END IF;
  IF e.status = 'processed' THEN
    RETURN true;
  END IF;

  -- Resolve student_id for test attempts emitted without ctx.studentId
  IF e.event_type = 'test.attempt.completed'
     AND e.student_id IS NULL
     AND e.entity_id IS NOT NULL THEN
    SELECT coalesce(
      da.student_id,
      (SELECT s.id FROM public.students s WHERE s.user_id = da.user_id LIMIT 1)
    )
    INTO _attempt_student
    FROM public.dpp_attempts da
    WHERE da.id = e.entity_id;

    IF _attempt_student IS NOT NULL THEN
      UPDATE public.academic_events
      SET student_id = _attempt_student
      WHERE id = _event_id;
      e.student_id := _attempt_student;
    END IF;
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
            'homework.published', 'homework.assigned', 'homework.archived',
            'homework.deleted', 'homework.unpublished', 'homework.class.refresh_chunk'
          ) THEN
      _after := e.payload->>'after_student_id';
      FOR r IN
        SELECT id FROM public.students
        WHERE class_id = e.class_id
          AND school_id = e.school_id
          AND (_after IS NULL OR id::text > _after)
        ORDER BY id
        LIMIT 100
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
        _last_student := r.id;
      END LOOP;

      IF _enqueued >= 100 AND _last_student IS NOT NULL THEN
        INSERT INTO public.academic_events (
          school_id, event_type, entity_type, entity_id,
          actor_user_id, student_id, class_id, payload, status
        ) VALUES (
          e.school_id,
          'homework.class.refresh_chunk',
          'homework',
          e.entity_id,
          e.actor_user_id,
          NULL,
          e.class_id,
          jsonb_build_object(
            'after_student_id', _last_student::text,
            'source_event', e.id,
            'source_type', coalesce(e.payload->>'source_type', e.event_type)
          ),
          'pending'
        );
      END IF;
    ELSIF e.event_type IN ('examination.finalized', 'marks.results_published', 'examination.scheduled')
          AND e.class_id IS NOT NULL AND e.student_id IS NULL THEN
      FOR r IN
        SELECT id FROM public.students
        WHERE class_id = e.class_id AND school_id = e.school_id
        ORDER BY id
        LIMIT 100
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
      END LOOP;
    END IF;

    _type := split_part(e.event_type, '.', 1);
    _title := initcap(replace(e.event_type, '.', ' '));
    _body := coalesce(e.payload->>'title', e.payload->>'subject', e.event_type);
    _link := NULL;
    _kind := coalesce(e.payload->>'work_kind', 'homework');
    _status := lower(coalesce(e.payload->>'status', ''));

    IF e.event_type IN ('attendance.marked', 'attendance.updated') AND e.student_id IS NOT NULL THEN
      IF _status IN ('absent', 'late', 'leave', 'half_day') THEN
        _title := 'Attendance updated';
        _body := 'Status: ' || coalesce(e.payload->>'status', 'recorded');
        _link := '/parent';
        PERFORM public._notify_student_circle(e.student_id, 'attendance', _title, _body, 'calendar-check', _link);
      END IF;
      IF e.event_type = 'attendance.marked' AND _status IN ('absent', 'late', 'leave', 'half_day') THEN
        PERFORM public._notify_school_operators(
          e.school_id, 'attendance', 'Attendance marked',
          'A student was marked ' || _status, 'calendar-check', '/principal'
        );
      END IF;
    ELSIF e.event_type IN ('homework.assigned', 'homework.published') AND e.class_id IS NOT NULL THEN
      _title := CASE _kind
        WHEN 'assignment' THEN 'New assignment'
        WHEN 'worksheet' THEN 'New worksheet'
        WHEN 'project' THEN 'New project'
        WHEN 'internal_assessment' THEN 'New internal assessment'
        ELSE 'New homework'
      END;
      _body := coalesce(e.payload->>'title', 'New academic work was assigned');
      _link := '/student/homework';
      PERFORM public._notify_class_students(e.class_id, 'homework', _title, _body, 'book-open', _link);
      PERFORM public._notify_school_operators(
        e.school_id, 'homework', _title, _body, 'book-open', '/principal'
      );
    ELSIF e.event_type IN ('homework.submitted', 'homework.resubmitted', 'homework.submission.created') THEN
      _title := CASE WHEN e.event_type = 'homework.resubmitted' THEN 'Work resubmitted' ELSE 'Work submitted' END;
      _body := coalesce(e.payload->>'title', 'A student submitted work');
      _link := '/teacher/classes';
      SELECT h.created_by, h.title, h.class_id INTO _teacher, _hw_title, _hw_class
      FROM public.homework h
      WHERE h.id = coalesce((e.payload->>'homework_id')::uuid, (e.payload->>'homeworkId')::uuid);
      IF _teacher IS NOT NULL THEN
        PERFORM public._notify(_teacher, 'homework', _title, coalesce(_hw_title, _body), 'book-open', _link);
      ELSIF _hw_class IS NOT NULL THEN
        FOR r IN
          SELECT DISTINCT t.user_id
          FROM public.teachers t
          WHERE t.user_id IS NOT NULL
            AND (
              t.class_teacher_of = _hw_class
              OR EXISTS (
                SELECT 1 FROM public.teacher_classes tc
                WHERE tc.teacher_id = t.id AND tc.class_id = _hw_class
              )
            )
        LOOP
          PERFORM public._notify(r.user_id, 'homework', _title, coalesce(_hw_title, _body), 'book-open', _link);
        END LOOP;
      END IF;
      -- Parent fan-out (parents only — student already submitted)
      IF e.student_id IS NOT NULL THEN
        PERFORM public._notify_student_parents(
          e.student_id,
          'homework',
          _title,
          coalesce(_hw_title, _body),
          'book-open',
          '/parent'
        );
      END IF;
    ELSIF e.event_type IN ('test.scheduled', 'test.published') AND e.class_id IS NOT NULL THEN
      _title := 'New test';
      _body := coalesce(e.payload->>'title', 'A test was published');
      _link := '/student/tests';
      PERFORM public._notify_class_students(e.class_id, 'test', _title, _body, 'clipboard-list', _link);
      PERFORM public._notify_school_operators(
        e.school_id, 'test', _title, _body, 'clipboard-list', '/principal'
      );
    ELSIF e.event_type = 'test.attempt.completed' AND e.student_id IS NOT NULL THEN
      _score_txt := coalesce(e.payload->>'score', e.payload->>'accuracy');
      _title := 'Test completed';
      _body := CASE
        WHEN _score_txt IS NOT NULL AND _score_txt <> '' THEN 'Score: ' || _score_txt
        ELSE coalesce(e.payload->>'title', 'A class test was submitted')
      END;
      PERFORM public._notify_student_parents(
        e.student_id, 'test', _title, _body, 'clipboard-check', '/parent'
      );
    ELSIF e.event_type = 'examination.scheduled' AND e.class_id IS NOT NULL THEN
      _title := 'Exam scheduled';
      _body := coalesce(e.payload->>'name', e.payload->>'title', 'An exam was scheduled');
      _link := '/student/tests';
      PERFORM public._notify_class_students(e.class_id, 'exam', _title, _body, 'calendar', _link);
      PERFORM public._notify_school_operators(
        e.school_id, 'exam', _title, _body, 'calendar', '/principal'
      );
    ELSIF e.event_type = 'marks.results_published' AND e.class_id IS NOT NULL THEN
      _title := 'Results published';
      _body := coalesce(e.payload->>'name', e.payload->>'title', 'Exam results are available');
      _link := '/student/tests';
      PERFORM public._notify_class_students(e.class_id, 'result', _title, _body, 'clipboard-check', _link);
      PERFORM public._notify_school_operators(
        e.school_id, 'result', _title, _body, 'clipboard-check', '/principal'
      );
    ELSIF e.event_type IN ('marks.published', 'marks.updated') AND e.student_id IS NOT NULL THEN
      NULL;
    ELSIF e.event_type = 'announcement.published' THEN
      _title := coalesce(e.payload->>'title', 'New announcement');
      _body := 'A school announcement was published';
      PERFORM public._fanout_announcement_published(e.school_id, e.class_id, _title, _body);
    ELSIF e.event_type = 'remark.created' AND e.student_id IS NOT NULL THEN
      _title := 'New teacher remark';
      _body := coalesce(e.payload->>'remark_type', 'general');
      PERFORM public._notify_student_circle(e.student_id, 'general', _title, _body, 'message-square', '/parent');
    ELSIF e.event_type IN (
      'homework.reviewed', 'homework.graded', 'homework.returned', 'homework.submission.graded'
    ) AND e.student_id IS NOT NULL THEN
      _title := CASE
        WHEN e.event_type = 'homework.returned' THEN 'Work returned'
        WHEN e.event_type = 'homework.graded' THEN 'Work graded'
        ELSE 'Work reviewed'
      END;
      _body := coalesce(e.payload->>'title', _body);
      PERFORM public._notify_student_circle(
        e.student_id, 'homework', _title, _body,
        CASE WHEN e.event_type = 'homework.returned' THEN 'rotate-ccw' ELSE 'check-circle' END,
        '/student/homework'
      );
    ELSIF e.event_type = 'practice.session.completed' AND e.student_id IS NOT NULL THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type IN ('doubt.created', 'doubt.replied') THEN
      IF e.student_id IS NOT NULL THEN
        PERFORM public.refresh_student_academic_profile(e.student_id);
      END IF;
    ELSIF e.event_type = 'battle.finished' THEN
      IF e.student_id IS NOT NULL THEN
        PERFORM public.refresh_student_academic_profile(e.student_id);
        _title := 'Battle finished';
        _body := coalesce(
          e.payload->>'title',
          'Score ' || coalesce(e.payload->>'score', '0')
        );
        PERFORM public._notify_student_circle(
          e.student_id, 'battle', _title, _body, 'swords', '/student/battleground'
        );
      ELSIF e.actor_user_id IS NOT NULL THEN
        _title := 'Battle finished';
        _body := coalesce(e.payload->>'title', 'Your battle results are ready');
        PERFORM public._notify(
          e.actor_user_id, 'battle', _title, _body, 'swords', '/student/battleground'
        );
      END IF;
    ELSIF e.event_type = 'battle.created' AND e.actor_user_id IS NOT NULL THEN
      NULL;
    ELSIF e.event_type = 'battle.joined' AND e.actor_user_id IS NOT NULL THEN
      NULL;
    ELSIF e.event_type = 'badge.earned' THEN
      _badge := coalesce(e.payload->>'badge_code', 'badge');
      _title := 'Badge earned';
      _body := 'You earned: ' || replace(_badge, '_', ' ');
      _xp_user := coalesce(
        (e.payload->>'user_id')::uuid,
        e.actor_user_id,
        (SELECT user_id FROM public.students WHERE id = e.student_id LIMIT 1)
      );
      IF _xp_user IS NOT NULL THEN
        PERFORM public._notify(
          _xp_user, 'badge', _title, _body, 'award', '/student/achievements'
        );
      END IF;
      IF e.student_id IS NOT NULL THEN
        PERFORM public._notify_student_circle(
          e.student_id, 'badge', _title, _body, 'award', '/parent'
        );
      END IF;
    ELSIF e.event_type = 'xp.updated' AND e.student_id IS NOT NULL THEN
      PERFORM public.refresh_student_academic_profile(e.student_id);
    END IF;

    IF e.event_type NOT IN ('student.profile.refresh_requested', 'homework.class.refresh_chunk')
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
