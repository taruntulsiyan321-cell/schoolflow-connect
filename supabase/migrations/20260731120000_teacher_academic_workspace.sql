-- ============================================================================
-- Teacher Academic Workspace — work_kind, test_kind, exam lifecycle,
-- scheduled publish model, results publish separate from finalize
-- ============================================================================

-- ── 1. Academic Work: work_kind on homework ─────────────────────────────────
ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS work_kind text NOT NULL DEFAULT 'homework';

UPDATE public.homework SET work_kind = 'homework' WHERE work_kind IS NULL OR work_kind = '';

DO $$
BEGIN
  ALTER TABLE public.homework DROP CONSTRAINT IF EXISTS homework_work_kind_check;
  ALTER TABLE public.homework
    ADD CONSTRAINT homework_work_kind_check
    CHECK (work_kind IN (
      'homework', 'assignment', 'worksheet', 'project', 'internal_assessment'
    ));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'homework_work_kind_check: %', SQLERRM;
END $$;

CREATE INDEX IF NOT EXISTS homework_school_class_kind_status_idx
  ON public.homework (school_id, class_id, work_kind, status);

ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz;

-- ── 2. Tests (dpps): kind, status, marks, chapters/topics, schedule ─────────
ALTER TABLE public.dpps
  ADD COLUMN IF NOT EXISTS test_kind text NOT NULL DEFAULT 'class_test',
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'published',
  ADD COLUMN IF NOT EXISTS max_marks numeric,
  ADD COLUMN IF NOT EXISTS passing_marks numeric,
  ADD COLUMN IF NOT EXISTS chapters text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topics text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

UPDATE public.dpps SET status = 'published' WHERE status IS NULL OR status = '';
UPDATE public.dpps SET test_kind = 'class_test' WHERE test_kind IS NULL OR test_kind = '';

DO $$
BEGIN
  ALTER TABLE public.dpps DROP CONSTRAINT IF EXISTS dpps_test_kind_check;
  ALTER TABLE public.dpps
    ADD CONSTRAINT dpps_test_kind_check
    CHECK (test_kind IN ('class_test', 'unit_test', 'surprise_test', 'monthly_test'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'dpps_test_kind_check: %', SQLERRM;
END $$;

DO $$
BEGIN
  ALTER TABLE public.dpps DROP CONSTRAINT IF EXISTS dpps_status_check;
  ALTER TABLE public.dpps
    ADD CONSTRAINT dpps_status_check
    CHECK (status IN ('draft', 'scheduled', 'published', 'archived'));
EXCEPTION WHEN others THEN
  RAISE NOTICE 'dpps_status_check: %', SQLERRM;
END $$;

-- ── 3. Exams: expand types + finalize / publish results ─────────────────────
DO $$
BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'monthly_test';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'mid_term';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'annual';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'practical';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'viva';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'internal';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
DO $$
BEGIN
  ALTER TYPE public.exam_type ADD VALUE IF NOT EXISTS 'surprise_test';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Map legacy final → annual where possible (enum still has final)
UPDATE public.exams SET exam_type = 'annual' WHERE exam_type::text = 'final';

ALTER TABLE public.exams
  ADD COLUMN IF NOT EXISTS marks_locked boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS results_published_at timestamptz,
  ADD COLUMN IF NOT EXISTS passing_marks numeric,
  ADD COLUMN IF NOT EXISTS duration_minutes int,
  ADD COLUMN IF NOT EXISTS chapters text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS topics text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS meta jsonb NOT NULL DEFAULT '{}'::jsonb;

-- ── 4. Emit unpublished already exists; enrich homework events with work_kind ─
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
        'work_kind', OLD.work_kind,
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
    ELSIF NEW.status = 'scheduled' THEN
      _etype := 'homework.scheduled';
    ELSE
      _etype := 'homework.created';
    END IF;
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status IN ('published', 'active') THEN
    _etype := 'homework.published';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND NEW.status = 'scheduled' THEN
    _etype := 'homework.scheduled';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IS DISTINCT FROM OLD.status
    AND OLD.status IN ('published', 'active')
    AND NEW.status = 'draft' THEN
    _etype := 'homework.unpublished';
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
      'work_kind', NEW.work_kind,
      'subject_id', NEW.subject_id,
      'due_date', NEW.due_date,
      'created_by', NEW.created_by,
      'priority', NEW.priority,
      'scheduled_publish_at', NEW.scheduled_publish_at
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

-- ── 5. Sync: notify on results published; kind-aware titles for homework ─────
-- Patch process_academic_event notify section by replacing function body from
-- latest polish migration and extending branches.

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

    IF e.event_type IN ('attendance.marked', 'attendance.updated') AND e.student_id IS NOT NULL THEN
      _title := 'Attendance updated';
      _body := 'Status: ' || coalesce(e.payload->>'status', 'recorded');
      _link := '/parent';
      PERFORM public._notify_student_circle(e.student_id, 'attendance', _title, _body, 'calendar-check', _link);
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
    ELSIF e.event_type IN ('test.scheduled', 'test.published') AND e.class_id IS NOT NULL THEN
      _title := 'New test';
      _body := coalesce(e.payload->>'title', 'A test was published');
      _link := '/student/tests';
      PERFORM public._notify_class_students(e.class_id, 'test', _title, _body, 'clipboard-list', _link);
    ELSIF e.event_type = 'examination.scheduled' AND e.class_id IS NOT NULL THEN
      _title := 'Exam scheduled';
      _body := coalesce(e.payload->>'name', e.payload->>'title', 'An exam was scheduled');
      _link := '/student/tests';
      PERFORM public._notify_class_students(e.class_id, 'exam', _title, _body, 'calendar', _link);
    ELSIF e.event_type = 'marks.results_published' AND e.class_id IS NOT NULL THEN
      _title := 'Results published';
      _body := coalesce(e.payload->>'name', e.payload->>'title', 'Exam results are available');
      _link := '/student/tests';
      PERFORM public._notify_class_students(e.class_id, 'result', _title, _body, 'clipboard-check', _link);
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

-- ── 6. Profile metrics: workByKind breakdown ────────────────────────────────
-- Extend refresh to store workByKind in metrics (additive on top of existing counters)
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
  _by_kind jsonb := '{}'::jsonb;
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

    SELECT coalesce(jsonb_object_agg(work_kind, cnt), '{}'::jsonb)
    INTO _by_kind
    FROM (
      SELECT coalesce(work_kind, 'homework') AS work_kind, count(*)::int AS cnt
      FROM public.homework
      WHERE class_id = _class
        AND school_id = _school
        AND coalesce(status, 'published') IN ('published', 'active')
      GROUP BY coalesce(work_kind, 'homework')
    ) k;
  END IF;

  SELECT count(*) INTO _hw_submitted
  FROM public.homework_submissions hs
  JOIN public.homework h ON h.id = hs.homework_id
  WHERE hs.student_id = _student_id
    AND hs.school_id = _school
    AND coalesce(h.status, 'published') IN ('published', 'active')
    AND hs.status IN ('submitted', 'late', 'reviewed', 'graded', 'completed');

  SELECT count(*) INTO _hw_late
  FROM public.homework_submissions hs
  JOIN public.homework h ON h.id = hs.homework_id
  WHERE hs.student_id = _student_id
    AND hs.school_id = _school
    AND coalesce(h.status, 'published') IN ('published', 'active')
    AND (hs.is_late IS TRUE OR hs.status = 'late');

  SELECT count(*) INTO _hw_returned
  FROM public.homework_submissions hs
  JOIN public.homework h ON h.id = hs.homework_id
  WHERE hs.student_id = _student_id
    AND hs.school_id = _school
    AND coalesce(h.status, 'published') IN ('published', 'active')
    AND hs.status = 'returned';

  SELECT count(*) INTO _hw_reviewed
  FROM public.homework_submissions hs
  JOIN public.homework h ON h.id = hs.homework_id
  WHERE hs.student_id = _student_id
    AND hs.school_id = _school
    AND coalesce(h.status, 'published') IN ('published', 'active')
    AND hs.status IN ('reviewed', 'graded', 'completed');

  SELECT count(*) INTO _hw_graded
  FROM public.homework_submissions hs
  JOIN public.homework h ON h.id = hs.homework_id
  WHERE hs.student_id = _student_id
    AND hs.school_id = _school
    AND coalesce(h.status, 'published') IN ('published', 'active')
    AND hs.status IN ('graded', 'completed');

  _hw_pending := greatest(_hw_assigned - _hw_submitted - _hw_returned, 0);

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
  WHERE m.student_id = _student_id
    AND e.results_published_at IS NOT NULL;

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
      'workByKind', coalesce(_by_kind, '{}'::jsonb),
      'homeworkConsistencyPct', CASE
        WHEN _hw_assigned > 0 THEN round(
          (greatest(_hw_submitted - _hw_late, 0)::numeric / _hw_assigned) * 100, 2
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

-- Stub for future cron: publish due scheduled homework
CREATE OR REPLACE FUNCTION public.publish_due_scheduled_homework()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _n int := 0;
BEGIN
  UPDATE public.homework
  SET status = 'published',
      published_at = coalesce(published_at, now()),
      updated_at = now()
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now();
  GET DIAGNOSTICS _n = ROW_COUNT;

  UPDATE public.dpps
  SET status = 'published',
      published_at = coalesce(published_at, now())
  WHERE status = 'scheduled'
    AND scheduled_publish_at IS NOT NULL
    AND scheduled_publish_at <= now();

  RETURN _n;
END;
$$;

COMMENT ON FUNCTION public.publish_due_scheduled_homework() IS
  'Cron-ready: publishes scheduled homework/tests whose scheduled_publish_at has passed';
