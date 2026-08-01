-- ============================================================================
-- Cross-role academic live sync: realtime tables, parent RLS via parent_students,
-- quieter attendance notifies, principal/admin fan-out for key academic events.
-- ============================================================================

-- ── 1. Realtime publication for academic source tables ───────────────────────
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.attendance;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.homework;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.homework_submissions;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.marks;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.exams;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.student_academic_profiles;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.school_activity_feed;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.dpps;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

-- ── 2. Parent RLS via parent_students (mirror homework polish) ───────────────
DROP POLICY IF EXISTS "Parents via parent_students can view attendance" ON public.attendance;
CREATE POLICY "Parents via parent_students can view attendance"
  ON public.attendance FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parents p
      JOIN public.parent_students ps ON ps.parent_id = p.id
      WHERE p.user_id = auth.uid()
        AND ps.student_id = attendance.student_id
    )
  );

DROP POLICY IF EXISTS "Parents via parent_students can view marks" ON public.marks;
CREATE POLICY "Parents via parent_students can view marks"
  ON public.marks FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parents p
      JOIN public.parent_students ps ON ps.parent_id = p.id
      WHERE p.user_id = auth.uid()
        AND ps.student_id = marks.student_id
    )
  );

DROP POLICY IF EXISTS "Parents via parent_students can view exams" ON public.exams;
CREATE POLICY "Parents via parent_students can view exams"
  ON public.exams FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.parents p
      JOIN public.parent_students ps ON ps.parent_id = p.id
      JOIN public.students s ON s.id = ps.student_id
      WHERE p.user_id = auth.uid()
        AND s.class_id = exams.class_id
    )
  );

-- Let students/parents receive activity-feed realtime for their school (read-only)
DROP POLICY IF EXISTS activity_feed_select_family ON public.school_activity_feed;
CREATE POLICY activity_feed_select_family ON public.school_activity_feed
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'student')
      OR public.has_role(auth.uid(), 'parent')
    )
  );

-- ── 3. Notify school operators (principal + admin) ───────────────────────────
CREATE OR REPLACE FUNCTION public._notify_school_operators(
  _school_id uuid,
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
    SELECT DISTINCT ur.user_id
    FROM public.user_roles ur
    JOIN public.profiles pr ON pr.id = ur.user_id
    WHERE ur.role IN ('principal'::public.app_role, 'admin'::public.app_role)
      AND pr.school_id = _school_id
      AND ur.user_id IS NOT NULL
  LOOP
    PERFORM public._notify(r.user_id, _type, _title, _body, _icon, _link);
  END LOOP;
END;
$$;

-- ── 4. process_academic_event — quieter attendance + principal fan-out ───────
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
      -- Only notify families for non-present statuses (avoids bulk "present" spam)
      IF _status IN ('absent', 'late', 'leave', 'half_day') THEN
        _title := 'Attendance updated';
        _body := 'Status: ' || coalesce(e.payload->>'status', 'recorded');
        _link := '/parent';
        PERFORM public._notify_student_circle(e.student_id, 'attendance', _title, _body, 'calendar-check', _link);
      END IF;
      -- Principals/admins always get a school ops ping so live boards can refresh via notif + realtime
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
    ELSIF e.event_type IN ('test.scheduled', 'test.published') AND e.class_id IS NOT NULL THEN
      _title := 'New test';
      _body := coalesce(e.payload->>'title', 'A test was published');
      _link := '/student/tests';
      PERFORM public._notify_class_students(e.class_id, 'test', _title, _body, 'clipboard-list', _link);
      PERFORM public._notify_school_operators(
        e.school_id, 'test', _title, _body, 'clipboard-list', '/principal'
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
      -- Individual mark upsert before formal results publish — do not notify parents here
      NULL;
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
