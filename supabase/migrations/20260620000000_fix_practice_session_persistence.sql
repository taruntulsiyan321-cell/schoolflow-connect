-- Fix AI practice sessions: attempts without templates + concept recovery report

ALTER TABLE public.question_attempts
  DROP CONSTRAINT IF EXISTS question_attempts_template_id_fkey;

ALTER TABLE public.question_attempts
  ALTER COLUMN template_id DROP NOT NULL;

ALTER TABLE public.question_attempts
  ADD CONSTRAINT question_attempts_template_id_fkey
  FOREIGN KEY (template_id) REFERENCES public.question_templates(id) ON DELETE SET NULL;

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
  _uid uuid := auth.uid();
  _sid uuid;
  _aid uuid;
  _ps record;
  _tm record;
  _subject text;
  _chapter text;
  _class int := 12;
  _concept_f text;
  _sub_f text;
  _difficulty text := 'medium';
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT * INTO _ps
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = _uid;

  IF _ps IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  IF _template_id IS NOT NULL THEN
    SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
  END IF;

  _subject := COALESCE(_tm.subject, _ps.subject, 'General');
  _chapter := COALESCE(_tm.chapter, _ps.chapter);
  _concept_f := COALESCE(_tm.concept, _tm.chapter, _ps.chapter, _ps.subject);
  _sub_f := COALESCE(_tm.subconcept, _concept_f);
  _class := COALESCE(_tm.class, 12);
  _difficulty := COALESCE(_tm.difficulty, _tm.template_data->>'difficulty', 'medium');

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, concept, subconcept, difficulty
  ) VALUES (
    _session_id, _sid, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct,
    _time_taken_ms, _skipped,
    _subject, _chapter, _concept_f, _sub_f, _difficulty
  ) RETURNING id INTO _aid;

  IF COALESCE(_is_correct, false) THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1,
          score = score + COALESCE(_score, 1)
      WHERE id = _session_id AND user_id = _uid;
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class, _subject, _chapter, _concept_f, _sub_f, true, false
    );
    PERFORM public.rpc_refresh_academic_brain();
  ELSIF NOT COALESCE(_skipped, false) THEN
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _aid,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>'question', ''),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _correct_answer,
      COALESCE(_generated_question->>'explanation', _tm.explanation_template)
    );
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class, _subject, _chapter, _concept_f, _sub_f, false, false
    );
  END IF;

  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(
  uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric, int, boolean
) TO authenticated;

-- Practice recovery report: use attempt tags, not only question_templates join
CREATE OR REPLACE FUNCTION public._build_concept_recovery_report(
  _source_type text,
  _source_id uuid,
  _uid uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total int := 0;
  _correct int := 0;
  _time_sec int := 0;
  _weak jsonb := '[]'::jsonb;
  _strong jsonb := '[]'::jsonb;
  _row record;
BEGIN
  IF _source_type = 'dpp_attempt' THEN
    SELECT att.correct_count, att.total_count, att.time_spent_sec
      INTO _correct, _total, _time_sec
    FROM public.dpp_attempts att WHERE att.id = _source_id AND att.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(dq.subject, d.subject, 'General') AS subject,
        COALESCE(dq.chapter, d.chapter) AS chapter,
        COALESCE(dq.concept, dq.subconcept, d.topic, d.chapter, d.subject) AS concept,
        dq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE da.is_correct)::int AS correct
      FROM public.dpp_answers da
      JOIN public.dpp_questions dq ON dq.id = da.question_id
      JOIN public.dpp_attempts att ON att.id = da.attempt_id
      JOIN public.dpps d ON d.id = att.dpp_id
      WHERE att.id = _source_id AND att.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'subconcept', _row.subconcept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1),
          'attempts', _row.attempts, 'correct', _row.correct
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'battle_participant' THEN
    SELECT bp.correct_count, bp.answered_count,
           GREATEST(EXTRACT(EPOCH FROM (bp.finished_at - bp.joined_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.battle_participants bp WHERE bp.id = _source_id AND bp.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(b.subject, 'General') AS subject,
        b.chapter,
        b.class_level,
        COALESCE(bq.concept, b.topic, b.chapter, b.subject) AS concept,
        bq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE ba.is_correct)::int AS correct
      FROM public.battle_answers ba
      JOIN public.battle_questions bq ON bq.id = ba.question_id
      JOIN public.battle_participants bp ON bp.id = ba.participant_id
      JOIN public.battles b ON b.id = bp.battle_id
      WHERE bp.id = _source_id AND bp.user_id = _uid
      GROUP BY 1, 2, 3, 4, 5
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'practice_session' THEN
    SELECT ps.correct_count, ps.question_count,
           GREATEST(EXTRACT(EPOCH FROM (COALESCE(ps.finished_at, now()) - ps.created_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.practice_sessions ps WHERE ps.id = _source_id AND ps.user_id = _uid;

    SELECT count(*)::int, count(*) FILTER (WHERE qa.is_correct)::int
      INTO _total, _correct
    FROM public.question_attempts qa
    WHERE qa.session_id = _source_id AND qa.user_id = _uid;

    IF _total > 0 THEN
      SELECT ps.correct_count INTO _correct
      FROM public.practice_sessions ps
      WHERE ps.id = _source_id AND ps.user_id = _uid;
      IF _correct IS NULL OR _correct = 0 THEN
        SELECT count(*) FILTER (WHERE qa.is_correct)::int INTO _correct
        FROM public.question_attempts qa
        WHERE qa.session_id = _source_id AND qa.user_id = _uid;
      END IF;
    END IF;

    FOR _row IN
      SELECT
        COALESCE(qa.subject, ps.subject) AS subject,
        COALESCE(qa.chapter, ps.chapter) AS chapter,
        COALESCE(qa.concept, qa.chapter, ps.chapter, ps.subject) AS concept,
        qa.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE qa.is_correct)::int AS correct
      FROM public.question_attempts qa
      JOIN public.practice_sessions ps ON ps.id = qa.session_id
      WHERE ps.id = _source_id AND ps.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown source_type: %', _source_type;
  END IF;

  RETURN jsonb_build_object(
    'source_type', _source_type,
    'source_id', _source_id,
    'accuracy_pct', CASE WHEN _total > 0 THEN round(100.0 * _correct / _total, 1) ELSE 0 END,
    'correct_count', _correct,
    'total_count', _total,
    'time_sec', _time_sec,
    'time_minutes', round(COALESCE(_time_sec, 0) / 60.0, 1),
    'weak_concepts', _weak,
    'strong_concepts', _strong,
    'improvement_areas', (
      SELECT COALESCE(jsonb_agg(w->>'concept'), '[]'::jsonb)
      FROM jsonb_array_elements(_weak) w
    )
  );
END; $$;
