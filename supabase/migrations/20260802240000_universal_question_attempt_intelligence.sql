-- Universal question-attempt intelligence:
-- 1) Persist hint_used + source on practice attempts
-- 2) Finish session inserts any missing attempts (partial live writes safe)
-- 3) Battle finish mirrors ALL answers (correct/wrong/skip) into question_attempts
--    and treats selected_index < 0 as skipped (not a mistake)

-- Ensure intelligence columns exist
ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS hint_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS solution_viewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS attempt_number int,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_question_id uuid;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'question_attempts_bank_question_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.question_attempts
        ADD CONSTRAINT question_attempts_bank_question_id_fkey
        FOREIGN KEY (bank_question_id) REFERENCES public.question_bank(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN
      NULL; -- column may already reference bank, or bank table absent in some envs
    END;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS question_attempts_user_skipped
  ON public.question_attempts (user_id, created_at DESC)
  WHERE skipped = true;

CREATE INDEX IF NOT EXISTS question_attempts_user_wrong
  ON public.question_attempts (user_id, created_at DESC)
  WHERE is_correct = false AND skipped = false;

CREATE INDEX IF NOT EXISTS question_attempts_source
  ON public.question_attempts (source)
  WHERE source IS NOT NULL;

-- ── Practice attempt recorder (hint_used + source) ───────────────────────────
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int);
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid);
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid, boolean, text);

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
  _bank_question_id uuid DEFAULT NULL,
  _hint_used boolean DEFAULT false,
  _source text DEFAULT 'practice'
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
  _src text := COALESCE(NULLIF(trim(_source), ''), 'practice');
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT * INTO _ps
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = _uid;

  IF _ps IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  -- Idempotent: same bank question already recorded in this session
  IF _bank_id IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id = _bank_id
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      RETURN _aid;
    END IF;
  END IF;

  IF _bank_id IS NOT NULL THEN
    SELECT * INTO _grade
    FROM public._practice_grade_from_bank(_bank_id, COALESCE(_selected_answer, '{}'::jsonb), _correct_answer);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_question_not_found';
    END IF;
    -- Skips are never graded correct
    IF COALESCE(_skipped, false) THEN
      _resolved_correct := false;
      _resolved_score := 0;
    ELSE
      _resolved_correct := _grade.is_correct;
      _resolved_score := _grade.score;
    END IF;
    _resolved_correct_answer := _grade.correct_answer;
    _subject := COALESCE(_grade.subject, _ps.subject, 'General');
    _chapter := COALESCE(_grade.chapter, _ps.chapter);
    _concept_f := COALESCE(_grade.concept, _chapter, _subject);
    _sub_f := COALESCE(_grade.subconcept, _concept_f);
    _class := COALESCE(_grade.class_level, 12);
    _difficulty := COALESCE(_grade.difficulty, 'medium');
    _explanation := COALESCE(_grade.explanation, '');
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
    IF _template_id IS NOT NULL THEN
      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
    END IF;
    _subject := COALESCE(
      NULLIF(_generated_question->>'subject', ''),
      _tm.subject, _ps.subject, 'General'
    );
    _chapter := COALESCE(
      NULLIF(_generated_question->>'chapter', ''),
      _tm.chapter, _ps.chapter
    );
    _concept_f := COALESCE(
      NULLIF(_generated_question->>'concept', ''),
      _tm.concept, _tm.chapter, _ps.chapter, _ps.subject
    );
    _sub_f := COALESCE(_tm.subconcept, _concept_f);
    _class := COALESCE(_tm.class, 12);
    _difficulty := COALESCE(_tm.difficulty, _tm.template_data->>'difficulty', 'medium');
    _resolved_correct := false;
    _resolved_score := 0;
    _resolved_correct_answer := COALESCE(_correct_answer, '{}'::jsonb);
  END IF;

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id, bank_question_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, concept, subconcept, difficulty,
    hint_used, source
  ) VALUES (
    _session_id, _sid, _uid, _template_id, _bank_id,
    COALESCE(_generated_question, '{}'::jsonb),
    COALESCE(_selected_answer, '{}'::jsonb),
    _resolved_correct_answer,
    _resolved_score,
    _resolved_correct,
    _time_taken_ms,
    COALESCE(_skipped, false),
    _subject, _chapter, _concept_f, _sub_f, _difficulty,
    COALESCE(_hint_used, false),
    _src
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
  jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid, boolean, text
) TO authenticated;

-- NOTE: No 10-arg wrapper — PostgREST cannot disambiguate overlapping overloads.
-- Canonical signature later gains _meta via 20260802250000 / 20260802630000.

-- ── Finish session (unchanged callers still work with named/positional defaults)

-- Finish: insert missing attempts even when some already exist (idempotent recorder)
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
  _bank_id uuid;
BEGIN
  SELECT * INTO _s
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = auth.uid();

  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  IF _attempts IS NOT NULL
     AND jsonb_typeof(_attempts) = 'array'
     AND jsonb_array_length(_attempts) > 0 THEN
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
        _bank_id,
        COALESCE((_att->>'hint_used')::boolean, false),
        COALESCE(NULLIF(_att->>'source', ''), 'practice')
      );
    END LOOP;
  END IF;

  UPDATE public.practice_sessions ps
  SET
    correct_count = sub.c,
    score = sub.c,
    finished_at = COALESCE(ps.finished_at, now())
  FROM (
    SELECT count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))::int AS c
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

-- ── Battle → Practice Intelligence mirror ────────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_battle_mistakes(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bp record;
  _ba record;
  _concept text;
  _subconcept text;
  _skipped boolean;
  _bank_id uuid;
  _aid uuid;
  _existing uuid;
  _class int;
BEGIN
  SELECT bp.*, b.subject, b.chapter, b.topic, b.class_level, b.id AS battle_uuid
    INTO _bp
  FROM public.battle_participants bp
  JOIN public.battles b ON b.id = bp.battle_id
  WHERE bp.id = _participant_id;
  IF _bp IS NULL THEN RETURN; END IF;

  _class := COALESCE(_bp.class_level, 12);

  FOR _ba IN
    SELECT ba.*, bq.question, bq.options, bq.correct_index, bq.bank_question_id,
           bq.concept, bq.subconcept
    FROM public.battle_answers ba
    JOIN public.battle_questions bq ON bq.id = ba.question_id
    WHERE ba.participant_id = _participant_id
  LOOP
    _concept := COALESCE(_ba.concept, _bp.topic, _bp.chapter, _bp.subject);
    _subconcept := COALESCE(_ba.subconcept, _ba.concept, _bp.topic);
    -- Timeout / no selection → skipped for Skipped mode (not Mistake Book)
    _skipped := COALESCE(_ba.selected_index, -1) < 0;
    _bank_id := _ba.bank_question_id;

    -- Mirror into question_attempts (Practice Intelligence / Incorrect / Skipped)
    SELECT id INTO _existing
    FROM public.question_attempts
    WHERE user_id = _bp.user_id
      AND source = 'battle'
      AND (
        (_bank_id IS NOT NULL AND bank_question_id = _bank_id)
        OR (
          _bank_id IS NULL
          AND generated_question->>'battle_question_id' = _ba.question_id::text
        )
      )
    LIMIT 1;

    IF _existing IS NULL THEN
      INSERT INTO public.question_attempts (
        session_id, student_id, user_id, template_id, bank_question_id,
        generated_question, selected_answer, correct_answer, score, is_correct,
        time_taken_ms, skipped, subject, chapter, concept, subconcept, difficulty,
        hint_used, source
      ) VALUES (
        NULL,
        _bp.student_id,
        _bp.user_id,
        NULL,
        _bank_id,
        jsonb_build_object(
          'question', _ba.question,
          'options', COALESCE(_ba.options, '[]'::jsonb),
          'explanation', '',
          'bank_question_id', _bank_id,
          'battle_question_id', _ba.question_id,
          'battle_id', _bp.battle_uuid,
          'subject', COALESCE(_bp.subject, 'General'),
          'chapter', _bp.chapter,
          'concept', _concept
        ),
        jsonb_build_object('index', _ba.selected_index, 'selected_index', _ba.selected_index),
        jsonb_build_object('index', _ba.correct_index, 'correct_index', _ba.correct_index),
        CASE WHEN _ba.is_correct AND NOT _skipped THEN 1 ELSE 0 END,
        CASE WHEN _skipped THEN false ELSE COALESCE(_ba.is_correct, false) END,
        _ba.time_ms,
        _skipped,
        COALESCE(_bp.subject, 'General'),
        _bp.chapter,
        _concept,
        _subconcept,
        'medium',
        false,
        'battle'
      )
      RETURNING id INTO _aid;
    ELSE
      _aid := _existing;
    END IF;

    IF _skipped THEN
      CONTINUE;
    END IF;

    IF _ba.is_correct THEN
      PERFORM public._upsert_concept_mastery(
        _bp.user_id, _bp.student_id, _class,
        COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, true, false
      );
      CONTINUE;
    END IF;

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _bp.user_id, _bp.student_id, 'battleground', _bp.battle_id,
      COALESCE(_bank_id, _ba.question_id),
      _class, COALESCE(_bp.subject, 'General'), _bp.chapter, _bp.topic,
      _concept, _subconcept, 'battle',
      _ba.question, _ba.options,
      jsonb_build_object('selected_index', _ba.selected_index),
      jsonb_build_object('correct_index', _ba.correct_index),
      NULL, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(
      _bp.user_id, _bp.student_id, _class,
      COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, false, false
    );
  END LOOP;

  -- Nudge profile mastery / weak topics after battle intelligence write
  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$$;
