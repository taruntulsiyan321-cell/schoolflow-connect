-- Practice integrity: server-side grading for bank questions + close client forge paths.
-- Students could previously INSERT question_attempts / UPDATE practice_sessions.correct_count
-- with arbitrary is_correct, inflating mastery / academic profile.

ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS question_attempts_bank_qid
  ON public.question_attempts (bank_question_id)
  WHERE bank_question_id IS NOT NULL;

-- RLS: read own rows only. Writes go through SECURITY DEFINER RPCs (bypass RLS).
DROP POLICY IF EXISTS "practice sessions self" ON public.practice_sessions;
DROP POLICY IF EXISTS "practice sessions select self" ON public.practice_sessions;
CREATE POLICY "practice sessions select self" ON public.practice_sessions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "question attempts self" ON public.question_attempts;
DROP POLICY IF EXISTS "question attempts select self" ON public.question_attempts;
CREATE POLICY "question attempts select self" ON public.question_attempts
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- Grade selected_answer.index against question_bank when bank_question_id is present.
CREATE OR REPLACE FUNCTION public._practice_grade_from_bank(
  _bank_question_id uuid,
  _selected_answer jsonb,
  _client_correct_answer jsonb DEFAULT '{}'::jsonb
)
RETURNS TABLE (
  is_correct boolean,
  score numeric,
  correct_answer jsonb,
  subject text,
  chapter text,
  concept text,
  subconcept text,
  difficulty text,
  class_level int,
  explanation text,
  question_text text,
  options jsonb
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _qb public.question_bank%ROWTYPE;
  _sel_idx int;
  _ok boolean;
BEGIN
  IF _bank_question_id IS NULL THEN
    RETURN;
  END IF;

  SELECT * INTO _qb
  FROM public.question_bank
  WHERE id = _bank_question_id AND is_approved = true;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'bank_question_not_found';
  END IF;

  _sel_idx := COALESCE(
    NULLIF(_selected_answer->>'index', '')::int,
    NULLIF(_selected_answer->>'selected_index', '')::int,
    NULLIF(_selected_answer->>'correct_index', '')::int
  );

  _ok := (_sel_idx IS NOT NULL AND _sel_idx = _qb.correct_index);

  is_correct := _ok;
  score := CASE WHEN _ok THEN 1 ELSE 0 END;
  correct_answer := jsonb_build_object(
    'index', _qb.correct_index,
    'text', COALESCE((_qb.options ->> _qb.correct_index), '')
  );
  subject := _qb.subject;
  chapter := _qb.chapter;
  concept := COALESCE(_qb.concept, _qb.chapter, _qb.subject);
  subconcept := COALESCE(_qb.subconcept, _qb.concept, _qb.chapter);
  difficulty := COALESCE(_qb.difficulty, 'medium');
  class_level := COALESCE(_qb.class_level, 12);
  explanation := COALESCE(_qb.explanation, '');
  question_text := _qb.question;
  options := COALESCE(_qb.options, '[]'::jsonb);
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public._practice_grade_from_bank(uuid, jsonb, jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._practice_grade_from_bank(uuid, jsonb, jsonb) TO authenticated;

DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int);
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid);
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric, int, boolean);
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric);

CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _correct_answer jsonb,
  _generated_question jsonb,
  _is_correct boolean,
  _selected_answer jsonb,
  _session_id uuid,
  _score numeric DEFAULT 0,
  _skipped boolean DEFAULT false,
  _template_id uuid DEFAULT NULL,
  _time_taken_ms int DEFAULT NULL,
  _bank_question_id uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
  _resolved_correct boolean := false;
  _resolved_score numeric := 0;
  _resolved_correct_answer jsonb := COALESCE(_correct_answer, '{}'::jsonb);
  _grade record;
  _bank_id uuid := COALESCE(
    _bank_question_id,
    NULLIF(_generated_question->>'bank_question_id', '')::uuid,
    NULLIF(_generated_question->>'question_id', '')::uuid
  );
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT * INTO _ps
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = _uid;

  IF _ps IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  IF _bank_id IS NOT NULL THEN
    SELECT * INTO _grade
    FROM public._practice_grade_from_bank(_bank_id, COALESCE(_selected_answer, '{}'::jsonb), _correct_answer);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_question_not_found';
    END IF;
    _resolved_correct := _grade.is_correct;
    _resolved_score := _grade.score;
    _resolved_correct_answer := _grade.correct_answer;
    _subject := COALESCE(_grade.subject, _ps.subject, 'General');
    _chapter := COALESCE(_grade.chapter, _ps.chapter);
    _concept_f := COALESCE(_grade.concept, _chapter, _subject);
    _sub_f := COALESCE(_grade.subconcept, _concept_f);
    _class := COALESCE(_grade.class_level, 12);
    _difficulty := COALESCE(_grade.difficulty, 'medium');
    _explanation := COALESCE(_grade.explanation, '');
    -- Prefer bank stem if client omitted it
    IF COALESCE(_generated_question->>'question', '') = '' THEN
      _generated_question := jsonb_build_object(
        'question', _grade.question_text,
        'options', _grade.options,
        'explanation', _explanation,
        'bank_question_id', _bank_id
      );
    ELSE
      _generated_question := COALESCE(_generated_question, '{}'::jsonb)
        || jsonb_build_object('bank_question_id', _bank_id, 'explanation', COALESCE(_generated_question->>'explanation', _explanation));
    END IF;
  ELSE
    -- No bank id: do NOT trust client is_correct for mastery/score inflation.
    -- Persist the attempt as incorrect (honest empty credit) unless skipped.
    IF _template_id IS NOT NULL THEN
      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
    END IF;
    _subject := COALESCE(_tm.subject, _ps.subject, 'General');
    _chapter := COALESCE(_tm.chapter, _ps.chapter);
    _concept_f := COALESCE(_tm.concept, _tm.chapter, _ps.chapter, _ps.subject);
    _sub_f := COALESCE(_tm.subconcept, _concept_f);
    _class := COALESCE(_tm.class, 12);
    _difficulty := COALESCE(_tm.difficulty, _tm.template_data->>'difficulty', 'medium');
    _resolved_correct := false;
    _resolved_score := 0;
    _resolved_correct_answer := COALESCE(_correct_answer, '{}'::jsonb);
    -- Ignore client _is_correct / _score when unverifiable
  END IF;

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id, bank_question_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, concept, subconcept, difficulty
  ) VALUES (
    _session_id, _sid, _uid, _template_id, _bank_id,
    COALESCE(_generated_question, '{}'::jsonb),
    COALESCE(_selected_answer, '{}'::jsonb),
    _resolved_correct_answer,
    _resolved_score,
    _resolved_correct,
    _time_taken_ms,
    COALESCE(_skipped, false),
    _subject, _chapter, _concept_f, _sub_f, _difficulty
  ) RETURNING id INTO _aid;

  IF _resolved_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1,
          score = score + COALESCE(_resolved_score, 1)
      WHERE id = _session_id AND user_id = _uid;
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class, _subject, _chapter, _concept_f, _sub_f, true, false
    );
    PERFORM public.rpc_refresh_academic_brain();
  ELSIF NOT COALESCE(_skipped, false) THEN
    _explanation := COALESCE(
      NULLIF(_explanation, ''),
      NULLIF(_generated_question->>'explanation', ''),
      ''
    );
    IF _explanation = '' AND _template_id IS NOT NULL THEN
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
      _resolved_correct_answer,
      _explanation
    );
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class, _subject, _chapter, _concept_f, _sub_f, false, false
    );
  END IF;

  RETURN _aid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(
  jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid
) TO authenticated;

DROP FUNCTION IF EXISTS public.rpc_finish_practice_session(uuid);
DROP FUNCTION IF EXISTS public.rpc_finish_practice_session(uuid, jsonb);

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(
  _session_id uuid,
  _attempts jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s record;
  _mins int;
  _att jsonb;
  _existing int;
  _bank_id uuid;
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
      _bank_id := COALESCE(
        NULLIF(_att->>'bank_question_id', '')::uuid,
        NULLIF(_att->'generated_question'->>'bank_question_id', '')::uuid
      );
      PERFORM public.rpc_record_question_attempt(
        COALESCE(_att->'correct_answer', '{}'::jsonb),
        COALESCE(_att->'generated_question', '{}'::jsonb),
        COALESCE((_att->>'is_correct')::boolean, false),
        COALESCE(_att->'selected_answer', '{}'::jsonb),
        _session_id,
        COALESCE((_att->>'score')::numeric, 0),
        COALESCE((_att->>'skipped')::boolean, false),
        NULLIF(_att->>'template_id', '')::uuid,
        NULLIF(_att->>'time_taken_ms', '')::int,
        _bank_id
      );
    END LOOP;
  END IF;

  -- Always recompute score from persisted attempts (never trust client totals).
  UPDATE public.practice_sessions ps
  SET
    correct_count = sub.c,
    score = sub.c,
    finished_at = COALESCE(ps.finished_at, now())
  FROM (
    SELECT count(*) FILTER (WHERE is_correct)::int AS c
    FROM public.question_attempts
    WHERE session_id = _session_id AND user_id = auth.uid()
  ) sub
  WHERE ps.id = _session_id AND ps.user_id = auth.uid()
  RETURNING ps.* INTO _s;

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
    'score', _s.score,
    'server_graded', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid, jsonb) TO authenticated;
