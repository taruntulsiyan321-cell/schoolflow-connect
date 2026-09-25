-- ===========================================================================
-- A VARIANT'S WRONG ANSWER IS RECORDED AS ITS ORIGINAL
--
-- A wrong answer to a recovery variant bumps the ORIGINAL's mistake row
-- (20261051000000) — but rpc_record_question_attempt passed the variant's text
-- and answer with it, and the upsert keeps the newest answer. Measured
-- 2026-09-25: three CUET rows showed an answer that is not one of their
-- question's choices ("Providing equal wages to all workers…" against Fayol's
-- Equity options), because the Mistake Book shows the row's own copy.
--
-- Now the row is written as the question it names: for a variant, the
-- original's text, options, key, explanation and topic, and the answer the
-- student last gave to the original (they did not answer the original this
-- time). Every other attempt is recorded exactly as before. The rows already
-- written are repaired by 20261098000000.
--
-- ROLLBACK: rollback/20261097000000_a_variant_answer_is_recorded_as_its_original.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(_correct_answer jsonb, _generated_question jsonb, _is_correct boolean, _selected_answer jsonb, _session_id uuid, _score numeric DEFAULT 0, _skipped boolean DEFAULT false, _template_id uuid DEFAULT NULL::uuid, _time_taken_ms integer DEFAULT NULL::integer, _bank_question_id uuid DEFAULT NULL::uuid, _hint_used boolean DEFAULT false, _source text DEFAULT 'practice'::text, _meta jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
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
  -- The question a mistake belongs to: a variant's origin, or the
  -- question itself. Set beside _bank_id so the two cannot drift.
  _mistake_qid uuid;
  _grade record;
  -- What the mistake row records: the question it names (see below).
  _origin record;
  _mk_subject text;
  _mk_chapter text;
  _mk_concept text;
  _mk_subconcept text;
  _mk_question text;
  _mk_options jsonb;
  _mk_answer jsonb;
  _mk_correct jsonb;
  _mk_explanation text;
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

  -- One writer per session at a time: the de-duplication below is a read
  -- followed by a write, and two calls racing it both inserted.
  SELECT * INTO _ps
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = _uid
  FOR UPDATE;

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
      RETURN public._attempt_verdict(_aid);
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
      RETURN public._attempt_verdict(_aid);
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
    SELECT COALESCE(qb.source_question_id, _bank_id) INTO _mistake_qid
      FROM public.question_bank qb WHERE qb.id = _bank_id;
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
    -- Upload / free-text: no bank row, often no template. Never dereference
    -- _tm unless SELECT INTO assigned it — PL/pgSQL raises on unassigned
    -- record fields even inside COALESCE (§12.2 measured 2026-09-24).
    IF _template_id IS NOT NULL THEN
      SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
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
    ELSE
      _subject := COALESCE(
        NULLIF(_generated_question->>'subject', ''),
        _ps.subject, 'General'
      );
      _chapter := COALESCE(
        NULLIF(_generated_question->>'chapter', ''),
        _ps.chapter
      );
      _topic := COALESCE(_topic, NULLIF(_generated_question->>'topic', ''), _chapter);
      _concept_f := COALESCE(
        NULLIF(_generated_question->>'concept', ''),
        _ps.chapter, _ps.subject
      );
      _sub_f := _concept_f;
      _class := COALESCE(
        NULLIF(_m->>'class_level', '')::int,
        _ps.class_level, 12
      );
      _difficulty := COALESCE(
        NULLIF(_m->>'difficulty', ''),
        'medium'
      );
    END IF;
    _resolved_correct := CASE
      WHEN COALESCE(_skipped, false) OR _timed_out THEN false
      ELSE COALESCE(_is_correct, false)
    END;
    _resolved_score := CASE WHEN _resolved_correct THEN COALESCE(_score, 1) ELSE 0 END;
    _resolved_correct_answer := COALESCE(_correct_answer, '{}'::jsonb);
    _mistake_qid := _bank_id;
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
    --
    -- A VARIANT IS NOT ITS OWN MISTAKE. It is another way of asking the
    -- original, so a wrong answer to it belongs to the ORIGINAL's row.
    -- _mistake_qid resolves a variant to the question it was generated from
    -- (question_bank.source_question_id) and leaves every other question
    -- alone.
    --
    -- Two defects came out of not doing this, both measured 2026-09-22:
    --
    --   IN RECOVERY, the guard below looked for a mistake keyed on the
    --   VARIANT, never found one, and so recorded nothing at all — 20 wrong
    --   answers to variants vanished. "Never add one" was implemented as
    --   "never do anything", which lost the bump as well as the insert.
    --
    --   OUTSIDE RECOVERY, the ordinary path keyed the mistake on the variant
    --   itself: 10 such rows exist, fragmenting one weakness across a parent
    --   and its generated children so that neither shows the true
    --   times_wrong.
    --
    -- Resolving first fixes both: recovery bumps the original and still adds
    -- nothing, and ordinary practice bumps the original instead of minting a
    -- variant-keyed row.
    IF COALESCE(_practice_mode, '') <> 'recovery'
       OR EXISTS (
         SELECT 1 FROM public.student_mistakes sm
          WHERE sm.user_id = _uid
            AND sm.source = 'practice'
            AND sm.question_id IS NOT DISTINCT FROM _mistake_qid
            AND _mistake_qid IS NOT NULL)
    THEN
    -- THE ROW RECORDS THE QUESTION IT NAMES. For a variant that is the
    -- original: its text, options, key, explanation and topic. The student
    -- did not answer the original this time, so the answer the row shows
    -- stays the one they last gave to IT. Passing the variant's text and
    -- answer here (2026-09-22 to 09-25) put a variant's option against the
    -- original's options: the Mistake Book showed "Providing equal wages…"
    -- as the answer to a question with no such choice.
    _mk_subject := _subject; _mk_chapter := _chapter; _mk_concept := _concept_f; _mk_subconcept := _sub_f;
    _mk_question := COALESCE(_generated_question->>'question', '');
    _mk_options := COALESCE(_generated_question->'options', '[]'::jsonb);
    _mk_answer := COALESCE(_selected_answer, '{}'::jsonb);
    _mk_correct := _resolved_correct_answer;
    _mk_explanation := _explanation;
    IF _mistake_qid IS DISTINCT FROM _bank_id THEN
      SELECT * INTO _origin FROM public._practice_grade_from_bank(_mistake_qid, '{}'::jsonb, NULL);
      IF FOUND THEN
        _mk_subject := COALESCE(_origin.subject, _subject);
        _mk_chapter := COALESCE(_origin.chapter, _chapter);
        _mk_concept := COALESCE(_origin.topic, _origin.chapter, _concept_f);
        _mk_subconcept := _mk_concept;
        _mk_question := _origin.question_text;
        _mk_options := _origin.options;
        _mk_correct := _origin.correct_answer;
        _mk_explanation := COALESCE(_origin.explanation, '');
        SELECT sm.student_answer INTO _mk_answer
          FROM public.student_mistakes sm
         WHERE sm.user_id = _uid AND sm.source = 'practice' AND sm.question_id = _mistake_qid;
        _mk_answer := COALESCE(_mk_answer, '{}'::jsonb);
      END IF;
    END IF;
    PERFORM public.rpc_record_concept_mistake(
      CASE WHEN _src = 'upload' THEN 'upload' ELSE 'practice' END,
      _session_id, _mistake_qid,
      _mk_subject, _mk_chapter, _mk_concept, _mk_subconcept, _class,
      _mk_question,
      _mk_options,
      _mk_answer,
      _mk_correct,
      _mk_explanation,
      NULLIF(_generated_question->>'chapter_id', '')::uuid,
      NULLIF(_generated_question->>'upload_question_id', '')::uuid
    );
    END IF;
  END IF;

  RETURN public._attempt_verdict(_aid);
END;
$function$;

DO $proof$
DECLARE _src text := pg_get_functiondef('public.rpc_record_question_attempt(jsonb,jsonb,boolean,jsonb,uuid,numeric,boolean,uuid,integer,uuid,boolean,text,jsonb)'::regprocedure);
BEGIN
  IF _src NOT LIKE '%_practice_grade_from_bank(_mistake_qid%' OR _src NOT LIKE '%_mk_answer,%' THEN
    RAISE EXCEPTION 'a variant''s mistake is not recorded as its original';
  END IF;
END
$proof$;

COMMIT;
