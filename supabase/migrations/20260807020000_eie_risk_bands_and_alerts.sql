-- ============================================================================
-- Wire the Educational Intelligence Engine (EIE) into production.
-- ============================================================================
-- src/academic/eie/riskProducts.ts (computeAttendanceRisk / computeHomeworkConsistency)
-- has been a fully-built, unit-tested chronic-risk classifier with ZERO UI or
-- backend consumers since it was written — every page that shows attendance %
-- or homework % just shows the raw number, with no risk framing and no
-- proactive alerting when a student's attendance or homework consistency
-- actually becomes a problem.
--
-- This migration:
--   1. Mirrors the two EIE band-threshold functions in SQL (kept in exact
--      numeric parity with riskProducts.ts — see comments below any time
--      that file's thresholds change, these must change too).
--   2. Persists the computed bands on student_academic_profiles so
--      teacher/principal rollup queries can filter/sort by risk without
--      recomputing client-side for every row.
--   3. Extends refresh_student_academic_profile (the single engine-owned
--      writer for this table, called by the sync engine on every relevant
--      academic event) to recompute both bands on every refresh and, when a
--      student's band newly WORSENS into 'elevated' or 'high' (not merely
--      stays there), notify the student's circle (student + linked parents)
--      and the class's homeroom teacher — reusing the existing
--      _notify_student_circle fan-out primitive, not a new notification path.
--
-- Minimum sample-size guards (attendance_total >= 5, homework_assigned >= 3)
-- prevent noisy false alarms from a single early absence/missed assignment
-- before there's enough signal to call it a pattern.

-- ── 1. SQL mirrors of src/academic/eie/riskProducts.ts thresholds ───────────

CREATE OR REPLACE FUNCTION public._eie_attendance_risk_band(_pct numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _clamped numeric;
  _score numeric;
BEGIN
  IF _pct IS NULL THEN
    RETURN 'unknown';
  END IF;
  -- Mirrors computeAttendanceRisk: risk rises as attendance falls below 95.
  _clamped := LEAST(100, GREATEST(0, _pct));
  _score := LEAST(100, GREATEST(0, ROUND((95 - _clamped) * (100.0 / 45.0))));
  IF _score >= 75 THEN RETURN 'high';
  ELSIF _score >= 55 THEN RETURN 'elevated';
  ELSIF _score >= 35 THEN RETURN 'moderate';
  ELSE RETURN 'low';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._eie_homework_consistency_band(_pct numeric)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  _score numeric;
BEGIN
  IF _pct IS NULL THEN
    RETURN 'unknown';
  END IF;
  -- Mirrors computeHomeworkConsistency: higher completion = healthier (low risk band).
  _score := LEAST(100, GREATEST(0, ROUND(_pct)));
  IF _score >= 85 THEN RETURN 'low';
  ELSIF _score >= 70 THEN RETURN 'moderate';
  ELSIF _score >= 50 THEN RETURN 'elevated';
  ELSE RETURN 'high';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._eie_band_severity(_band text)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE _band
    WHEN 'high' THEN 3
    WHEN 'elevated' THEN 2
    WHEN 'moderate' THEN 1
    ELSE 0
  END;
$$;

-- ── 2. Persist bands on student_academic_profiles ────────────────────────────

ALTER TABLE public.student_academic_profiles
  ADD COLUMN IF NOT EXISTS attendance_risk_band text NOT NULL DEFAULT 'unknown',
  ADD COLUMN IF NOT EXISTS homework_consistency_band text NOT NULL DEFAULT 'unknown';

ALTER TABLE public.student_academic_profiles
  DROP CONSTRAINT IF EXISTS student_academic_profiles_attendance_risk_band_check,
  DROP CONSTRAINT IF EXISTS student_academic_profiles_homework_consistency_band_check;

ALTER TABLE public.student_academic_profiles
  ADD CONSTRAINT student_academic_profiles_attendance_risk_band_check
    CHECK (attendance_risk_band IN ('low', 'moderate', 'elevated', 'high', 'unknown')),
  ADD CONSTRAINT student_academic_profiles_homework_consistency_band_check
    CHECK (homework_consistency_band IN ('low', 'moderate', 'elevated', 'high', 'unknown'));

-- Backfill existing rows so dashboards show real bands immediately, not 'unknown'.
-- Guard both metrics by their sample-size column: a fresh profile row defaults
-- attendance_pct/homework_completion_pct to 0, which must read as "no data yet"
-- (unknown), not a genuine 0% (high risk) — same guard refresh_student_academic_profile
-- applies below.
UPDATE public.student_academic_profiles
SET
  attendance_risk_band = public._eie_attendance_risk_band(
    CASE WHEN attendance_total > 0 THEN attendance_pct ELSE NULL END
  ),
  homework_consistency_band = public._eie_homework_consistency_band(
    CASE WHEN homework_assigned > 0 THEN homework_completion_pct ELSE NULL END
  );

-- Partial index: teacher/principal "who needs attention" queries filter on
-- exactly these two bands; the partial index keeps it small and fast even
-- as the table grows, since most students are not at risk at any given time.
CREATE INDEX IF NOT EXISTS idx_student_academic_profiles_attendance_risk
  ON public.student_academic_profiles (school_id, attendance_risk_band)
  WHERE attendance_risk_band IN ('elevated', 'high');

CREATE INDEX IF NOT EXISTS idx_student_academic_profiles_homework_risk
  ON public.student_academic_profiles (school_id, homework_consistency_band)
  WHERE homework_consistency_band IN ('elevated', 'high');

-- ── 3. Notify a class's homeroom teacher (mirrors _notify_student_circle) ───

CREATE OR REPLACE FUNCTION public._notify_class_teacher(
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
  _teacher_user uuid;
BEGIN
  SELECT t.user_id INTO _teacher_user
  FROM public.classes c
  JOIN public.teachers t ON t.id = c.class_teacher_id
  WHERE c.id = _class_id;

  IF _teacher_user IS NOT NULL THEN
    PERFORM public._notify(_teacher_user, _type, _title, _body, _icon, _link);
  END IF;
END;
$$;

-- ── 4. Extend refresh_student_academic_profile: compute + persist bands,   ──
--       alert only on a genuine worsening transition into elevated/high.   ──

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
  _student_name text;
  _att_pct numeric;
  _hw_pct numeric;
  _new_att_band text;
  _new_hw_band text;
  _prev_att_band text;
  _prev_hw_band text;
BEGIN
  SELECT school_id, class_id, user_id, full_name
    INTO _school, _class, _user, _student_name
  FROM public.students
  WHERE id = _student_id;

  IF _school IS NULL THEN
    RAISE EXCEPTION 'student % not found', _student_id;
  END IF;

  PERFORM public.ensure_student_academic_profile(_student_id);

  SELECT attendance_risk_band, homework_consistency_band
    INTO _prev_att_band, _prev_hw_band
  FROM public.student_academic_profiles
  WHERE student_id = _student_id;

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

  _att_pct := CASE WHEN _att_total > 0 THEN round((_att_present::numeric / _att_total) * 100, 2) ELSE 0 END;
  _hw_pct := CASE WHEN _hw_assigned > 0 THEN round(least(_hw_submitted, _hw_assigned)::numeric / _hw_assigned * 100, 2) ELSE 0 END;
  _new_att_band := public._eie_attendance_risk_band(CASE WHEN _att_total > 0 THEN _att_pct ELSE NULL END);
  _new_hw_band := public._eie_homework_consistency_band(CASE WHEN _hw_assigned > 0 THEN _hw_pct ELSE NULL END);

  UPDATE public.student_academic_profiles SET
    attendance_present = _att_present,
    attendance_total = _att_total,
    attendance_pct = _att_pct,
    attendance_risk_band = _new_att_band,
    homework_assigned = _hw_assigned,
    homework_submitted = _hw_submitted,
    homework_completion_pct = _hw_pct,
    homework_consistency_band = _new_hw_band,
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

  -- Alert only on a genuine worsening transition into elevated/high, with a
  -- minimum sample size so a single bad day never triggers a false alarm.
  IF _att_total >= 5
     AND public._eie_band_severity(_new_att_band) > public._eie_band_severity(coalesce(_prev_att_band, 'unknown'))
     AND public._eie_band_severity(_new_att_band) >= 2
  THEN
    PERFORM public._notify_student_circle(
      _student_id, 'attendance.risk_alert', 'Attendance needs attention',
      format('Attendance is at %s%% (%s of %s days) — this has moved into the "%s" range. Reach out to the class teacher if something is going on.',
             _att_pct, _att_present, _att_total, _new_att_band),
      'alert-triangle', '/parent'
    );
    IF _class IS NOT NULL THEN
      PERFORM public._notify_class_teacher(
        _class, 'attendance.risk_alert', 'Student attendance risk: ' || coalesce(_student_name, 'a student'),
        format('%s%% attendance (%s of %s days present) — %s risk band.', _att_pct, _att_present, _att_total, _new_att_band),
        'alert-triangle', '/teacher/attendance'
      );
    END IF;
  END IF;

  IF _hw_assigned >= 3
     AND public._eie_band_severity(_new_hw_band) > public._eie_band_severity(coalesce(_prev_hw_band, 'unknown'))
     AND public._eie_band_severity(_new_hw_band) >= 2
  THEN
    PERFORM public._notify_student_circle(
      _student_id, 'homework.risk_alert', 'Homework consistency needs attention',
      format('Only %s of %s recent homework assignments completed (%s%%) — this has moved into the "%s" range.',
             _hw_submitted, _hw_assigned, _hw_pct, _new_hw_band),
      'alert-triangle', '/parent'
    );
    IF _class IS NOT NULL THEN
      PERFORM public._notify_class_teacher(
        _class, 'homework.risk_alert', 'Homework consistency risk: ' || coalesce(_student_name, 'a student'),
        format('%s of %s homework assignments completed (%s%%) — %s risk band.', _hw_submitted, _hw_assigned, _hw_pct, _new_hw_band),
        'alert-triangle', '/teacher'
      );
    END IF;
  END IF;

  RETURN _profile;
END;
$$;

GRANT EXECUTE ON FUNCTION public.refresh_student_academic_profile(uuid) TO authenticated;
