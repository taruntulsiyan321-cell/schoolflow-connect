-- Support concept recovery reports for completed recovery assignments.

CREATE OR REPLACE FUNCTION public._build_concept_recovery_report(
  _source_type text,
  _source_id uuid,
  _uid uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total int := 0; _correct int := 0; _time_sec int := 0;
  _weak jsonb := '[]'::jsonb; _strong jsonb := '[]'::jsonb; _row record;
  _acc numeric;
  _a record;
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
        COALESCE(bq.concept, b.topic, b.chapter, b.subject) AS concept,
        bq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE ba.is_correct)::int AS correct
      FROM public.battle_answers ba
      JOIN public.battle_questions bq ON bq.id = ba.question_id
      JOIN public.battle_participants bp ON bp.id = ba.participant_id
      JOIN public.battles b ON b.id = bp.battle_id
      WHERE bp.id = _source_id AND bp.user_id = _uid
      GROUP BY 1, 2, 3, 4
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

  ELSIF _source_type = 'recovery_assignment' THEN
    SELECT * INTO _a
    FROM public.recovery_assignments
    WHERE id = _source_id AND user_id = _uid;

    IF _a IS NOT NULL THEN
      _correct := COALESCE(_a.questions_correct, 0);
      _total := COALESCE(_a.question_count, 0);
      _time_sec := GREATEST(
        EXTRACT(EPOCH FROM (COALESCE(_a.completed_at, now()) - _a.created_at))::int,
        0
      );

      IF _total > 0 THEN
        _acc := round(100.0 * _correct / _total, 1);
        IF _acc < 70 THEN
          _weak := jsonb_build_array(jsonb_build_object(
            'subject', _a.subject,
            'chapter', _a.chapter,
            'concept', _a.concept,
            'subconcept', _a.subconcept,
            'accuracy', _acc,
            'attempts', _total,
            'correct', _correct
          ));
        ELSIF _acc >= 80 THEN
          _strong := jsonb_build_array(jsonb_build_object(
            'subject', _a.subject,
            'chapter', _a.chapter,
            'concept', _a.concept,
            'accuracy', _acc
          ));
        END IF;
      END IF;
    END IF;

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
