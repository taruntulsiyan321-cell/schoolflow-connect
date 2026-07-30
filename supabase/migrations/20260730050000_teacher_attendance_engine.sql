-- ============================================================================
-- Teacher Attendance reference implementation — engine extensions
-- ============================================================================
-- Adds late / half_day statuses, weighted profile attendance %,
-- and AI cache invalidation on attendance sync.

-- ── 1. Extend attendance_status enum ─────────────────────────────────────────
DO $$ BEGIN
  ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'late';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TYPE public.attendance_status ADD VALUE IF NOT EXISTS 'half_day';
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── 2. Weighted attendance rollup in profile refresh ─────────────────────────
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

  -- present=1, late=1, half_day=0.5, absent/leave=0
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
    last_event_type = 'student.profile.refreshed',
    last_event_at = now(),
    refreshed_at = now(),
    updated_at = now()
  WHERE student_id = _student_id
  RETURNING id INTO _profile;

  -- Invalidate AI agent cache so next AiSummaryService read is fresh
  IF _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'academic_agent_cache'
  ) THEN
    DELETE FROM public.academic_agent_cache WHERE user_id = _user;
  END IF;

  RETURN _profile;
END;
$$;
