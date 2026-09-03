-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — restore the three dead homework event aliases
--
-- This restores process_academic_event to the definition
-- 20260903140000_notifications_recipient_matrix.sql installed: the same
-- function with 'homework.assigned', 'homework.submission.created' and
-- 'homework.submission.graded' back in their IN lists.
--
-- It is a true inverse — the forward migration removed only those three
-- literals and changed nothing else — but restoring them restores nothing
-- FUNCTIONAL. No producer anywhere emits those three types, and
-- academic_events has never held a row for any of them. What comes back is
-- three names that make the grep look busier, which is the reason they went.
--
-- Roll this back only to unblock a bisect, or if a producer for one of the
-- three is discovered — in which case fix the producer to emit the live name
-- (homework.published / homework.submitted / homework.graded) instead, and
-- leave this rolled forward.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.process_academic_event(_event_id uuid)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _leave public.leave_requests%ROWTYPE;
  _dec public.leave_decisions%ROWTYPE;
  _role_txt text;
  _student_user uuid;
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
    FROM public.test_attempts da
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
      -- §10.15: "Absence alert sent the same day, as soon as the teacher
      -- submits attendance", and a correction notification when it is edited.
      -- The operator fan-out that used to sit here is gone: "a student was
      -- marked absent" is not on §10's principal list, and the item that IS on
      -- it — attendance NOT marked — is the absence of a submission, which no
      -- event can carry.
      IF _status IN ('absent', 'late', 'leave', 'half_day') THEN
        _title := CASE WHEN e.event_type = 'attendance.updated'
                       THEN 'Attendance corrected' ELSE 'Attendance updated' END;
        _body := 'Status: ' || coalesce(e.payload->>'status', 'recorded');
        _link := '/parent';
        PERFORM public._notify_student_circle(e.student_id, 'attendance', _title, _body, 'calendar-check', _link);
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
          e.student_id, 'homework', _title, coalesce(_hw_title, _body), 'book-open', '/parent'
        );
      END IF;

    -- ── LEAVE ──────────────────────────────────────────────────────────────
    ELSIF e.event_type = 'leave.requested' AND e.entity_id IS NOT NULL THEN
      -- §10.6: student leave goes to BOTH the class teacher and the principal,
      -- either may act. §10 puts "leave requests" on the principal's list.
      SELECT * INTO _leave FROM public.leave_requests WHERE id = e.entity_id;
      IF FOUND THEN
        _title := 'Leave request';
        _body := coalesce(_leave.leave_type, 'Leave')
                 || ' · ' || to_char(_leave.from_date, 'DD Mon')
                 || CASE WHEN _leave.to_date IS DISTINCT FROM _leave.from_date
                         THEN ' to ' || to_char(_leave.to_date, 'DD Mon') ELSE '' END;

        -- Teacher leave goes to the principal only (§10.6). Student leave also
        -- reaches the class teacher, which is the one Teacher row §10.5 leaves
        -- unstated but §10.6 requires by name.
        IF _leave.student_id IS NOT NULL AND _leave.class_id IS NOT NULL THEN
          PERFORM public._notify_class_teacher(
            _leave.class_id, 'leave', _title, _body, 'calendar-days', '/teacher/leave'
          );
        END IF;

        PERFORM public._notify_school_operators(
          e.school_id, 'leave', _title, _body, 'calendar-days', '/principal'
        );
      END IF;

    ELSIF e.event_type = 'leave.reviewed' AND e.entity_id IS NOT NULL THEN
      SELECT * INTO _leave FROM public.leave_requests WHERE id = e.entity_id;
      IF FOUND THEN
        -- The decision that triggered this event. §10.6 forbids a combined
        -- verdict, so the notification names ONE decider and never merges two.
        SELECT * INTO _dec
        FROM public.leave_decisions
        WHERE leave_request_id = e.entity_id
        ORDER BY decided_at DESC NULLS LAST
        LIMIT 1;

        _status := lower(coalesce(_dec.decision, e.payload->>'status', 'reviewed'));
        _role_txt := CASE _dec.decided_by_role
          WHEN 'class_teacher' THEN ' by class teacher'
          WHEN 'principal'     THEN ' by principal'
          WHEN 'admin'         THEN ' by admin'
          ELSE ''
        END;

        _title := 'Leave ' || _status || _role_txt;
        _body := coalesce(
          nullif(_dec.reason, ''),
          nullif(_leave.review_note, ''),
          coalesce(_leave.leave_type, 'Leave') || ' · ' || to_char(_leave.from_date, 'DD Mon')
        );

        -- The applicant always hears. §10.12 puts the leave decision among the
        -- notifications a student cannot turn off.
        IF _leave.applicant_user_id IS NOT NULL THEN
          PERFORM public._notify(
            _leave.applicant_user_id, 'leave', _title, _body, 'calendar-days', '/student/leave'
          );
        END IF;

        -- A parent may apply on the child's behalf (§10.15), in which case the
        -- student has not been told yet. Notify the student too, unless they
        -- are the applicant and would get it twice.
        IF _leave.student_id IS NOT NULL THEN
          SELECT s.user_id INTO _student_user
          FROM public.students s WHERE s.id = _leave.student_id;

          IF _student_user IS NOT NULL
             AND _student_user IS DISTINCT FROM _leave.applicant_user_id THEN
            PERFORM public._notify(
              _student_user, 'leave', _title, _body, 'calendar-days', '/student/leave'
            );
          END IF;
        END IF;
      END IF;

    -- ── MARKS ──────────────────────────────────────────────────────────────
    ELSIF e.event_type = 'marks.published' AND e.student_id IS NOT NULL THEN
      -- Was `NULL;` for 5,065 events. §10.12 (student) and §10.15 (parent)
      -- both require it, and §10.12 says it cannot be turned off.
      _title := 'Marks published';
      _body := coalesce(
        e.payload->>'subject', e.payload->>'title', e.payload->>'name',
        'New marks are available'
      );
      PERFORM public._notify_student_circle(
        e.student_id, 'result', _title, _body, 'clipboard-check', '/student/marks'
      );
    ELSIF e.event_type = 'marks.updated' AND e.student_id IS NOT NULL THEN
      -- Deliberately silent. §10.15 names "marks published" and gives
      -- attendance an explicit correction notification; it gives marks none.
      -- The asymmetry is the spec's, not an oversight here.
      NULL;

    ELSIF e.event_type = 'examination.scheduled' AND e.class_id IS NOT NULL THEN
      -- KEPT though nothing emits it: §10.15 owes the parent the exam
      -- timetable. The missing half is the emitter.
      _title := 'Exam scheduled';
      _body := coalesce(e.payload->>'name', e.payload->>'title', 'An exam was scheduled');
      PERFORM public._notify_class_students(e.class_id, 'exam', _title, _body, 'calendar', '/student/tests');
    ELSIF e.event_type = 'marks.results_published' AND e.class_id IS NOT NULL THEN
      -- KEPT: §10.15 "exam results".
      _title := 'Results published';
      _body := coalesce(e.payload->>'name', e.payload->>'title', 'Exam results are available');
      PERFORM public._notify_class_students(e.class_id, 'result', _title, _body, 'clipboard-check', '/student/tests');
    ELSIF e.event_type = 'test.attempt.completed' AND e.student_id IS NOT NULL THEN
      -- KEPT: §10.15 "test results submitted".
      _score_txt := coalesce(e.payload->>'score', e.payload->>'accuracy');
      _title := 'Test completed';
      _body := CASE
        WHEN _score_txt IS NOT NULL AND _score_txt <> '' THEN 'Score: ' || _score_txt
        ELSE coalesce(e.payload->>'title', 'A class test was submitted')
      END;
      PERFORM public._notify_student_parents(
        e.student_id, 'test', _title, _body, 'clipboard-check', '/parent'
      );
    ELSIF e.event_type = 'announcement.published' THEN
      _title := coalesce(e.payload->>'title', 'New announcement');
      _body := 'A school announcement was published';
      PERFORM public._fanout_announcement_published(e.school_id, e.class_id, _title, _body);
    ELSIF e.event_type = 'remark.created' AND e.student_id IS NOT NULL THEN
      -- KEPT: §10.15 "remarks written". §10 is explicit that the PRINCIPAL
      -- gets no remark notification, and _notify_student_circle sends to the
      -- student and parents only, so that line is already respected.
      _title := 'New teacher remark';
      _body := coalesce(e.payload->>'remark_type', 'general');
      PERFORM public._notify_student_circle(e.student_id, 'general', _title, _body, 'message-square', '/parent');
    ELSIF e.event_type IN (
      'homework.reviewed', 'homework.graded', 'homework.returned', 'homework.submission.graded'
    ) AND e.student_id IS NOT NULL THEN
      -- KEPT: §10.15 — the parent sees the submission and the teacher's comment.
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
      -- Profile refresh only. §10.8: practice is private to the student and no
      -- practice fact may reach a parent, so there is nothing to notify.
      PERFORM public.refresh_student_academic_profile(e.student_id);
    ELSIF e.event_type IN ('doubt.created', 'doubt.replied', 'doubt.solved') THEN
      -- The doubt.solved parent notification is REMOVED: nothing emits it and
      -- it appears in neither §10.12 nor §10.15.
      IF e.student_id IS NOT NULL THEN
        PERFORM public.refresh_student_academic_profile(e.student_id);
      END IF;
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
$function$;

DO $verify$
DECLARE _d text;
BEGIN
  SELECT pg_get_functiondef(oid) INTO _d FROM pg_proc
   WHERE proname='process_academic_event' AND pronamespace='public'::regnamespace;
  IF _d NOT ILIKE '%homework.assigned%'
     OR _d NOT ILIKE '%homework.submission.created%'
     OR _d NOT ILIKE '%homework.submission.graded%' THEN
    RAISE EXCEPTION 'the three aliases were not restored';
  END IF;
  IF _d NOT ILIKE '%leave.reviewed%' OR _d NOT ILIKE '%marks.published%' THEN
    RAISE EXCEPTION 'rollback regressed the recipient-matrix fixes; refusing';
  END IF;
END
$verify$;

COMMIT;
