-- Save all practice answers in one shot when session finishes (reliable for AI practice)

DROP FUNCTION IF EXISTS public.rpc_finish_practice_session(uuid);

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(
  _session_id uuid,
  _attempts jsonb DEFAULT NULL
)RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _s record;
  _mins int;
  _att jsonb;
  _existing int;
BEGIN
  SELECT * INTO _s
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = auth.uid();

  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  SELECT count(*)::int INTO _existing
  FROM public.question_attempts
  WHERE session_id = _session_id AND user_id = auth.uid();

  IF _attempts IS NOT NULL
     AND jsonb_typeof(_attempts) = 'array'
     AND jsonb_array_length(_attempts) > 0
     AND _existing = 0 THEN
    FOR _att IN SELECT value FROM jsonb_array_elements(_attempts) AS value
    LOOP
      PERFORM public.rpc_record_question_attempt(
        _session_id,
        NULLIF(_att->>'template_id', '')::uuid,
        COALESCE(_att->'generated_question', '{}'::jsonb),
        COALESCE(_att->'selected_answer', '{}'::jsonb),
        COALESCE(_att->'correct_answer', '{}'::jsonb),
        COALESCE((_att->>'is_correct')::boolean, false),
        COALESCE((_att->>'score')::numeric, CASE WHEN COALESCE((_att->>'is_correct')::boolean, false) THEN 1 ELSE 0 END)
      );
    END LOOP;

    UPDATE public.practice_sessions ps
    SET
      correct_count = sub.c,
      score = sub.c
    FROM (
      SELECT count(*) FILTER (WHERE is_correct)::int AS c
      FROM public.question_attempts
      WHERE session_id = _session_id AND user_id = auth.uid()
    ) sub
    WHERE ps.id = _session_id AND ps.user_id = auth.uid();
  END IF;

  UPDATE public.practice_sessions SET finished_at = now()
    WHERE id = _session_id AND user_id = auth.uid()
    RETURNING * INTO _s;

  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
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

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid, jsonb) TO authenticated;

-- Patch attempt recorder (safe when template_id is null)
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
  _explanation text;
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
    _explanation := NULLIF(_generated_question->>'explanation', '');
    IF _explanation IS NULL AND _template_id IS NOT NULL THEN
      SELECT explanation_template INTO _explanation
      FROM public.question_templates WHERE id = _template_id LIMIT 1;
    END IF;
    _explanation := COALESCE(_explanation, '');
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _aid,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>'question', ''),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _correct_answer,
      _explanation
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
