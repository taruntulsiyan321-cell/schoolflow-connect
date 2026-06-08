-- Unify self-practice with improvement plans, weak topics, heatmap, and analytics.
-- Fixes: improvement/analytics only counted DPP + battles; self-practice was isolated.

ALTER TABLE public.academic_daily_activity
  ADD COLUMN IF NOT EXISTS self_practice_count int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._bump_academic_activity(
  _uid uuid,
  _dpp int DEFAULT 0,
  _hw int DEFAULT 0,
  _battle int DEFAULT 0,
  _mins int DEFAULT 0,
  _self_practice int DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.academic_daily_activity (
    user_id, activity_date, dpp_count, homework_count, battle_count, practice_minutes, self_practice_count
  )
  VALUES (_uid, CURRENT_DATE, _dpp, _hw, _battle, _mins, _self_practice)
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    dpp_count = academic_daily_activity.dpp_count + EXCLUDED.dpp_count,
    homework_count = academic_daily_activity.homework_count + EXCLUDED.homework_count,
    battle_count = academic_daily_activity.battle_count + EXCLUDED.battle_count,
    practice_minutes = academic_daily_activity.practice_minutes + EXCLUDED.practice_minutes,
    self_practice_count = academic_daily_activity.self_practice_count + EXCLUDED.self_practice_count;
END; $$;

-- DPP + battles + self-practice (question_attempts)
CREATE OR REPLACE FUNCTION public._weak_topics_for_user(_uid uuid)
RETURNS TABLE(subject text, chapter text, topic text, attempts int, correct int, accuracy numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH dpp_stats AS (
    SELECT d.subject, d.chapter, d.topic,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE da.is_correct)::int AS correct
    FROM public.dpp_attempts att
    JOIN public.dpps d ON d.id = att.dpp_id
    JOIN public.dpp_answers da ON da.attempt_id = att.id
    WHERE att.user_id = _uid AND att.status = 'submitted'
    GROUP BY d.subject, d.chapter, d.topic
  ),
  battle_stats AS (
    SELECT b.subject, b.chapter, b.topic,
           count(ba.id)::int AS attempts,
           count(*) FILTER (WHERE ba.is_correct)::int AS correct
    FROM public.battle_participants bp
    JOIN public.battles b ON b.id = bp.battle_id
    JOIN public.battle_answers ba ON ba.participant_id = bp.id
    WHERE bp.user_id = _uid AND bp.finished_at IS NOT NULL
    GROUP BY b.subject, b.chapter, b.topic
  ),
  practice_stats AS (
    SELECT
      COALESCE(qt.subject, ps.subject) AS subject,
      COALESCE(qt.chapter, ps.chapter) AS chapter,
      COALESCE(NULLIF(qt.concept, ''), qt.chapter, ps.chapter) AS topic,
      count(*)::int AS attempts,
      count(*) FILTER (WHERE qa.is_correct)::int AS correct
    FROM public.question_attempts qa
    JOIN public.practice_sessions ps ON ps.id = qa.session_id
    LEFT JOIN public.question_templates qt ON qt.id = qa.template_id
    WHERE qa.user_id = _uid
    GROUP BY
      COALESCE(qt.subject, ps.subject),
      COALESCE(qt.chapter, ps.chapter),
      COALESCE(NULLIF(qt.concept, ''), qt.chapter, ps.chapter)
  ),
  combined AS (
    SELECT subject, chapter, topic, sum(attempts) AS attempts, sum(correct) AS correct
    FROM (
      SELECT * FROM dpp_stats
      UNION ALL SELECT * FROM battle_stats
      UNION ALL SELECT * FROM practice_stats
    ) u
    GROUP BY subject, chapter, topic
  )
  SELECT subject, chapter, topic, attempts::int, correct::int,
         CASE WHEN attempts > 0 THEN round(100.0 * correct / attempts, 1) ELSE 0 END AS accuracy
  FROM combined
  WHERE attempts >= 2;
$$;

CREATE OR REPLACE FUNCTION public._exam_readiness(_uid uuid, _student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att_pct numeric := 0; _dpp_pct numeric := 0; _acc numeric := 0; _practice_acc numeric := 0;
  _practice int := 0; _score numeric := 0; _label text; _tone text;
  _att_total int; _att_present int; _dpp_done int; _dpp_total int;
BEGIN
  IF _student_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE status = 'present')
      INTO _att_total, _att_present FROM public.attendance WHERE student_id = _student_id;
    IF _att_total > 0 THEN _att_pct := 100.0 * _att_present / _att_total; END IF;
  END IF;

  SELECT count(DISTINCT dpp_id) FILTER (WHERE status = 'submitted'),
         count(DISTINCT dpp_id)
    INTO _dpp_done, _dpp_total
  FROM public.dpp_attempts WHERE user_id = _uid;
  IF _dpp_total > 0 THEN _dpp_pct := 100.0 * _dpp_done / _dpp_total; END IF;

  SELECT COALESCE(round(avg(CASE WHEN total_count > 0 THEN 100.0 * correct_count / total_count END), 1), 0)
    INTO _acc FROM public.dpp_attempts WHERE user_id = _uid AND status = 'submitted';

  SELECT COALESCE(round(100.0 * count(*) FILTER (WHERE is_correct) / NULLIF(count(*), 0), 1), 0)
    INTO _practice_acc FROM public.question_attempts WHERE user_id = _uid;

  IF _practice_acc > 0 THEN
    _acc := round((_acc + _practice_acc) / CASE WHEN _acc > 0 THEN 2 ELSE 1 END, 1);
  END IF;

  SELECT COALESCE(sum(dpp_count + homework_count + battle_count + self_practice_count), 0)
    INTO _practice FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14;

  _score := LEAST(100, round(
    _att_pct * 0.25 + _dpp_pct * 0.25 + _acc * 0.35 + LEAST(_practice, 14) / 14.0 * 100 * 0.15
  , 0));

  IF _score >= 75 THEN _label := 'Ready'; _tone := 'ready';
  ELSIF _score >= 50 THEN _label := 'Needs Improvement'; _tone := 'improving';
  ELSE _label := 'High Risk'; _tone := 'risk';
  END IF;

  RETURN jsonb_build_object(
    'score', _score, 'label', _label, 'tone', _tone,
    'attendance_pct', round(_att_pct, 1), 'dpp_completion_pct', round(_dpp_pct, 1),
    'accuracy_pct', _acc, 'practice_accuracy_pct', _practice_acc,
    'active_days_14d', _practice
  );
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record; _mins int;
BEGIN
  UPDATE public.practice_sessions SET finished_at = now()
    WHERE id = _session_id AND user_id = auth.uid()
    RETURNING * INTO _s;
  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  _mins := GREATEST(
    COALESCE(extract(epoch FROM (now() - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  RETURN jsonb_build_object(
    'session_id', _s.id,
    'chapter', _s.chapter,
    'subject', _s.subject,
    'question_count', _s.question_count,
    'correct_count', _s.correct_count,
    'score', _s.score
  );
END; $$;

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
DECLARE _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  INSERT INTO public.student_mistakes (
    user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at
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
    1, now()
  )
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = student_mistakes.times_wrong + 1,
    last_wrong_at = now(),
    student_answer = EXCLUDED.student_answer,
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
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

  RETURN _mid;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_student_improvement_plans()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _plans jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  WITH weak AS (
    SELECT w.subject, w.chapter, w.topic, w.accuracy, w.attempts, 'activity'::text AS src
    FROM public._weak_topics_for_user(_uid) w
    WHERE w.accuracy < 65
    UNION ALL
    SELECT cm.subject, cm.chapter, cm.concept AS topic,
           cm.mastery_score AS accuracy, cm.total_attempts AS attempts, 'mastery'::text AS src
    FROM public.concept_mastery cm
    WHERE cm.user_id = _uid AND cm.mastery_score < 65 AND cm.total_attempts >= 2
      AND NOT EXISTS (
        SELECT 1 FROM public._weak_topics_for_user(_uid) w2
        WHERE w2.subject = cm.subject
          AND COALESCE(w2.chapter, '') = COALESCE(cm.chapter, '')
          AND COALESCE(w2.topic, '') = COALESCE(cm.concept, '')
      )
  ),
  deduped AS (
    SELECT DISTINCT ON (subject, COALESCE(chapter, ''), COALESCE(topic, ''))
      subject, chapter, topic, accuracy, attempts, src
    FROM weak
    ORDER BY subject, COALESCE(chapter, ''), COALESCE(topic, ''), accuracy ASC
  )
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', d.subject,
    'chapter', d.chapter,
    'topic', d.topic,
    'accuracy', d.accuracy,
    'attempts', d.attempts,
    'source', d.src,
    'mistake_count', (
      SELECT count(*)::int FROM public.student_mistakes m
      WHERE m.user_id = _uid AND NOT m.mastered
        AND m.subject = d.subject
        AND COALESCE(m.chapter, '') = COALESCE(d.chapter, '')
        AND (
          COALESCE(m.concept, m.topic, '') = COALESCE(d.topic, '')
          OR COALESCE(m.topic, '') = COALESCE(d.topic, '')
        )
    ),
    'rule_plan', public._rule_improvement_plan(
      d.subject, d.chapter, d.topic, d.accuracy, d.attempts,
      (SELECT count(*)::int FROM public.student_mistakes m
       WHERE m.user_id = _uid AND NOT m.mastered
         AND m.subject = d.subject
         AND COALESCE(m.chapter, '') = COALESCE(d.chapter, '')
         AND (
           COALESCE(m.concept, m.topic, '') = COALESCE(d.topic, '')
           OR COALESCE(m.topic, '') = COALESCE(d.topic, '')
         ))
    ),
    'ai_plan', (
      SELECT p.plan FROM public.student_improvement_plans p
      WHERE p.user_id = _uid AND p.source = 'ai'
        AND p.subject = d.subject
        AND COALESCE(p.chapter, '') = COALESCE(d.chapter, '')
        AND COALESCE(p.topic, '') = COALESCE(d.topic, '')
      LIMIT 1
    )
  ) ORDER BY d.accuracy ASC), '[]'::jsonb)
    INTO _plans
  FROM deduped d
  LIMIT 12;

  RETURN jsonb_build_object('plans', _plans);
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_student_performance_charts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  RETURN jsonb_build_object(
    'subjects', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', subject, 'accuracy', accuracy, 'attempts', attempts
      ) ORDER BY accuracy DESC), '[]'::jsonb)
      FROM public._weak_topics_for_user(_uid)
    ),
    'weekly_activity', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', activity_date,
        'total', dpp_count + homework_count + battle_count + self_practice_count,
        'dpp', dpp_count,
        'battles', battle_count,
        'self_practice', self_practice_count
      ) ORDER BY activity_date), '[]'::jsonb)
      FROM public.academic_daily_activity
      WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28
    ),
    'dpp_trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', date_trunc('day', submitted_at)::date,
        'score_pct', round(100.0 * score / NULLIF(max_score, 0), 1)
      ) ORDER BY date_trunc('day', submitted_at)), '[]'::jsonb)
      FROM public.dpp_attempts
      WHERE user_id = _uid AND status = 'submitted' AND submitted_at >= now() - interval '30 days'
    ),
    'practice_trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', date_trunc('day', finished_at)::date,
        'score_pct', round(100.0 * correct_count / NULLIF(question_count, 0), 1),
        'chapter', chapter
      ) ORDER BY date_trunc('day', finished_at)), '[]'::jsonb)
      FROM public.practice_sessions
      WHERE user_id = _uid AND finished_at IS NOT NULL
        AND finished_at >= now() - interval '30 days'
    )
  );
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _dpp_open int := 0; _dpp_done int := 0;
  _weak jsonb; _strong jsonb; _rev jsonb; _mistakes int; _heat jsonb;
  _recovery_pending int := 0; _mastery_summary jsonb; _practice_sessions int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _s FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _uid;

  IF _s.id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE hs.status IN ('submitted','graded')),
           count(*) FILTER (WHERE hs.status IS NULL OR hs.status = 'pending')
      INTO _hw_done, _hw_pending
    FROM public.homework h
    LEFT JOIN public.homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = _s.id
    WHERE h.class_id = _s.class_id;

    SELECT count(*) FILTER (WHERE att.status = 'submitted'),
           count(*) FILTER (WHERE att.status IS DISTINCT FROM 'submitted')
      INTO _dpp_done, _dpp_open
    FROM public.dpps d
    LEFT JOIN public.dpp_attempts att ON att.dpp_id = d.id AND att.user_id = _uid
    WHERE d.is_published AND d.class_id = _s.class_id;
  END IF;

  SELECT count(*)::int INTO _practice_sessions
  FROM public.practice_sessions WHERE user_id = _uid AND finished_at IS NOT NULL;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _weak FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy < 65 LIMIT 5;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy DESC), '[]'::jsonb)
    INTO _strong FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy >= 75 LIMIT 5;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date, 'dpp', dpp_count, 'homework', homework_count,
    'battles', battle_count, 'self_practice', self_practice_count, 'minutes', practice_minutes
  ) ORDER BY activity_date), '[]'::jsonb)
    INTO _heat FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28;

  SELECT count(*) INTO _mistakes FROM public.student_mistakes
    WHERE user_id = _uid AND NOT mastered;

  SELECT count(*)::int INTO _recovery_pending FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'topic', topic, 'chapter', chapter,
    'priority', priority, 'due_date', due_date, 'reason', reason
  ) ORDER BY priority DESC, due_date ASC), '[]'::jsonb)
    INTO _rev FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed LIMIT 10;

  RETURN jsonb_build_object(
    'student', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'full_name', _s.full_name, 'class_id', _s.class_id,
      'roll_number', _s.roll_number, 'admission_number', _s.admission_number
    ) END,
    'xp', CASE WHEN _xp IS NULL THEN NULL ELSE to_jsonb(_xp) END,
    'homework', jsonb_build_object('pending', _hw_pending, 'completed', _hw_done),
    'dpp', jsonb_build_object('open', _dpp_open, 'completed', _dpp_done),
    'self_practice', jsonb_build_object('sessions_completed', _practice_sessions),
    'weak_topics', _weak,
    'strong_topics', _strong,
    'revision_queue', _rev,
    'mistake_count', _mistakes,
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  );
END; $$;
