-- Academic integrity closures (auditor):
-- 1) process_academic_event: examination.deleted class profile refresh
-- 2) process_academic_event: doubt.solved profile + parent notify
-- 3) First-answer solve trigger also emits doubt.solved academic event (SSOT)

-- ─── 1+2) Patch process_academic_event (latest body + integrity extras) ───────
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
    ELSIF e.event_type IN (
            'examination.finalized',
            'marks.results_published',
            'examination.scheduled',
            'examination.deleted'
          )
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
    ELSIF e.event_type = 'examination.deleted' AND e.class_id IS NOT NULL THEN
      _title := 'Exam removed';
      _body := coalesce(e.payload->>'name', e.payload->>'title', 'An exam was removed');
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
    ELSIF e.event_type IN ('doubt.created', 'doubt.replied', 'doubt.solved') THEN
      IF e.student_id IS NOT NULL THEN
        PERFORM public.refresh_student_academic_profile(e.student_id);
      END IF;
      IF e.event_type = 'doubt.solved' AND e.student_id IS NOT NULL THEN
        PERFORM public._notify_student_parents(
          e.student_id,
          'doubt',
          'Doubt solved',
          coalesce(e.payload->>'title', 'Your child''s doubt was answered'),
          'message-circle',
          '/parent'
        );
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

-- ─── 3) First-answer solve also emits doubt.solved (DB SSOT) ─────────────────
CREATE OR REPLACE FUNCTION public.tg_community_doubt_first_answer_solves()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _first_solve boolean := false;
  _author uuid;
  _student uuid;
  _school uuid;
BEGIN
  UPDATE public.community_doubts
  SET
    status = 'solved',
    solved_at = COALESCE(solved_at, now()),
    solved_by_answer_id = COALESCE(solved_by_answer_id, NEW.id),
    accepted_answer_id = COALESCE(accepted_answer_id, NEW.id),
    answer_count = GREATEST(COALESCE(answer_count, 0), 0) + 1,
    teacher_answered = teacher_answered OR (NEW.author_role IN ('teacher', 'admin', 'principal')),
    last_activity_at = now(),
    updated_at = now()
  WHERE id = NEW.doubt_id
    AND status IN ('open', 'unsolved');

  IF FOUND THEN
    _first_solve := true;
  ELSE
    UPDATE public.community_doubts
    SET
      answer_count = GREATEST(COALESCE(answer_count, 0), 0) + 1,
      teacher_answered = teacher_answered OR (NEW.author_role IN ('teacher', 'admin', 'principal')),
      last_activity_at = now(),
      updated_at = now()
    WHERE id = NEW.doubt_id;
  END IF;

  IF _first_solve THEN
    SELECT user_id, student_id, school_id
      INTO _author, _student, _school
    FROM public.community_doubts
    WHERE id = NEW.doubt_id;

    IF _author IS NOT NULL AND _author IS DISTINCT FROM NEW.user_id THEN
      BEGIN
        PERFORM public._notify(
          _author,
          'doubt',
          'Your doubt was answered',
          left(NEW.body, 120),
          'message-circle',
          '/student/doubts'
        );
      EXCEPTION WHEN undefined_function OR others THEN
        NULL;
      END;
    END IF;

    IF _school IS NOT NULL THEN
      BEGIN
        PERFORM public.emit_academic_event(
          'doubt.solved',
          'student_doubt',
          NEW.doubt_id,
          _school,
          _student,
          NULL,
          NULL,
          jsonb_build_object(
            'answerId', NEW.id,
            'doubtId', NEW.doubt_id,
            'source', 'tg_community_doubt_first_answer_solves'
          )
        );
      EXCEPTION WHEN undefined_function OR others THEN
        NULL;
      END;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;
