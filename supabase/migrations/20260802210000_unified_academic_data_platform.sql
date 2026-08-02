-- Unified Academic Data Platform (AE extensions) — Nova Context Pack prompt + Practice Intelligence + profile mastery sync
-- Paste into Supabase SQL editor if migrations are applied manually. Safe to re-run.

-- ── 1) Practice attempt completeness columns ─────────────────────────────────
ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS hint_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS solution_viewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS attempt_number int,
  ADD COLUMN IF NOT EXISTS source text;

COMMENT ON COLUMN public.question_attempts.hint_used IS 'Practice Intelligence: learner used a hint';
COMMENT ON COLUMN public.question_attempts.solution_viewed IS 'Practice Intelligence: learner viewed solution';
COMMENT ON COLUMN public.question_attempts.confidence IS 'Optional self-reported confidence 0–1';
COMMENT ON COLUMN public.question_attempts.attempt_number IS 'Nth attempt on same stem within session when tracked';
COMMENT ON COLUMN public.question_attempts.source IS 'Origin surface e.g. practice, recovery, dpp';

-- ── 2) Nova chat prompt v2 — Context Pack facts in template ──────────────────
UPDATE public.ai_prompt_library
SET status = 'retired',
    updated_at = now()
WHERE capability_id = 'student.nova.chat'
  AND version = 'v1'
  AND status = 'production';

INSERT INTO public.ai_prompt_library (
  capability_id, version, status, audience, system_template, user_template,
  output_schema, max_output_tokens, temperature, caching_eligible, metadata
)
SELECT
  'student.nova.chat',
  'v2',
  'production',
  'student',
  'You are Nova, Gurukul''s academic tutor. Use ONLY the provided Academic Engine / EIE facts JSON for personal school metrics (attendance, homework, marks, mastery, weak/strong topics). Never invent attendance %, marks, mastery scores, XP, ranks, or classmate names. If a metric is missing or facts are empty, say school records are not available yet — do not guess. For general study questions unrelated to personal records, you may tutor stepwise without inventing metrics. Prefer stepwise guidance over dumping final answers. Keep under 180 words. Respond in {{language}} when possible.',
  'Grounding facts JSON (Academic Engine + EIE):
{{facts}}

Student message:
{{question}}',
  '{"type":"plain_text","max_words":180}'::jsonb,
  400,
  0.3,
  false,
  '{"source":"nova_context_pack_v1","context_pack":"v1"}'::jsonb
WHERE NOT EXISTS (
  SELECT 1 FROM public.ai_prompt_library p
  WHERE p.capability_id = 'student.nova.chat' AND p.version = 'v2'
);

UPDATE public.ai_prompt_library
SET status = 'production',
    system_template = 'You are Nova, Gurukul''s academic tutor. Use ONLY the provided Academic Engine / EIE facts JSON for personal school metrics (attendance, homework, marks, mastery, weak/strong topics). Never invent attendance %, marks, mastery scores, XP, ranks, or classmate names. If a metric is missing or facts are empty, say school records are not available yet — do not guess. For general study questions unrelated to personal records, you may tutor stepwise without inventing metrics. Prefer stepwise guidance over dumping final answers. Keep under 180 words. Respond in {{language}} when possible.',
    user_template = 'Grounding facts JSON (Academic Engine + EIE):
{{facts}}

Student message:
{{question}}',
    metadata = coalesce(metadata, '{}'::jsonb) || '{"context_pack":"v1"}'::jsonb,
    updated_at = now()
WHERE capability_id = 'student.nova.chat'
  AND version = 'v2';

-- ── 3) Profile refresh merges concept_mastery → metrics.weakTopics/strongTopics ─
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
  _weak_topics jsonb := '[]'::jsonb;
  _strong_topics jsonb := '[]'::jsonb;
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

  -- Live EIE concept_mastery → profile metrics (honest empty arrays when none)
  IF _user IS NOT NULL AND EXISTS (
    SELECT 1 FROM information_schema.tables
    WHERE table_schema = 'public' AND table_name = 'concept_mastery'
  ) THEN
    SELECT coalesce(jsonb_agg(concept ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _weak_topics
    FROM (
      SELECT concept, mastery_score
      FROM public.concept_mastery
      WHERE user_id = _user
        AND mastery_score < 50
      ORDER BY mastery_score ASC
      LIMIT 8
    ) w;

    SELECT coalesce(jsonb_agg(concept ORDER BY mastery_score DESC), '[]'::jsonb)
    INTO _strong_topics
    FROM (
      SELECT concept, mastery_score
      FROM public.concept_mastery
      WHERE user_id = _user
        AND mastery_score >= 75
      ORDER BY mastery_score DESC
      LIMIT 8
    ) s;
  END IF;

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
      END,
      'weakTopics', coalesce(_weak_topics, '[]'::jsonb),
      'strongTopics', coalesce(_strong_topics, '[]'::jsonb)
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
  'AE profile rollup; merges concept_mastery into metrics.weakTopics/strongTopics (Unified Academic Data Platform).';
