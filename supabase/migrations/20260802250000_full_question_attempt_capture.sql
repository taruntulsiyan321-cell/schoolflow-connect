-- Full question-attempt capture (Practice Intelligence / Academic Engine)
-- Persist every useful field from practice, battle, recovery, and DPP surfaces.
-- Safe to re-run. Paste into Supabase SQL editor if applying manually.

-- ── 1) question_attempts — identity / context / outcome columns ──────────────
ALTER TABLE public.question_attempts
  ADD COLUMN IF NOT EXISTS school_id uuid,
  ADD COLUMN IF NOT EXISTS source_id uuid,
  ADD COLUMN IF NOT EXISTS practice_mode text,
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS board text,
  ADD COLUMN IF NOT EXISTS stream text,
  ADD COLUMN IF NOT EXISTS topic text,
  ADD COLUMN IF NOT EXISTS timed_out boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS answered_at timestamptz,
  ADD COLUMN IF NOT EXISTS hint_used boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS solution_viewed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS confidence numeric,
  ADD COLUMN IF NOT EXISTS attempt_number int,
  ADD COLUMN IF NOT EXISTS source text,
  ADD COLUMN IF NOT EXISTS skipped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS bank_question_id uuid,
  ADD COLUMN IF NOT EXISTS time_taken_ms int,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS chapter text,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text,
  ADD COLUMN IF NOT EXISTS difficulty text;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_attempts_school_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.question_attempts
        ADD CONSTRAINT question_attempts_school_id_fkey
        FOREIGN KEY (school_id) REFERENCES public.schools(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'question_attempts_bank_question_id_fkey'
  ) THEN
    BEGIN
      ALTER TABLE public.question_attempts
        ADD CONSTRAINT question_attempts_bank_question_id_fkey
        FOREIGN KEY (bank_question_id) REFERENCES public.question_bank(id) ON DELETE SET NULL;
    EXCEPTION WHEN others THEN NULL;
    END;
  END IF;
END $$;

UPDATE public.question_attempts
SET answered_at = COALESCE(answered_at, created_at)
WHERE answered_at IS NULL;

CREATE INDEX IF NOT EXISTS question_attempts_user_source_id
  ON public.question_attempts (user_id, source, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS question_attempts_user_mode
  ON public.question_attempts (user_id, practice_mode)
  WHERE practice_mode IS NOT NULL;

CREATE INDEX IF NOT EXISTS question_attempts_user_timed_out
  ON public.question_attempts (user_id, created_at DESC)
  WHERE timed_out = true;

CREATE INDEX IF NOT EXISTS question_attempts_user_skipped
  ON public.question_attempts (user_id, created_at DESC)
  WHERE skipped = true;

CREATE INDEX IF NOT EXISTS question_attempts_user_wrong
  ON public.question_attempts (user_id, created_at DESC)
  WHERE is_correct = false AND skipped = false;

-- ── 2) practice_sessions — session aggregates / curriculum scope ─────────────
ALTER TABLE public.practice_sessions
  ADD COLUMN IF NOT EXISTS practice_mode text,
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS board text,
  ADD COLUMN IF NOT EXISTS stream text,
  ADD COLUMN IF NOT EXISTS skipped_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS wrong_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_time_ms int,
  ADD COLUMN IF NOT EXISTS accuracy numeric,
  ADD COLUMN IF NOT EXISTS school_id uuid;

-- ── 3) Start session — optional mode + school/scope ──────────────────────────
DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int);
DROP FUNCTION IF EXISTS public.rpc_start_practice_session(text, text, int, text);

CREATE OR REPLACE FUNCTION public.rpc_start_practice_session(
  _subject text,
  _chapter text,
  _count int DEFAULT 10,
  _practice_mode text DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _student uuid;
  _school uuid;
  _class int;
  _board text;
  _stream text;
  _label text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.school_id INTO _student, _school
  FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  IF _school IS NULL THEN
    SELECT school_id INTO _school FROM public.profiles WHERE id = _uid;
  END IF;

  IF _school IS NOT NULL THEN
    BEGIN
      SELECT lower(COALESCE(board, 'rbse')), stream
        INTO _board, _stream
      FROM public.schools WHERE id = _school;
    EXCEPTION WHEN others THEN
      SELECT lower(COALESCE(board, 'rbse')) INTO _board
      FROM public.schools WHERE id = _school;
      _stream := NULL;
    END;
  END IF;

  SELECT COALESCE(c.display_name, c.name) INTO _label
  FROM public.students st
  JOIN public.classes c ON c.id = st.class_id
  WHERE st.user_id = _uid
  LIMIT 1;

  IF _label IS NOT NULL THEN
    _class := NULLIF(substring(_label from '([0-9]{1,2})'), '')::int;
  END IF;

  INSERT INTO public.practice_sessions (
    student_id, user_id, school_id, subject, chapter, question_count,
    practice_mode, class_level, board, stream
  ) VALUES (
    _student, _uid, _school, _subject, _chapter, _count,
    NULLIF(trim(_practice_mode), ''), _class, _board, _stream
  )
  RETURNING id INTO _sid;
  RETURN _sid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_start_practice_session(text, text, int, text) TO authenticated;

-- ── 4) Record attempt — full intelligence via optional _meta jsonb ───────────
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid, boolean, text, jsonb);
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid, boolean, text);
DROP FUNCTION IF EXISTS public.rpc_record_question_attempt(jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid);

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
  _source text DEFAULT 'practice',
  _meta jsonb DEFAULT '{}'::jsonb
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
  _topic text;
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
  _m jsonb := COALESCE(_meta, '{}'::jsonb);
  _school uuid;
  _board text;
  _stream text;
  _practice_mode text;
  _source_id uuid;
  _solution_viewed boolean := COALESCE((_m->>'solution_viewed')::boolean, false);
  _confidence numeric := NULLIF(_m->>'confidence', '')::numeric;
  _attempt_number int := NULLIF(_m->>'attempt_number', '')::int;
  _timed_out boolean := COALESCE((_m->>'timed_out')::boolean, false);
  _answered_at timestamptz := COALESCE(NULLIF(_m->>'answered_at', '')::timestamptz, now());
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT id, school_id INTO _sid, _school
  FROM public.students WHERE user_id = _uid LIMIT 1;

  SELECT * INTO _ps
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = _uid;

  IF _ps IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  _school := COALESCE(
    NULLIF(_m->>'school_id', '')::uuid,
    _ps.school_id,
    _school
  );
  _board := COALESCE(NULLIF(_m->>'board', ''), _ps.board);
  _stream := COALESCE(NULLIF(_m->>'stream', ''), _ps.stream);
  _practice_mode := COALESCE(
    NULLIF(_m->>'practice_mode', ''),
    _ps.practice_mode,
    NULLIF(_generated_question->>'practice_mode', '')
  );
  _source_id := COALESCE(
    NULLIF(_m->>'source_id', '')::uuid,
    _session_id
  );
  _topic := COALESCE(
    NULLIF(_m->>'topic', ''),
    NULLIF(_generated_question->>'topic', '')
  );
  IF _m ? 'hint_used' THEN
    _hint_used := COALESCE((_m->>'hint_used')::boolean, _hint_used);
  END IF;

  -- Idempotent: same bank question already recorded in this session
  IF _bank_id IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id = _bank_id
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      -- Enrich late fields (hint/solution/time) without double-counting mastery
      UPDATE public.question_attempts SET
        hint_used = hint_used OR COALESCE(_hint_used, false),
        solution_viewed = solution_viewed OR _solution_viewed,
        timed_out = timed_out OR _timed_out,
        time_taken_ms = COALESCE(time_taken_ms, _time_taken_ms),
        confidence = COALESCE(confidence, _confidence),
        attempt_number = COALESCE(attempt_number, _attempt_number),
        practice_mode = COALESCE(practice_mode, _practice_mode),
        topic = COALESCE(topic, _topic),
        board = COALESCE(board, _board),
        stream = COALESCE(stream, _stream),
        class_level = COALESCE(class_level, NULLIF(_m->>'class_level', '')::int, _ps.class_level),
        school_id = COALESCE(school_id, _school),
        source_id = COALESCE(source_id, _source_id),
        answered_at = COALESCE(answered_at, _answered_at)
      WHERE id = _aid;
      RETURN _aid;
    END IF;
  END IF;

  IF _bank_id IS NOT NULL THEN
    SELECT * INTO _grade
    FROM public._practice_grade_from_bank(_bank_id, COALESCE(_selected_answer, '{}'::jsonb), _correct_answer);
    IF NOT FOUND THEN
      RAISE EXCEPTION 'bank_question_not_found';
    END IF;
    IF COALESCE(_skipped, false) OR _timed_out THEN
      _resolved_correct := false;
      _resolved_score := 0;
    ELSE
      _resolved_correct := _grade.is_correct;
      _resolved_score := _grade.score;
    END IF;
    _resolved_correct_answer := _grade.correct_answer;
    _subject := COALESCE(_grade.subject, _ps.subject, 'General');
    _chapter := COALESCE(_grade.chapter, _ps.chapter);
    _topic := COALESCE(_topic, _grade.concept, _chapter);
    _concept_f := COALESCE(_grade.concept, _chapter, _subject);
    _sub_f := COALESCE(_grade.subconcept, _concept_f);
    _class := COALESCE(
      NULLIF(_m->>'class_level', '')::int,
      _grade.class_level,
      _ps.class_level,
      12
    );
    _difficulty := COALESCE(NULLIF(_m->>'difficulty', ''), _grade.difficulty, 'medium');
    _explanation := COALESCE(_grade.explanation, '');
    IF COALESCE(_generated_question->>'question', '') = '' THEN
      _generated_question := jsonb_build_object(
        'question', _grade.question_text,
        'options', _grade.options,
        'explanation', _explanation,
        'bank_question_id', _bank_id,
        'subject', _subject,
        'chapter', _chapter,
        'topic', _topic,
        'concept', _concept_f,
        'difficulty', _difficulty,
        'practice_mode', _practice_mode
      );
    ELSE
      _generated_question := COALESCE(_generated_question, '{}'::jsonb)
        || jsonb_build_object(
          'bank_question_id', _bank_id,
          'explanation', COALESCE(_generated_question->>'explanation', _explanation),
          'subject', COALESCE(_generated_question->>'subject', _subject),
          'chapter', COALESCE(_generated_question->>'chapter', _chapter),
          'topic', COALESCE(_generated_question->>'topic', _topic),
          'concept', COALESCE(_generated_question->>'concept', _concept_f),
          'practice_mode', COALESCE(_generated_question->>'practice_mode', _practice_mode)
        );
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
    _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _tm.chapter, _chapter);
    _concept_f := COALESCE(
      NULLIF(_generated_question->>'concept', ''),
      _tm.concept, _tm.chapter, _ps.chapter, _ps.subject
    );
    _sub_f := COALESCE(_tm.subconcept, _concept_f);
    _class := COALESCE(
      NULLIF(_m->>'class_level', '')::int,
      _tm.class, _ps.class_level, 12
    );
    _difficulty := COALESCE(
      NULLIF(_m->>'difficulty', ''),
      _tm.difficulty, _tm.template_data->>'difficulty', 'medium'
    );
    _resolved_correct := CASE
      WHEN COALESCE(_skipped, false) OR _timed_out THEN false
      ELSE COALESCE(_is_correct, false)
    END;
    _resolved_score := CASE WHEN _resolved_correct THEN COALESCE(_score, 1) ELSE 0 END;
    _resolved_correct_answer := COALESCE(_correct_answer, '{}'::jsonb);
  END IF;

  -- Force skip semantics
  IF COALESCE(_skipped, false) OR _timed_out THEN
    _resolved_correct := false;
    _resolved_score := 0;
    _skipped := true;
  END IF;

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, school_id, template_id, bank_question_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, topic, concept, subconcept, difficulty,
    hint_used, solution_viewed, confidence, attempt_number, source, source_id,
    practice_mode, class_level, board, stream, timed_out, answered_at
  ) VALUES (
    _session_id, _sid, _uid, _school, _template_id, _bank_id,
    COALESCE(_generated_question, '{}'::jsonb),
    COALESCE(_selected_answer, '{}'::jsonb),
    _resolved_correct_answer,
    _resolved_score,
    _resolved_correct,
    _time_taken_ms,
    COALESCE(_skipped, false),
    _subject, _chapter, _topic, _concept_f, _sub_f, _difficulty,
    COALESCE(_hint_used, false),
    _solution_viewed,
    _confidence,
    _attempt_number,
    _src,
    _source_id,
    _practice_mode,
    _class,
    _board,
    _stream,
    _timed_out,
    _answered_at
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
  jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid, boolean, text, jsonb
) TO authenticated;

-- NOTE: Do NOT add 10/12-arg wrapper overloads. PostgREST cannot disambiguate
-- named-arg calls across overlapping optional signatures. See
-- 20260802630000_unify_rpc_record_question_attempt.sql and
-- docs/APPLY_RPC_RECORD_QUESTION_ATTEMPT_UNIFY.sql.

-- ── 5) Finish — batch missing attempts + session aggregates ──────────────────
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
  _total int;
  _correct int;
  _skipped int;
  _wrong int;
  _time_ms int;
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
        COALESCE(NULLIF(_att->>'source', ''), 'practice'),
        COALESCE(_att->'meta', '{}'::jsonb)
          || jsonb_build_object(
            'solution_viewed', COALESCE((_att->>'solution_viewed')::boolean, false),
            'confidence', _att->'confidence',
            'attempt_number', _att->'attempt_number',
            'timed_out', COALESCE((_att->>'timed_out')::boolean, false),
            'practice_mode', COALESCE(_att->>'practice_mode', _s.practice_mode),
            'source_id', COALESCE(_att->>'source_id', _session_id::text),
            'class_level', COALESCE(_att->>'class_level', _s.class_level::text),
            'board', COALESCE(_att->>'board', _s.board),
            'stream', COALESCE(_att->>'stream', _s.stream),
            'topic', _att->>'topic',
            'difficulty', _att->>'difficulty',
            'school_id', COALESCE(_att->>'school_id', _s.school_id::text),
            'answered_at', _att->>'answered_at'
          )
      );
    END LOOP;
  END IF;

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))::int,
    count(*) FILTER (WHERE COALESCE(skipped, false))::int,
    count(*) FILTER (WHERE NOT is_correct AND NOT COALESCE(skipped, false))::int,
    COALESCE(sum(time_taken_ms), 0)::int
  INTO _total, _correct, _skipped, _wrong, _time_ms
  FROM public.question_attempts
  WHERE session_id = _session_id AND user_id = auth.uid();

  UPDATE public.practice_sessions ps
  SET
    correct_count = _correct,
    score = _correct,
    skipped_count = _skipped,
    wrong_count = _wrong,
    total_time_ms = NULLIF(_time_ms, 0),
    accuracy = CASE WHEN _total > 0 THEN round((_correct::numeric / _total) * 100, 2) ELSE 0 END,
    finished_at = COALESCE(ps.finished_at, now())
  WHERE ps.id = _session_id AND ps.user_id = auth.uid()
  RETURNING ps.* INTO _s;

  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'session_id', _s.id,
    'chapter', _s.chapter,
    'subject', _s.subject,
    'question_count', _s.question_count,
    'correct_count', _s.correct_count,
    'skipped_count', _s.skipped_count,
    'wrong_count', _s.wrong_count,
    'total_time_ms', _s.total_time_ms,
    'accuracy', _s.accuracy,
    'score', _s.score,
    'practice_mode', _s.practice_mode,
    'server_graded', true
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid, jsonb) TO authenticated;

-- ── 6) Live battle answer → question_attempts mirror ─────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_mirror_battle_answer(
  _participant_id uuid,
  _question_id uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _bp record;
  _ba record;
  _concept text;
  _subconcept text;
  _skipped boolean;
  _bank_id uuid;
  _aid uuid;
  _existing uuid;
  _class int;
  _school uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT bp.*, b.subject, b.chapter, b.topic, b.class_level, b.id AS battle_uuid, b.school_id
    INTO _bp
  FROM public.battle_participants bp
  JOIN public.battles b ON b.id = bp.battle_id
  WHERE bp.id = _participant_id AND bp.user_id = _uid;
  IF _bp IS NULL THEN RAISE EXCEPTION 'participant not found'; END IF;

  SELECT ba.*, bq.question, bq.options, bq.correct_index, bq.bank_question_id,
         bq.concept, bq.subconcept
    INTO _ba
  FROM public.battle_answers ba
  JOIN public.battle_questions bq ON bq.id = ba.question_id
  WHERE ba.participant_id = _participant_id AND ba.question_id = _question_id;
  IF _ba IS NULL THEN RETURN NULL; END IF;

  _class := COALESCE(_bp.class_level, 12);
  _school := _bp.school_id;
  _concept := COALESCE(_ba.concept, _bp.topic, _bp.chapter, _bp.subject);
  _subconcept := COALESCE(_ba.subconcept, _ba.concept, _bp.topic);
  _skipped := COALESCE(_ba.selected_index, -1) < 0;
  _bank_id := _ba.bank_question_id;

  SELECT id INTO _existing
  FROM public.question_attempts
  WHERE user_id = _bp.user_id
    AND source = 'battle'
    AND (
      (_bank_id IS NOT NULL AND bank_question_id = _bank_id AND source_id = _bp.battle_uuid)
      OR (
        generated_question->>'battle_question_id' = _ba.question_id::text
        AND source_id = _bp.battle_uuid
      )
    )
  LIMIT 1;

  IF _existing IS NOT NULL THEN
    RETURN _existing;
  END IF;

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, school_id, template_id, bank_question_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    time_taken_ms, skipped, subject, chapter, topic, concept, subconcept, difficulty,
    hint_used, solution_viewed, source, source_id, practice_mode,
    class_level, timed_out, answered_at
  ) VALUES (
    NULL,
    _bp.student_id,
    _bp.user_id,
    _school,
    NULL,
    _bank_id,
    jsonb_build_object(
      'question', _ba.question,
      'options', COALESCE(_ba.options, '[]'::jsonb),
      'explanation', '',
      'bank_question_id', _bank_id,
      'battle_question_id', _ba.question_id,
      'battle_id', _bp.battle_uuid,
      'participant_id', _participant_id,
      'subject', COALESCE(_bp.subject, 'General'),
      'chapter', _bp.chapter,
      'topic', _bp.topic,
      'concept', _concept
    ),
    jsonb_build_object(
      'index', _ba.selected_index,
      'selected_index', _ba.selected_index
    ),
    jsonb_build_object(
      'index', _ba.correct_index,
      'correct_index', _ba.correct_index
    ),
    CASE WHEN _ba.is_correct AND NOT _skipped THEN 1 ELSE 0 END,
    CASE WHEN _skipped THEN false ELSE COALESCE(_ba.is_correct, false) END,
    _ba.time_ms,
    _skipped,
    COALESCE(_bp.subject, 'General'),
    _bp.chapter,
    _bp.topic,
    _concept,
    _subconcept,
    'medium',
    false,
    false,
    'battle',
    _bp.battle_uuid,
    'battle',
    _class,
    _skipped,
    now()
  )
  RETURNING id INTO _aid;

  IF _skipped THEN
    RETURN _aid;
  END IF;

  IF _ba.is_correct THEN
    PERFORM public._upsert_concept_mastery(
      _bp.user_id, _bp.student_id, _class,
      COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, true, false
    );
  ELSE
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
  END IF;

  RETURN _aid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_mirror_battle_answer(uuid, uuid) TO authenticated;

-- Finish-path battle capture stays as bulk safety net (idempotent with live mirror)
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
  SELECT bp.*, b.subject, b.chapter, b.topic, b.class_level, b.id AS battle_uuid, b.school_id
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
    _skipped := COALESCE(_ba.selected_index, -1) < 0;
    _bank_id := _ba.bank_question_id;

    SELECT id INTO _existing
    FROM public.question_attempts
    WHERE user_id = _bp.user_id
      AND source = 'battle'
      AND (
        (_bank_id IS NOT NULL AND bank_question_id = _bank_id AND COALESCE(source_id, _bp.battle_uuid) = _bp.battle_uuid)
        OR (
          generated_question->>'battle_question_id' = _ba.question_id::text
        )
      )
    LIMIT 1;

    IF _existing IS NULL THEN
      INSERT INTO public.question_attempts (
        session_id, student_id, user_id, school_id, template_id, bank_question_id,
        generated_question, selected_answer, correct_answer, score, is_correct,
        time_taken_ms, skipped, subject, chapter, topic, concept, subconcept, difficulty,
        hint_used, solution_viewed, source, source_id, practice_mode,
        class_level, timed_out, answered_at
      ) VALUES (
        NULL,
        _bp.student_id,
        _bp.user_id,
        _bp.school_id,
        NULL,
        _bank_id,
        jsonb_build_object(
          'question', _ba.question,
          'options', COALESCE(_ba.options, '[]'::jsonb),
          'explanation', '',
          'bank_question_id', _bank_id,
          'battle_question_id', _ba.question_id,
          'battle_id', _bp.battle_uuid,
          'participant_id', _participant_id,
          'subject', COALESCE(_bp.subject, 'General'),
          'chapter', _bp.chapter,
          'topic', _bp.topic,
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
        _bp.topic,
        _concept,
        _subconcept,
        'medium',
        false,
        false,
        'battle',
        _bp.battle_uuid,
        'battle',
        _class,
        _skipped,
        now()
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

  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;
END;
$$;

-- ── 7) Recovery answers → question_attempts ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_submit_recovery_answer(
  _question_id uuid,
  _student_answer jsonb,
  _is_correct boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _q record;
  _a record;
  _uid uuid := auth.uid();
  _done boolean;
  _aid uuid;
  _concept text;
  _subconcept text;
  _sel int;
  _skipped boolean;
  _school uuid;
  _class int;
  _corr_idx int;
BEGIN
  SELECT q.*, a.user_id AS a_user_id, a.student_id AS a_student_id, a.subject AS a_subject,
         a.chapter AS a_chapter, a.concept AS a_concept, a.subconcept AS a_subconcept,
         a.id AS assignment_id
    INTO _q
  FROM public.recovery_assignment_questions q
  JOIN public.recovery_assignments a ON a.id = q.assignment_id
  WHERE q.id = _question_id AND a.user_id = _uid;

  IF _q IS NULL THEN RAISE EXCEPTION 'Question not found'; END IF;

  UPDATE public.recovery_assignment_questions SET
    answered = true, is_correct = _is_correct, student_answer = _student_answer
  WHERE id = _question_id;

  UPDATE public.recovery_assignments SET
    questions_completed = questions_completed + 1,
    questions_correct = questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  WHERE id = _q.assignment_id
  RETURNING * INTO _a;

  SELECT school_id INTO _school FROM public.students WHERE id = _a.student_id;
  IF _school IS NULL THEN
    SELECT school_id INTO _school FROM public.profiles WHERE id = _uid;
  END IF;

  _concept := COALESCE(_a.concept, _a.chapter, _a.subject);
  _subconcept := COALESCE(_a.subconcept, _concept);
  _sel := COALESCE((_student_answer->>'selected_index')::int, (_student_answer->>'index')::int, -1);
  _skipped := _sel < 0;
  _corr_idx := COALESCE(
    (_q.correct_answer->>'correct_index')::int,
    (_q.correct_answer->>'index')::int,
    0
  );

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, school_id, bank_question_id,
    generated_question, selected_answer, correct_answer, score, is_correct,
    skipped, subject, chapter, topic, concept, subconcept, difficulty,
    source, source_id, practice_mode, class_level, timed_out, answered_at,
    solution_viewed
  ) VALUES (
    NULL,
    _a.student_id,
    _uid,
    _school,
    _q.bank_question_id,
    jsonb_build_object(
      'question', _q.question_text,
      'options', COALESCE(_q.options, '[]'::jsonb),
      'explanation', COALESCE(_q.explanation, ''),
      'recovery_question_id', _question_id,
      'bank_question_id', _q.bank_question_id,
      'subject', _a.subject,
      'chapter', _a.chapter,
      'concept', _concept
    ),
    COALESCE(_student_answer, '{}'::jsonb),
    COALESCE(_q.correct_answer, jsonb_build_object('correct_index', _corr_idx, 'index', _corr_idx)),
    CASE WHEN _is_correct AND NOT _skipped THEN 1 ELSE 0 END,
    CASE WHEN _skipped THEN false ELSE _is_correct END,
    _skipped,
    COALESCE(_a.subject, 'General'),
    _a.chapter,
    _a.chapter,
    _concept,
    _subconcept,
    'medium',
    'recovery',
    _q.assignment_id,
    'recovery',
    _class,
    false,
    now(),
    true
  )
  RETURNING id INTO _aid;

  PERFORM public._upsert_concept_mastery(
    _uid, _a.student_id, _class, _a.subject, _a.chapter, _concept, _subconcept, _is_correct, true
  );

  SELECT count(*) = _a.question_count INTO _done
  FROM public.recovery_assignment_questions WHERE assignment_id = _q.assignment_id AND answered;

  IF _done THEN
    UPDATE public.recovery_assignments SET status = 'completed', completed_at = now() WHERE id = _q.assignment_id;
    PERFORM public._rebuild_revision_queue(_uid, _a.student_id);
  END IF;

  RETURN jsonb_build_object(
    'completed', _done,
    'attempt_id', _aid,
    'questions_completed', _a.questions_completed + 1,
    'questions_correct', _a.questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_answer(uuid, jsonb, boolean) TO authenticated;

-- ── 8) DPP finish — mirror ALL answers into question_attempts ────────────────
CREATE OR REPLACE FUNCTION public._capture_dpp_mistakes(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att record; _q record; _ans record; _prio int; _existing uuid;
  _concept text; _subconcept text;
  _skipped boolean;
  _is_correct boolean;
  _sel int;
  _aid uuid;
  _qa_existing uuid;
BEGIN
  SELECT a.*, d.subject, d.chapter, d.topic, d.school_id AS dpp_school_id
    INTO _att
  FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
  WHERE a.id = _attempt_id;
  IF _att IS NULL THEN RETURN; END IF;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;

    _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
    _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);
    IF _ans IS NULL THEN
      _sel := -1;
      _skipped := true;
      _is_correct := false;
    ELSE
      _sel := COALESCE(
        (_ans.response->>'selected_index')::int,
        (_ans.response->>'index')::int,
        -1
      );
      _skipped := _sel < 0;
      _is_correct := CASE WHEN _skipped THEN false ELSE COALESCE(_ans.is_correct, false) END;
    END IF;

    -- Mirror every DPP item into Practice Intelligence
    SELECT id INTO _qa_existing
    FROM public.question_attempts
    WHERE user_id = _att.user_id
      AND source = 'dpp'
      AND source_id = _att.dpp_id
      AND generated_question->>'dpp_question_id' = _q.id::text
    LIMIT 1;

    IF _qa_existing IS NULL THEN
      INSERT INTO public.question_attempts (
        session_id, student_id, user_id, school_id, bank_question_id,
        generated_question, selected_answer, correct_answer, score, is_correct,
        skipped, subject, chapter, topic, concept, subconcept, difficulty,
        source, source_id, practice_mode, class_level, timed_out, answered_at
      ) VALUES (
        NULL,
        _att.student_id,
        _att.user_id,
        COALESCE(_att.school_id, _att.dpp_school_id),
        NULL,
        jsonb_build_object(
          'question', _q.question,
          'options', COALESCE(_q.options, '[]'::jsonb),
          'explanation', COALESCE(_q.explanation, ''),
          'dpp_question_id', _q.id,
          'dpp_id', _att.dpp_id,
          'dpp_attempt_id', _attempt_id,
          'subject', COALESCE(_q.subject, _att.subject, 'General'),
          'chapter', COALESCE(_q.chapter, _att.chapter),
          'topic', _att.topic,
          'concept', _concept
        ),
        COALESCE(_ans.response, jsonb_build_object('selected_index', -1)),
        COALESCE(_q.correct, '{}'::jsonb),
        CASE WHEN _is_correct THEN 1 ELSE 0 END,
        _is_correct,
        _skipped,
        COALESCE(_q.subject, _att.subject, 'General'),
        COALESCE(_q.chapter, _att.chapter),
        _att.topic,
        _concept,
        _subconcept,
        'medium',
        'dpp',
        _att.dpp_id,
        'dpp',
        _q.class_level,
        _skipped AND _ans IS NULL,
        now()
      )
      RETURNING id INTO _aid;
    END IF;

    IF _ans IS NULL OR _skipped THEN
      CONTINUE;
    END IF;

    IF _is_correct THEN
      PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
        COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
        _concept, _subconcept, true, false);
      CONTINUE;
    END IF;

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _att.user_id, _att.student_id, 'dpp', _att.dpp_id, _q.id,
      _q.class_level, COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _att.topic, _concept, _subconcept, 'dpp',
      _q.question, _q.options, _ans.response, _q.correct, _q.explanation, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
      COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _concept, _subconcept, false, false);

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(
      _att.user_id, COALESCE(_att.subject, 'General'), _att.chapter, _concept, NULL
    ) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _att.user_id AND NOT completed
      AND subject = COALESCE(_att.subject, 'General')
      AND COALESCE(chapter, '') = COALESCE(_att.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_concept, '')
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, _prio), reason = 'dpp_wrong', due_date = LEAST(due_date, CURRENT_DATE)
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _att.user_id, _att.student_id,
        COALESCE(_att.subject, 'General'), _att.chapter, _concept,
        'dpp_wrong', _prio, CURRENT_DATE
      );
    END IF;
  END LOOP;

  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;
END; $$;
