-- Multi-Agent Academic Intelligence System
-- Deterministic analytics + student academic brain + agent cache

-- ── Question tagging: difficulty ───────────────────────────────────────────────
ALTER TABLE public.question_templates
  ADD COLUMN IF NOT EXISTS difficulty text DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard'));

ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS difficulty text DEFAULT 'medium'
    CHECK (difficulty IN ('easy', 'medium', 'hard'));

ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS time_taken_ms int,
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS chapter text,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text,
  ADD COLUMN IF NOT EXISTS difficulty text;

ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS error_type text
    CHECK (error_type IS NULL OR error_type IN (
      'concept_error', 'calculation_error', 'careless_mistake',
      'time_pressure_error', 'misinterpretation_error'
    )),
  ADD COLUMN IF NOT EXISTS difficulty text;

UPDATE public.question_templates SET difficulty = COALESCE(
  NULLIF(template_data->>'difficulty', ''),
  difficulty,
  'medium'
) WHERE difficulty IS NULL OR difficulty = 'medium';

-- ── Student Academic Brain (permanent memory) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_academic_brain (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  strong_subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
  weak_subjects jsonb NOT NULL DEFAULT '[]'::jsonb,
  strong_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  weak_chapters jsonb NOT NULL DEFAULT '[]'::jsonb,
  strong_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  weak_concepts jsonb NOT NULL DEFAULT '[]'::jsonb,
  mistake_history jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery_history jsonb NOT NULL DEFAULT '{}'::jsonb,
  practice_history jsonb NOT NULL DEFAULT '{}'::jsonb,
  speed_trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  accuracy_trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  consistency_trend jsonb NOT NULL DEFAULT '{}'::jsonb,
  mastery_snapshot jsonb NOT NULL DEFAULT '[]'::jsonb,
  improvement_history jsonb NOT NULL DEFAULT '[]'::jsonb,
  mistake_classification_trends jsonb NOT NULL DEFAULT '{}'::jsonb,
  last_session_analytics jsonb NOT NULL DEFAULT '{}'::jsonb,
  recovery_completion_pct numeric NOT NULL DEFAULT 0,
  improvement_trend text NOT NULL DEFAULT 'steady'
    CHECK (improvement_trend IN ('improving', 'slipping', 'steady')),
  total_activities int NOT NULL DEFAULT 0,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS student_academic_brain_student
  ON public.student_academic_brain (student_id);

ALTER TABLE public.student_academic_brain ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "brain self" ON public.student_academic_brain;
CREATE POLICY "brain self" ON public.student_academic_brain
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "brain teacher" ON public.student_academic_brain;
CREATE POLICY "brain teacher" ON public.student_academic_brain
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = student_academic_brain.user_id
        AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── Agent insight cache ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_agent_cache (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_type text NOT NULL CHECK (agent_type IN (
    'learning_pattern', 'recovery', 'revision', 'coach'
  )),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL DEFAULT 'rule' CHECK (source IN ('coach', 'rule')),
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, agent_type)
);

ALTER TABLE public.academic_agent_cache ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "agent cache self" ON public.academic_agent_cache;
CREATE POLICY "agent cache self" ON public.academic_agent_cache
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Rule-based mistake classification ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._classify_mistake_error(
  _student_answer jsonb,
  _correct_answer jsonb,
  _options jsonb,
  _time_taken_ms int DEFAULT NULL,
  _times_wrong int DEFAULT 1
)
RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  s_idx int; c_idx int; s_text text; c_text text;
  opt_count int; s_len int; c_len int;
BEGIN
  s_idx := (_student_answer->>'selected_index')::int;
  c_idx := (_correct_answer->>'correct_index')::int;
  s_text := lower(COALESCE(_student_answer->>'text', ''));
  c_text := lower(COALESCE(_correct_answer->>'text', ''));
  opt_count := COALESCE(jsonb_array_length(_options), 0);

  IF _time_taken_ms IS NOT NULL AND _time_taken_ms < 8000 AND opt_count > 0 THEN
    RETURN 'time_pressure_error';
  END IF;

  IF s_idx IS NOT NULL AND c_idx IS NOT NULL AND abs(s_idx - c_idx) = 1 THEN
    RETURN 'careless_mistake';
  END IF;

  IF s_text <> '' AND c_text <> '' THEN
    s_len := length(s_text); c_len := length(c_text);
    IF s_len > 0 AND c_len > 0 AND (
      s_text ~ '[0-9]' AND c_text ~ '[0-9]' AND
      left(s_text, 3) = left(c_text, 3)
    ) THEN
      RETURN 'calculation_error';
    END IF;
  END IF;

  IF s_idx IS NOT NULL AND c_idx IS NOT NULL AND opt_count > 0 THEN
    IF abs(s_idx - c_idx) >= 2 THEN
      RETURN 'concept_error';
    END IF;
  END IF;

  IF _times_wrong >= 2 THEN
    RETURN 'concept_error';
  END IF;

  RETURN 'misinterpretation_error';
END; $$;

-- ── Refresh academic brain from existing data ───────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_refresh_academic_brain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid;
  _weak_concepts jsonb; _strong_concepts jsonb;
  _weak_chapters jsonb; _strong_chapters jsonb;
  _weak_subjects jsonb; _strong_subjects jsonb;
  _mistake_hist jsonb; _recovery_hist jsonb; _practice_hist jsonb;
  _mastery_snap jsonb; _class_trends jsonb;
  _recovery_pct numeric; _improve_trend text;
  _total_act int; _prev_score numeric; _curr_score numeric;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter,
    'mastery_score', mastery_score, 'mistake_count', mistake_count
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
  INTO _weak_concepts
  FROM public.concept_mastery
  WHERE user_id = _uid AND mastery_score < 60
  LIMIT 15;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter,
    'mastery_score', mastery_score, 'mistake_count', mistake_count
  ) ORDER BY mastery_score DESC), '[]'::jsonb)
  INTO _strong_concepts
  FROM public.concept_mastery
  WHERE user_id = _uid AND mastery_score >= 75
  LIMIT 10;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery ASC), '[]'::jsonb)
  INTO _weak_chapters
  FROM (
    SELECT jsonb_build_object(
      'chapter', chapter, 'subject', subject,
      'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery
    WHERE user_id = _uid AND chapter IS NOT NULL
    GROUP BY chapter, subject
    HAVING avg(mastery_score) < 55
    ORDER BY avg(mastery_score) ASC
    LIMIT 8
  ) wc;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery DESC), '[]'::jsonb)
  INTO _strong_chapters
  FROM (
    SELECT jsonb_build_object(
      'chapter', chapter, 'subject', subject,
      'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery
    WHERE user_id = _uid AND chapter IS NOT NULL
    GROUP BY chapter, subject
    HAVING avg(mastery_score) >= 80
    ORDER BY avg(mastery_score) DESC
    LIMIT 8
  ) sc;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery ASC), '[]'::jsonb)
  INTO _weak_subjects
  FROM (
    SELECT jsonb_build_object(
      'subject', subject, 'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery WHERE user_id = _uid
    GROUP BY subject
    HAVING avg(mastery_score) < 55
    ORDER BY avg(mastery_score) ASC
    LIMIT 5
  ) ws;

  SELECT COALESCE(jsonb_agg(row_data ORDER BY avg_mastery DESC), '[]'::jsonb)
  INTO _strong_subjects
  FROM (
    SELECT jsonb_build_object(
      'subject', subject, 'avg_mastery', round(avg(mastery_score)::numeric, 1)
    ) AS row_data, round(avg(mastery_score)::numeric, 1) AS avg_mastery
    FROM public.concept_mastery WHERE user_id = _uid
    GROUP BY subject
    HAVING avg(mastery_score) >= 80
    ORDER BY avg(mastery_score) DESC
    LIMIT 5
  ) ss;

  SELECT jsonb_build_object(
    'total_mistakes', count(*),
    'unmastered', count(*) FILTER (WHERE NOT mastered),
    'by_subject', COALESCE((
      SELECT jsonb_object_agg(subject, cnt)
      FROM (SELECT subject, count(*) cnt FROM public.student_mistakes
            WHERE user_id = _uid GROUP BY subject) s
    ), '{}'::jsonb),
    'by_error_type', COALESCE((
      SELECT jsonb_object_agg(COALESCE(error_type, 'unknown'), cnt)
      FROM (SELECT error_type, count(*) cnt FROM public.student_mistakes
            WHERE user_id = _uid GROUP BY error_type) e
    ), '{}'::jsonb),
    'recent_7d', count(*) FILTER (WHERE last_wrong_at >= now() - interval '7 days')
  )
  INTO _mistake_hist FROM public.student_mistakes WHERE user_id = _uid;

  SELECT jsonb_build_object(
    'total_assignments', count(*),
    'completed', count(*) FILTER (WHERE status = 'completed'),
    'open', count(*) FILTER (WHERE status IN ('pending', 'in_progress')),
    'avg_completion', round(
      COALESCE(avg(CASE WHEN question_count > 0
        THEN questions_completed::numeric / question_count * 100 END), 0), 1
    )
  )
  INTO _recovery_hist FROM public.recovery_assignments WHERE user_id = _uid;

  SELECT jsonb_build_object(
    'total_sessions', count(*),
    'avg_score', round(COALESCE(avg(score), 0), 1),
    'avg_accuracy', round(COALESCE(
      avg(CASE WHEN question_count > 0 THEN correct_count::numeric / question_count * 100 END), 0
    ), 1),
    'last_7d_sessions', count(*) FILTER (WHERE finished_at >= now() - interval '7 days')
  )
  INTO _practice_hist FROM public.practice_sessions
  WHERE user_id = _uid AND finished_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter,
    'mastery_score', mastery_score, 'total_attempts', total_attempts,
    'correct_attempts', correct_attempts, 'mistake_count', mistake_count
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
  INTO _mastery_snap FROM public.concept_mastery WHERE user_id = _uid;

  SELECT COALESCE(jsonb_object_agg(error_type, cnt), '{}'::jsonb)
  INTO _class_trends
  FROM (
    SELECT COALESCE(error_type, 'unknown') AS error_type, count(*) cnt
    FROM public.student_mistakes WHERE user_id = _uid GROUP BY error_type
  ) t;

  _recovery_pct := COALESCE((_recovery_hist->>'avg_completion')::numeric, 0);

  SELECT avg(mastery_score) INTO _curr_score
  FROM public.concept_mastery WHERE user_id = _uid
    AND last_attempt_at >= now() - interval '7 days';
  SELECT avg(mastery_score) INTO _prev_score
  FROM public.concept_mastery WHERE user_id = _uid
    AND last_attempt_at >= now() - interval '14 days'
    AND last_attempt_at < now() - interval '7 days';

  _improve_trend := CASE
    WHEN _curr_score IS NULL OR _prev_score IS NULL THEN 'steady'
    WHEN _curr_score > _prev_score + 3 THEN 'improving'
    WHEN _curr_score < _prev_score - 3 THEN 'slipping'
    ELSE 'steady'
  END;

  SELECT (
    COALESCE((SELECT count(*) FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL), 0) +
    COALESCE((SELECT count(*) FROM public.student_mistakes WHERE user_id = _uid), 0)
  ) INTO _total_act;

  INSERT INTO public.student_academic_brain (
    user_id, student_id,
    strong_subjects, weak_subjects, strong_chapters, weak_chapters,
    strong_concepts, weak_concepts,
    mistake_history, recovery_history, practice_history,
    speed_trend, accuracy_trend, consistency_trend,
    mastery_snapshot, mistake_classification_trends,
    recovery_completion_pct, improvement_trend, total_activities, updated_at
  ) VALUES (
    _uid, _sid,
    COALESCE(_strong_subjects, '[]'::jsonb),
    COALESCE(_weak_subjects, '[]'::jsonb),
    COALESCE(_strong_chapters, '[]'::jsonb),
    COALESCE(_weak_chapters, '[]'::jsonb),
    COALESCE(_strong_concepts, '[]'::jsonb),
    COALESCE(_weak_concepts, '[]'::jsonb),
    COALESCE(_mistake_hist, '{}'::jsonb),
    COALESCE(_recovery_hist, '{}'::jsonb),
    COALESCE(_practice_hist, '{}'::jsonb),
    jsonb_build_object('avg_ms_per_question', (
      SELECT round(avg(time_taken_ms)::numeric, 0)
      FROM public.question_attempts
      WHERE user_id = _uid AND time_taken_ms IS NOT NULL AND NOT skipped
    )),
    jsonb_build_object(
      'last_session', (_practice_hist->>'avg_accuracy')::numeric,
      'rolling_7d', (_practice_hist->>'avg_accuracy')::numeric
    ),
    jsonb_build_object(
      'sessions_7d', (_practice_hist->>'last_7d_sessions')::int,
      'mistakes_7d', (_mistake_hist->>'recent_7d')::int
    ),
    COALESCE(_mastery_snap, '[]'::jsonb),
    COALESCE(_class_trends, '{}'::jsonb),
    _recovery_pct, _improve_trend, _total_act, now()
  )
  ON CONFLICT (user_id) DO UPDATE SET
    student_id = EXCLUDED.student_id,
    strong_subjects = EXCLUDED.strong_subjects,
    weak_subjects = EXCLUDED.weak_subjects,
    strong_chapters = EXCLUDED.strong_chapters,
    weak_chapters = EXCLUDED.weak_chapters,
    strong_concepts = EXCLUDED.strong_concepts,
    weak_concepts = EXCLUDED.weak_concepts,
    mistake_history = EXCLUDED.mistake_history,
    recovery_history = EXCLUDED.recovery_history,
    practice_history = EXCLUDED.practice_history,
    speed_trend = EXCLUDED.speed_trend,
    accuracy_trend = EXCLUDED.accuracy_trend,
    consistency_trend = EXCLUDED.consistency_trend,
    mastery_snapshot = EXCLUDED.mastery_snapshot,
    mistake_classification_trends = EXCLUDED.mistake_classification_trends,
    recovery_completion_pct = EXCLUDED.recovery_completion_pct,
    improvement_trend = EXCLUDED.improvement_trend,
    total_activities = EXCLUDED.total_activities,
    updated_at = now();

  RETURN (SELECT to_jsonb(b) FROM public.student_academic_brain b WHERE b.user_id = _uid);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_refresh_academic_brain() TO authenticated;

-- ── Deterministic session analytics RPC ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_compute_session_analytics(_session_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _total int; _correct int; _wrong int; _skipped int;
  _score numeric; _accuracy numeric; _time_ms bigint; _avg_time numeric;
  _strong_chapters jsonb; _weak_chapters jsonb;
  _strong_concepts jsonb; _weak_concepts jsonb;
  _result jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF _session_id IS NOT NULL THEN
    SELECT count(*),
      count(*) FILTER (WHERE is_correct),
      count(*) FILTER (WHERE NOT is_correct AND NOT skipped),
      count(*) FILTER (WHERE skipped),
      COALESCE(avg(score), 0),
      COALESCE(sum(time_taken_ms), 0)
    INTO _total, _correct, _wrong, _skipped, _score, _time_ms
    FROM public.question_attempts
    WHERE session_id = _session_id AND user_id = _uid;
  ELSE
    SELECT count(*),
      count(*) FILTER (WHERE is_correct),
      count(*) FILTER (WHERE NOT is_correct AND NOT skipped),
      count(*) FILTER (WHERE skipped),
      COALESCE(avg(score), 0),
      COALESCE(sum(time_taken_ms), 0)
    INTO _total, _correct, _wrong, _skipped, _score, _time_ms
    FROM public.question_attempts
    WHERE user_id = _uid
      AND created_at >= now() - interval '7 days';
  END IF;

  _accuracy := CASE WHEN _total - _skipped > 0
    THEN round(_correct::numeric / (_total - _skipped) * 100, 1) ELSE 0 END;
  _avg_time := CASE WHEN _total > 0 THEN round(_time_ms::numeric / _total, 0) ELSE 0 END;

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO _strong_chapters
  FROM (
    SELECT jsonb_build_object('chapter', chapter, 'subject', subject) AS row_data
    FROM public.question_attempts
    WHERE user_id = _uid AND is_correct AND chapter IS NOT NULL
      AND (_session_id IS NULL OR session_id = _session_id)
    GROUP BY chapter, subject
    LIMIT 5
  ) sc;

  SELECT COALESCE(jsonb_agg(row_data), '[]'::jsonb)
  INTO _weak_chapters
  FROM (
    SELECT jsonb_build_object('chapter', chapter, 'subject', subject) AS row_data
    FROM public.question_attempts
    WHERE user_id = _uid AND NOT is_correct AND NOT skipped AND chapter IS NOT NULL
      AND (_session_id IS NULL OR session_id = _session_id)
    GROUP BY chapter, subject
    LIMIT 5
  ) wc;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter
  )), '[]'::jsonb)
  INTO _strong_concepts
  FROM public.question_attempts
  WHERE user_id = _uid AND is_correct AND concept IS NOT NULL
    AND (_session_id IS NULL OR session_id = _session_id)
  LIMIT 8;

  SELECT COALESCE(jsonb_agg(DISTINCT jsonb_build_object(
    'concept', concept, 'subject', subject, 'chapter', chapter
  )), '[]'::jsonb)
  INTO _weak_concepts
  FROM public.question_attempts
  WHERE user_id = _uid AND NOT is_correct AND NOT skipped AND concept IS NOT NULL
    AND (_session_id IS NULL OR session_id = _session_id)
  LIMIT 8;

  _result := jsonb_build_object(
    'score', round(_score, 1),
    'accuracy', _accuracy,
    'time_taken_ms', _time_ms,
    'avg_time_per_question_ms', _avg_time,
    'total_questions', _total,
    'correct', _correct,
    'wrong', _wrong,
    'skipped', _skipped,
    'strong_chapters', COALESCE(_strong_chapters, '[]'::jsonb),
    'weak_chapters', COALESCE(_weak_chapters, '[]'::jsonb),
    'strong_concepts', COALESCE(_strong_concepts, '[]'::jsonb),
    'weak_concepts', COALESCE(_weak_concepts, '[]'::jsonb),
    'computed_at', now()
  );

  UPDATE public.student_academic_brain
  SET last_session_analytics = _result, updated_at = now()
  WHERE user_id = _uid;

  RETURN _result;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_compute_session_analytics(uuid) TO authenticated;

-- ── Get academic brain + agent payloads ───────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_get_academic_brain()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _brain jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  PERFORM public.rpc_refresh_academic_brain();
  SELECT to_jsonb(b) INTO _brain FROM public.student_academic_brain b WHERE b.user_id = _uid;
  RETURN COALESCE(_brain, '{}'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_get_academic_brain() TO authenticated;

-- ── Revision plan from brain (deterministic base) ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_academic_revision_plan()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _brain jsonb;
  _items jsonb; _priorities jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  PERFORM public.rpc_refresh_academic_brain();
  SELECT to_jsonb(b) INTO _brain FROM public.student_academic_brain b WHERE b.user_id = _uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', rq.id,
    'subject', rq.subject,
    'chapter', rq.chapter,
    'topic', rq.topic,
    'reason', rq.reason,
    'priority', rq.priority,
    'due_date', rq.due_date::text,
    'priority_label', CASE
      WHEN rq.priority >= 80 THEN 'High'
      WHEN rq.priority >= 50 THEN 'Medium'
      ELSE 'Low'
    END,
    'source', 'brain_queue'
  ) ORDER BY rq.priority DESC, rq.due_date ASC), '[]'::jsonb)
  INTO _items
  FROM public.revision_queue rq
  WHERE rq.user_id = _uid AND NOT rq.completed
  LIMIT 20;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'concept', w->>'concept',
    'subject', w->>'subject',
    'chapter', w->>'chapter',
    'mastery_score', (w->>'mastery_score')::numeric,
    'priority', CASE WHEN (w->>'mastery_score')::numeric < 40 THEN 90 ELSE 70 END,
    'action', 'Review NCERT + 5 practice questions',
    'source', 'weak_concept'
  ) ORDER BY (w->>'mastery_score')::numeric ASC), '[]'::jsonb)
  INTO _priorities
  FROM jsonb_array_elements(COALESCE(_brain->'weak_concepts', '[]'::jsonb)) w
  LIMIT 8;

  RETURN jsonb_build_object(
    'queue_items', COALESCE(_items, '[]'::jsonb),
    'brain_priorities', COALESCE(_priorities, '[]'::jsonb),
    'improvement_trend', COALESCE(_brain->>'improvement_trend', 'steady'),
    'recovery_completion_pct', COALESCE((_brain->>'recovery_completion_pct')::numeric, 0),
    'sort_note', 'Prioritized from weak concepts, mistake history, and recovery gaps — not random.'
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_academic_revision_plan() TO authenticated;

-- ── Cache agent output ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_cache_agent_insight(
  _agent_type text,
  _payload jsonb,
  _source text DEFAULT 'coach',
  _ttl_hours int DEFAULT 6
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  INSERT INTO public.academic_agent_cache (user_id, agent_type, payload, source, expires_at, updated_at)
  VALUES (_uid, _agent_type, _payload, _source, now() + (_ttl_hours || ' hours')::interval, now())
  ON CONFLICT (user_id, agent_type) DO UPDATE SET
    payload = EXCLUDED.payload,
    source = EXCLUDED.source,
    expires_at = EXCLUDED.expires_at,
    updated_at = now();
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_cache_agent_insight(text, jsonb, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_get_cached_agent_insight(_agent_type text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _row jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT to_jsonb(c) INTO _row
  FROM public.academic_agent_cache c
  WHERE c.user_id = _uid AND c.agent_type = _agent_type
    AND (c.expires_at IS NULL OR c.expires_at > now());
  RETURN COALESCE(_row->'payload', 'null'::jsonb);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_get_cached_agent_insight(text) TO authenticated;

-- ── Hook mistake recording: classify + refresh brain ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_concept_mistake(
  _assessment_type text,
  _source_id uuid,
  _question_id uuid DEFAULT NULL,
  _subject text DEFAULT 'General',
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _class_level int DEFAULT NULL,
  _question_text text DEFAULT '',
  _options jsonb DEFAULT '[]'::jsonb,
  _student_answer jsonb DEFAULT '{}'::jsonb,
  _correct_answer jsonb DEFAULT '{}'::jsonb,
  _explanation text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
  _mastery numeric; _error_type text; _times int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  SELECT times_wrong INTO _times FROM public.student_mistakes
  WHERE user_id = _uid AND source = CASE _assessment_type
    WHEN 'battle' THEN 'battleground' WHEN 'practice' THEN 'practice' ELSE _assessment_type
  END AND question_id = _question_id;
  _times := COALESCE(_times, 0) + 1;

  _error_type := public._classify_mistake_error(
    _student_answer, _correct_answer, _options, NULL, _times
  );

  INSERT INTO public.student_mistakes (
    user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    error_type, times_wrong, last_wrong_at
  ) VALUES (
    _uid, _sid,
    CASE _assessment_type
      WHEN 'battle' THEN 'battleground'
      WHEN 'practice' THEN 'practice'
      ELSE _assessment_type
    END,
    _source_id, _question_id,
    _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _assessment_type,
    _question_text, _options, _student_answer, _correct_answer, _explanation,
    _error_type, 1, now()
  )
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = student_mistakes.times_wrong + 1,
    last_wrong_at = now(),
    student_answer = EXCLUDED.student_answer,
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
    error_type = public._classify_mistake_error(
      EXCLUDED.student_answer, EXCLUDED.correct_answer, EXCLUDED.options,
      NULL, student_mistakes.times_wrong + 1
    ),
    mastered = false
  RETURNING id INTO _mid;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  IF _assessment_type IN ('practice', 'dpp', 'battle') AND _sid IS NOT NULL THEN
    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    VALUES (
      _uid, _sid, _subject, _chapter, _concept_f,
      CASE _assessment_type WHEN 'practice' THEN 'practice_wrong' ELSE _assessment_type || '_wrong' END,
      75, CURRENT_DATE
    );
  END IF;

  SELECT mastery_score INTO _mastery FROM public.concept_mastery
  WHERE user_id = _uid AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND concept = _concept_f
  LIMIT 1;

  IF _assessment_type IN ('practice', 'dpp', 'battle') THEN
    PERFORM public.rpc_assign_concept_recovery(
      _subject, _chapter, _concept_f, _sub_f,
      COALESCE(_mastery, 35),
      _assessment_type, _source_id
    );
  END IF;

  PERFORM public.rpc_refresh_academic_brain();

  RETURN _mid;
END; $$;

-- ── Enrich question attempt recording with tagging + brain update ─────────────
CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _session_id uuid,
  _template_id uuid,
  _generated_question jsonb,
  _selected_answer jsonb,
  _correct_answer jsonb,
  _is_correct boolean,
  _score numeric DEFAULT 0,
  _time_taken_ms int DEFAULT NULL,
  _skipped boolean DEFAULT false
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _aid uuid;
  _tm record; _concept_f text; _sub_f text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
  _concept_f := COALESCE(_tm.concept, _tm.chapter);
  _sub_f := COALESCE(_tm.subconcept, _concept_f);

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, concept, subconcept, difficulty
  ) VALUES (
    _session_id, _sid, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct,
    _time_taken_ms, _skipped,
    _tm.subject, _tm.chapter, _concept_f, _sub_f,
    COALESCE(_tm.difficulty, _tm.template_data->>'difficulty', 'medium')
  ) RETURNING id INTO _aid;

  IF NOT _is_correct AND NOT _skipped THEN
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _template_id,
      _tm.subject, _tm.chapter, _concept_f, _sub_f, _tm.class,
      COALESCE(_generated_question->>'question', ''),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      _selected_answer, _correct_answer,
      COALESCE(_generated_question->>'explanation', _tm.explanation_template)
    );
  ELSE
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _tm.class, _tm.subject, _tm.chapter, _concept_f, _sub_f, true, false
    );
    PERFORM public.rpc_refresh_academic_brain();
  END IF;

  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric, int, boolean
) TO authenticated;
