-- Rollback of 20261039300000_a_practice_session_records_what_was_shown_once.
--
-- Restores the four function bodies exactly as they were live on 2026-09-17
-- before the migration (pg_get_functiondef, CRLF normalised), and drops the
-- catalog function.
--
-- NOT reversed, deliberately:
--   * the duplicate attempt rows and the unseen timed-out rows that were
--     removed — they recorded answers that were never given twice and
--     questions that were never shown; restoring them would restore the
--     corruption, not a state anyone relied on;
--   * the topic confidences re-scored to "answered, not attempted" — with the
--     old function back they return to the old rule the next time each topic
--     is practised.
-- Client code from the same commit calls rpc_practice_bank_catalog: roll the
-- client back with it, or the Practice subject list will fail to load.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(_correct_answer jsonb, _generated_question jsonb, _is_correct boolean, _selected_answer jsonb, _session_id uuid, _score numeric DEFAULT 0, _skipped boolean DEFAULT false, _template_id uuid DEFAULT NULL::uuid, _time_taken_ms integer DEFAULT NULL::integer, _bank_question_id uuid DEFAULT NULL::uuid, _hint_used boolean DEFAULT false, _source text DEFAULT 'practice'::text, _meta jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  -- A topic string from the client is honoured ONLY for a question that is not
  -- in the bank. A bank question's topic is the bank's (below): a client that
  -- sends a stale or display-cleaned label must not file the attempt under a
  -- topic the question does not belong to.
  _topic := COALESCE(
    NULLIF(_m->>'topic', ''),
    NULLIF(_generated_question->>'topic', '')
  );
  IF _m ? 'hint_used' THEN
    _hint_used := COALESCE((_m->>'hint_used')::boolean, _hint_used);
  END IF;

  -- Same-session re-entry: update the existing attempt and return early, so
  -- counters are not double-counted within one session.
  IF _bank_id IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id = _bank_id
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      UPDATE public.question_attempts SET
        hint_used = hint_used OR COALESCE(_hint_used, false),
        solution_viewed = solution_viewed OR _solution_viewed,
        timed_out = timed_out OR _timed_out,
        time_taken_ms = COALESCE(time_taken_ms, _time_taken_ms),
        confidence = COALESCE(confidence, _confidence),
        attempt_number = COALESCE(attempt_number, _attempt_number),
        practice_mode = COALESCE(practice_mode, _practice_mode),
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

  -- Same fix, for the template path (bank_id IS NULL): Class12MathSession.tsx
  -- / Class12AiSession.tsx persist each answer live via
  -- recordPracticeAttemptBestEffort, then rpc_finish_practice_session
  -- unconditionally re-sends the same attempt again at session finish. The
  -- bank-path check above can't catch this (bank_question_id is null for a
  -- template attempt by definition) -- attempt_number is the equivalent
  -- natural key here, set by the client on every attempt regardless of
  -- source.
  IF _bank_id IS NULL AND _attempt_number IS NOT NULL THEN
    SELECT id INTO _aid
    FROM public.question_attempts
    WHERE session_id = _session_id
      AND user_id = _uid
      AND bank_question_id IS NULL
      AND attempt_number = _attempt_number
    LIMIT 1;
    IF _aid IS NOT NULL THEN
      UPDATE public.question_attempts SET
        hint_used = hint_used OR COALESCE(_hint_used, false),
        solution_viewed = solution_viewed OR _solution_viewed,
        timed_out = timed_out OR _timed_out,
        time_taken_ms = COALESCE(time_taken_ms, _time_taken_ms),
        confidence = COALESCE(confidence, _confidence),
        practice_mode = COALESCE(practice_mode, _practice_mode),
        topic = COALESCE(topic, _topic),
        board = COALESCE(board, _board),
        stream = COALESCE(stream, _stream),
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
    -- The bank's topic, and nothing the client said. Mastery and mistakes key
    -- on it (as concept, with subconcept = concept, the shape this function
    -- has always written).
    _topic := COALESCE(_grade.topic, _chapter);
    _concept_f := COALESCE(_grade.topic, _chapter, _subject);
    _sub_f := _concept_f;
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
        'topic_id', _grade.topic_id,
        'difficulty', _difficulty,
        'practice_mode', _practice_mode
      );
    ELSE
      _generated_question := COALESCE(_generated_question, '{}'::jsonb)
        - 'concept'
        || jsonb_build_object(
          'bank_question_id', _bank_id,
          'explanation', COALESCE(_generated_question->>'explanation', _explanation),
          'subject', COALESCE(_generated_question->>'subject', _subject),
          'chapter', COALESCE(_generated_question->>'chapter', _chapter),
          'topic', _topic,
          'topic_id', _grade.topic_id,
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
    BEGIN
      PERFORM public.rpc_refresh_academic_brain();
    EXCEPTION WHEN others THEN
      NULL;
    END;
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
    -- §4.6: recovery may bump a row, never add one. Tiers 1-3 are
    -- generated variants the student has never seen, so recording them the
    -- ordinary way manufactured new mistakes out of the session built to fix
    -- the old ones — 6 open became 10, which is above the relearn boundary.
    -- Revision is not exempt: §5.5 gives it the opposite rule on purpose.
    IF COALESCE(_practice_mode, '') <> 'recovery'
       OR EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid
            AND sm.source = 'practice'
            AND sm.question_id IS NOT DISTINCT FROM _bank_id
            AND _bank_id IS NOT NULL)
    THEN
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _bank_id,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>'question', ''),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _resolved_correct_answer,
      _explanation
    );
    END IF;
  END IF;

  RETURN _aid;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(_session_id uuid, _attempts jsonb DEFAULT NULL::jsonb, _ended_by_user boolean DEFAULT NULL::boolean, _ended_normally boolean DEFAULT true)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _xp int;
  _prog jsonb := NULL;
  _already boolean := false;
BEGIN
  SELECT * INTO _s
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = auth.uid();

  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  _already := _s.finished_at IS NOT NULL;

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

  -- Display XP = correct × 5 (rule) + session complete bonus (25) when first finished
  _xp := CASE WHEN _total > 0
              THEN GREATEST(_correct, 0) * 5 + CASE WHEN NOT _already THEN 25 ELSE 0 END
              ELSE 0 END;

  UPDATE public.practice_sessions ps
  SET
    correct_count = _correct,
    score = _correct,
    skipped_count = _skipped,
    wrong_count = _wrong,
    total_time_ms = NULLIF(_time_ms, 0),
    accuracy = CASE WHEN (_correct + _wrong) > 0
                     THEN round((_correct::numeric / (_correct + _wrong)) * 100, 2) END,
    question_count = _total,
    xp_earned = CASE WHEN ps.finished_at IS NULL THEN _xp ELSE COALESCE(ps.xp_earned, _xp) END,
    finished_at = COALESCE(ps.finished_at, now()),
    ended_by_user = COALESCE(ps.ended_by_user, _ended_by_user),
    ended_normally = COALESCE(ps.ended_normally, _ended_normally)
  WHERE ps.id = _session_id AND ps.user_id = auth.uid()
  RETURNING ps.* INTO _s;

  -- A session with no attempts is not a session. It is not a day of
  -- activity, it is not a minute of study, it is not a practice session on
  -- the counter, it is not a streak day and it is not worth XP. `_total` is
  -- the attempt count this function has just measured from question_attempts
  -- — the same rule the client calls sessionWasAttempted.
  IF NOT _already AND _total > 0 THEN
    -- The time actually spent on the questions, not the clock on the wall.
    -- Wall clock is the fallback for a session with no per-question timing,
    -- and the one-minute floor stays: a session that was sat is not zero.
    _mins := GREATEST(
      CASE WHEN _time_ms > 0
           THEN round(_time_ms / 60000.0)::int
           ELSE COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1)
      END,
      1
    );
    PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);
  END IF;

  IF NOT _already AND _total > 0 THEN
    PERFORM public._ensure_student_xp(auth.uid());
    UPDATE public.student_xp SET
      practice_sessions_count = COALESCE(practice_sessions_count, 0) + 1,
      total_correct = COALESCE(total_correct, 0) + _correct,
      total_answered = COALESCE(total_answered, 0) + GREATEST(_total - _skipped, 0),
      updated_at = now()
    WHERE user_id = auth.uid();

    PERFORM public._progression_bump_study_streak(auth.uid());

    _prog := public.rpc_apply_progression(
      'practice.session.complete',
      'practice_session',
      _session_id::text,
      'practice.session:' || _session_id::text,
      NULL,
      jsonb_build_object('correct', _correct, 'total', _total),
      auth.uid()
    );

    IF _correct > 0 THEN
      PERFORM public.rpc_apply_progression(
        'practice.correct_answer',
        'practice_session',
        _session_id::text,
        'practice.correct:' || _session_id::text,
        _correct * 5,
        jsonb_build_object('correct', _correct),
        auth.uid()
      );
    END IF;

    -- ▼ Practice Engine: confidence is recomputed ONCE, here. An abandoned
    -- session never reaches this function, so it never affects confidence.
    PERFORM public._recompute_concept_confidence_for_session(_session_id);
    -- ▲
  END IF;

  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;

  -- §3.1: the denominator. Eight open mistakes in Cash Flow means
  -- something entirely different out of 20 questions than out of 200.
  BEGIN
    PERFORM public._write_chapter_tally(_session_id);
    -- §4.1 and §5.2, in that order and AFTER the tally: the engagement
    -- clock reads the rows the tally just wrote.
    PERFORM public._apply_chapter_state(_session_id);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_finish_practice_session(%): chapter tally failed: %', _session_id, SQLERRM;
  END;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'correct_count', _correct,
    'wrong_count', _wrong,
    'skipped_count', _skipped,
    'total', _total,
    'xp_earned', COALESCE(_s.xp_earned, _xp),
    'accuracy', _s.accuracy,
    'total_time_ms', _s.total_time_ms,
    'finished_at', _s.finished_at,
    'already_finished', _already,
    'progression', _prog
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public._recompute_concept_confidence_for_session(_session_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid;
  _sid uuid;
BEGIN
  SELECT user_id, student_id
  INTO _uid, _sid
  FROM public.practice_sessions
  WHERE id = _session_id;

  IF _uid IS NULL THEN RETURN; END IF;

  WITH touched AS (
    -- The topics this session touched, keyed the way concept_mastery is
    -- (subject, chapter text, concept = topic name, subconcept = concept).
    SELECT DISTINCT
      qb.topic_id,
      COALESCE(qb.subject, 'General') AS subject,
      qb.chapter                      AS chapter,
      t.name                          AS topic
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    JOIN public.topics t         ON t.id = qb.topic_id
    WHERE qa.session_id = _session_id
      AND qa.user_id = _uid
      AND qa.bank_question_id IS NOT NULL
  ),
  agg AS (
    -- Confidence spans ALL of the student's attempts in each touched topic,
    -- not just this session, so fixing an old mistake raises the score.
    SELECT
      t.subject, t.chapter, t.topic,
      max(qb.class_level)                                 AS class_level,
      count(*)::int                                       AS attempted,
      count(*) FILTER (WHERE qr.is_correct IS TRUE)::int  AS correct
    FROM touched t
    JOIN public.question_bank qb     ON qb.topic_id = t.topic_id
    JOIN public.question_attempts qr ON qr.bank_question_id = qb.id AND qr.user_id = _uid
    GROUP BY t.subject, t.chapter, t.topic
  )
  INSERT INTO public.concept_mastery AS cm (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    confidence_score, total_attempts, correct_attempts, last_attempt_at, updated_at
  )
  SELECT
    _uid, _sid, a.class_level, a.subject, a.chapter, a.topic, a.topic,
    round((a.correct::numeric / a.attempted) * 100, 1),
    a.attempted, a.correct, now(), now()
  FROM agg a
  WHERE a.attempted > 0
  -- Must match the expression index concept_mastery_user_concept exactly.
  ON CONFLICT (user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, ''))
  DO UPDATE SET
    confidence_score = EXCLUDED.confidence_score,
    total_attempts   = EXCLUDED.total_attempts,
    correct_attempts = EXCLUDED.correct_attempts,
    student_id       = COALESCE(EXCLUDED.student_id, cm.student_id),
    class_level      = COALESCE(EXCLUDED.class_level, cm.class_level),
    last_attempt_at  = now(),
    updated_at       = now();
    -- mastery_score deliberately untouched: still owned by _upsert_concept_mastery.
END;
$function$;

CREATE OR REPLACE FUNCTION public.rpc_list_practice_history(_limit integer DEFAULT 100, _subject text DEFAULT NULL::text, _practice_mode text DEFAULT NULL::text, _date_from timestamp with time zone DEFAULT NULL::timestamp with time zone, _date_to timestamp with time zone DEFAULT NULL::timestamp with time zone, _search text DEFAULT NULL::text, _sort text DEFAULT 'finished_at_desc'::text)
 RETURNS SETOF practice_sessions
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _q text := lower(nullif(btrim(coalesce(_search, '')), ''));
  _lim int := least(greatest(coalesce(_limit, 100), 1), 200);
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  RETURN QUERY
  SELECT ps.*
  FROM public.practice_sessions ps
  WHERE ps.user_id = _uid
    AND ps.finished_at IS NOT NULL
    AND (_subject IS NULL OR btrim(_subject) = '' OR ps.subject ILIKE btrim(_subject))
    AND (_practice_mode IS NULL OR btrim(_practice_mode) = '' OR ps.practice_mode = btrim(_practice_mode))
    AND (_date_from IS NULL OR ps.finished_at >= _date_from)
    AND (_date_to IS NULL OR ps.finished_at <= _date_to)
    AND (
      _q IS NULL
      OR lower(coalesce(ps.subject, '')) LIKE '%' || _q || '%'
      OR lower(coalesce(ps.chapter, '')) LIKE '%' || _q || '%'
      OR lower(coalesce(ps.practice_mode, '')) LIKE '%' || _q || '%'
      OR lower(coalesce(ps.difficulty, '')) LIKE '%' || _q || '%'
    )
  ORDER BY
    CASE WHEN _sort = 'accuracy_desc' THEN ps.accuracy END DESC NULLS LAST,
    CASE WHEN _sort = 'accuracy_asc' THEN ps.accuracy END ASC NULLS LAST,
    CASE WHEN _sort = 'xp_desc' THEN ps.xp_earned END DESC NULLS LAST,
    CASE WHEN _sort = 'xp_asc' THEN ps.xp_earned END ASC NULLS LAST,
    ps.finished_at DESC NULLS LAST
  LIMIT _lim;
END;
$function$;

DROP FUNCTION IF EXISTS public.rpc_practice_bank_catalog(integer, text, text, text);

DO $check$
DECLARE _def text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def FROM pg_proc p
   WHERE p.oid = 'public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)'::regprocedure;
  IF position('FOR UPDATE' IN _def) > 0 THEN RAISE EXCEPTION 'rollback: record still locks'; END IF;
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def FROM pg_proc p
   WHERE p.oid = 'public.rpc_finish_practice_session(uuid,jsonb,boolean,boolean)'::regprocedure;
  IF position('FOR UPDATE' IN _def) > 0 THEN RAISE EXCEPTION 'rollback: finish still locks'; END IF;
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def FROM pg_proc p
   WHERE p.proname = 'rpc_list_practice_history';
  IF position('_practice_session_attempted' IN _def) > 0 THEN RAISE EXCEPTION 'rollback: history still filters'; END IF;
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def FROM pg_proc p
   WHERE p.proname = '_recompute_concept_confidence_for_session';
  IF position('COALESCE(qr.skipped, false)' IN _def) > 0 THEN RAISE EXCEPTION 'rollback: confidence still excludes skips'; END IF;
  IF to_regprocedure('public.rpc_practice_bank_catalog(integer,text,text,text)') IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: catalog still present';
  END IF;
END
$check$;

COMMIT;
