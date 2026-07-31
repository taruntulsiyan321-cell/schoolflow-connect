-- ============================================================================
-- Homework Engine — production extensions (mirrors Attendance engine pattern)
-- ============================================================================
-- Lifecycle fields, attachments metadata, late submissions, audit + events,
-- school-wide sync/notification coverage for homework.created / reviewed.

-- ── 1. Homework columns ───────────────────────────────────────────────────────
ALTER TABLE public.homework
  ADD COLUMN IF NOT EXISTS instructions text,
  ADD COLUMN IF NOT EXISTS due_time time,
  ADD COLUMN IF NOT EXISTS estimated_minutes integer,
  ADD COLUMN IF NOT EXISTS priority text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS difficulty text,
  ADD COLUMN IF NOT EXISTS max_marks numeric,
  ADD COLUMN IF NOT EXISTS tags text[] DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS external_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS scheduled_publish_at timestamptz,
  ADD COLUMN IF NOT EXISTS published_at timestamptz,
  ADD COLUMN IF NOT EXISTS archived_at timestamptz,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

-- Normalize status vocabulary (keep active as published synonym)
UPDATE public.homework
SET status = 'published'
WHERE coalesce(status, 'active') IN ('active', 'published')
  AND status IS DISTINCT FROM 'published';

UPDATE public.homework
SET status = 'draft'
WHERE status IS NULL OR status = '';

DO $$ BEGIN
  ALTER TABLE public.homework
    DROP CONSTRAINT IF EXISTS homework_status_check;
EXCEPTION WHEN undefined_object THEN NULL;
END $$;

ALTER TABLE public.homework
  ADD CONSTRAINT homework_status_check
  CHECK (status IS NULL OR status IN ('draft', 'scheduled', 'published', 'archived'));

CREATE INDEX IF NOT EXISTS idx_homework_school_status
  ON public.homework (school_id, status);
CREATE INDEX IF NOT EXISTS idx_homework_school_due
  ON public.homework (school_id, due_date);
CREATE INDEX IF NOT EXISTS idx_homework_created_by
  ON public.homework (school_id, created_by);

-- ── 2. Submission columns ───────────────────────────────────────────────────
ALTER TABLE public.homework_submissions
  ADD COLUMN IF NOT EXISTS is_late boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS version integer DEFAULT 1,
  ADD COLUMN IF NOT EXISTS attachments jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS external_links jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS returned_at timestamptz,
  ADD COLUMN IF NOT EXISTS reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS marks_obtained numeric,
  ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now();

ALTER TABLE public.homework_submissions
  DROP CONSTRAINT IF EXISTS homework_submissions_status_check;

ALTER TABLE public.homework_submissions
  ADD CONSTRAINT homework_submissions_status_check
  CHECK (status IN (
    'pending', 'submitted', 'late', 'reviewed', 'returned', 'graded', 'completed'
  ));

CREATE INDEX IF NOT EXISTS idx_hw_sub_school_status
  ON public.homework_submissions (school_id, status);
CREATE INDEX IF NOT EXISTS idx_hw_sub_homework_student
  ON public.homework_submissions (homework_id, student_id);

-- ── 3. Homework event emission + audit ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public.tg_emit_homework_event()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _etype text;
BEGIN
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
    _etype := 'homework.updated';
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
  AFTER INSERT OR UPDATE ON public.homework
  FOR EACH ROW EXECUTE FUNCTION public.tg_emit_homework_event();

-- ── 4. Submission event emission + audit ────────────────────────────────────
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

  IF TG_OP = 'INSERT'
    OR (TG_OP = 'UPDATE' AND NEW.status IN ('submitted', 'late')
        AND OLD.status IS DISTINCT FROM NEW.status) THEN
    _etype := 'homework.submission.created';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status IN ('graded', 'reviewed', 'completed')
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.reviewed';
  ELSIF TG_OP = 'UPDATE'
    AND NEW.status = 'returned'
    AND OLD.status IS DISTINCT FROM NEW.status THEN
    _etype := 'homework.updated';
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

-- ── 5. Sync processor — extend large-class version with homework review/submit ─
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
    ELSIF e.event_type LIKE 'homework%' AND e.class_id IS NOT NULL AND e.student_id IS NULL THEN
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
    ELSIF e.event_type = 'homework.submission.created' THEN
      _title := 'Homework submitted';
      _body := coalesce(e.payload->>'title', 'A student submitted homework');
      _link := '/teacher/homework';
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
    ELSIF e.event_type IN ('homework.submission.graded', 'homework.reviewed') AND e.student_id IS NOT NULL THEN
      _title := 'Homework reviewed';
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
  'Sync outbox event; homework created/published/reviewed + submission teacher notify; large-class safe';

UPDATE public.homework
SET published_at = coalesce(published_at, created_at)
WHERE status IN ('published', 'active') AND published_at IS NULL;
