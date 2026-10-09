-- ═══════════════════════════════════════════════════════════════════════════
-- A LUCKY GUESS GOES TO THE MISTAKE BOOK (docs/TODO.md C2)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- A right answer the student marked as a guess — the "I'm guessing" tap,
-- question_attempts.confidence = 0 in practice, mock_answers.guessed on a mock
-- paper — is not knowledge. Until now it never reached recovery or revision:
-- both are fed by the Mistake Book (open student_mistakes rows), and only a
-- wrong answer opened a row.
--
-- 1. student_mistakes.lucky_guesses counts the times a question was right only
--    by a guess. It is NOT added to times_wrong: recovery and revision order
--    their questions by times_wrong, so real wrong answers still come first,
--    and the Mistake Book can say "right, by a guess" rather than "wrong". A
--    row must have a reason to exist: one wrong answer or one lucky guess.
-- 2. public._marked_as_guess(confidence) is the database's one reading of
--    the tap, equal to MARKED_AS_GUESS in src/academic/metrics/
--    answerConfidence.ts (a test holds the two together).
-- 3. rpc_record_concept_mistake takes _lucky_guess. A lucky guess opens or
--    reopens the row like a wrong answer, counts in lucky_guesses, and is not
--    counted against mastery: the attempt was already counted, as right.
-- 4. rpc_record_question_attempt sends a right answer marked as a guess down
--    the wrong answer's path — with the same recovery rule (a recovery session
--    bumps an existing row, never adds one) and the same variant rule (it
--    belongs to the original's row).
-- 5. _mock_grade does the same for a mock paper.
--
-- The three function bodies are the live ones (read 2026-10-09; _mock_grade
-- checked equal to 20261150000000 by md5), changed only as above.
--
-- ROLLBACK: rollback/20261152000000_a_lucky_guess_goes_to_the_mistake_book.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. What a row records ───────────────────────────────────────────────────
ALTER TABLE public.student_mistakes
  ADD COLUMN lucky_guesses integer NOT NULL DEFAULT 0
    CONSTRAINT student_mistakes_lucky_guesses_counted CHECK (lucky_guesses >= 0),
  ADD CONSTRAINT student_mistakes_has_a_reason CHECK (times_wrong >= 1 OR lucky_guesses >= 1);

COMMENT ON COLUMN public.student_mistakes.lucky_guesses IS
  'Times this question was answered right only by a guess (the "I''m guessing" tap). Not counted in times_wrong (20261152000000).';

-- ── 2. What a guess is ──────────────────────────────────────────────────────
CREATE FUNCTION public._marked_as_guess(_confidence numeric)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = pg_catalog
AS $fn$
  SELECT COALESCE(_confidence = 0, false)
$fn$;

COMMENT ON FUNCTION public._marked_as_guess(numeric) IS
  'question_attempts.confidence read as the "I''m guessing" tap: 0 is a guess (MARKED_AS_GUESS in answerConfidence.ts).';

REVOKE ALL ON FUNCTION public._marked_as_guess(numeric) FROM PUBLIC, anon, authenticated;

-- ── 3. The recorder: one more reason a row is open ─────────────────────────
DROP FUNCTION public.rpc_record_concept_mistake(text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid);

CREATE FUNCTION public.rpc_record_concept_mistake(_assessment_type text, _source_id uuid, _question_id uuid DEFAULT NULL::uuid, _subject text DEFAULT 'General'::text, _chapter text DEFAULT NULL::text, _concept text DEFAULT NULL::text, _subconcept text DEFAULT NULL::text, _class_level integer DEFAULT NULL::integer, _question_text text DEFAULT ''::text, _options jsonb DEFAULT '[]'::jsonb, _student_answer jsonb DEFAULT '{}'::jsonb, _correct_answer jsonb DEFAULT '{}'::jsonb, _explanation text DEFAULT NULL::text, _chapter_id uuid DEFAULT NULL::uuid, _upload_question_id uuid DEFAULT NULL::uuid, _capture_question_id uuid DEFAULT NULL::uuid, _lucky_guess boolean DEFAULT false)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _mid uuid;
  _concept_f text;
  _sub_f text;
  _src text;
  _atype text;
  _bank_qid uuid := _question_id;
  _up_qid uuid := _upload_question_id;
  _cap_qid uuid := _capture_question_id;
  -- C2: a right answer the student marked as a guess is recorded as well as a
  -- wrong one — counted in lucky_guesses, never in times_wrong, so recovery and
  -- revision (which order by times_wrong) still take real wrong answers first.
  _wrong int := CASE WHEN _lucky_guess THEN 0 ELSE 1 END;
  _lucky int := CASE WHEN _lucky_guess THEN 1 ELSE 0 END;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  IF _bank_qid IS NOT NULL THEN
    _up_qid := NULL;
    _cap_qid := NULL;
  ELSIF _up_qid IS NOT NULL THEN
    _cap_qid := NULL;
  END IF;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), NULLIF(_subject, ''));
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  _src := CASE _assessment_type
    WHEN 'battle' THEN 'battleground'
    WHEN 'practice' THEN 'practice'
    WHEN 'upload' THEN 'upload'
    WHEN 'screen_capture' THEN 'screen_capture'
    ELSE _assessment_type
  END;
  _atype := CASE
    WHEN _assessment_type IN ('upload', 'screen_capture') THEN 'practice'
    ELSE _assessment_type
  END;

  IF _cap_qid IS NOT NULL THEN
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id,
      capture_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, lucky_guesses, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, NULL, NULL, _cap_qid, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      _wrong, _lucky, now()
    )
    ON CONFLICT (user_id, source, capture_question_id)
      WHERE capture_question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + _wrong,
      lucky_guesses = student_mistakes.lucky_guesses + _lucky,
      -- The last time it went badly: wrong, or right only by a guess.
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
      status = 'open', cleared_at = NULL
    RETURNING id INTO _mid;
  ELSIF _up_qid IS NOT NULL THEN
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id,
      capture_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, lucky_guesses, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, NULL, _up_qid, NULL, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      _wrong, _lucky, now()
    )
    ON CONFLICT (user_id, source, upload_question_id)
      WHERE upload_question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + _wrong,
      lucky_guesses = student_mistakes.lucky_guesses + _lucky,
      -- The last time it went badly: wrong, or right only by a guess.
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
      status = 'open', cleared_at = NULL
    RETURNING id INTO _mid;
  ELSE
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id,
      capture_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, lucky_guesses, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, _bank_qid, NULL, NULL, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      _wrong, _lucky, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + _wrong,
      lucky_guesses = student_mistakes.lucky_guesses + _lucky,
      -- The last time it went badly: wrong, or right only by a guess.
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
      status = 'open', cleared_at = NULL
    RETURNING id INTO _mid;
  END IF;

  -- §5.1 — no chapter_id ⇒ no mastery bump and no revision_queue row.
  IF _chapter_id IS NOT NULL THEN
    -- A lucky guess was marked right where it was answered, so it is not
    -- counted against mastery a second time here.
    IF NOT _lucky_guess THEN
      PERFORM public._upsert_concept_mastery(
        _uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);
    END IF;

    IF _assessment_type IN ('practice', 'test', 'battle', 'upload', 'screen_capture')
       AND _sid IS NOT NULL THEN
      IF NOT EXISTS (
        SELECT 1 FROM public.revision_queue
        WHERE user_id = _uid AND NOT completed
          AND subject = _subject
          AND COALESCE(chapter, '') = COALESCE(_chapter, '')
          AND COALESCE(topic, '') = COALESCE(_concept_f, '')
      ) THEN
        INSERT INTO public.revision_queue (
          user_id, student_id, subject, chapter, topic, reason, priority, due_date)
        VALUES (
          _uid, _sid, _subject, _chapter, _concept_f,
          CASE _assessment_type
            WHEN 'practice' THEN 'practice_wrong'
            WHEN 'upload' THEN 'upload_wrong'
            WHEN 'screen_capture' THEN 'screen_capture_wrong'
            ELSE _assessment_type || '_wrong'
          END || CASE WHEN _lucky_guess THEN '_lucky_guess' ELSE '' END,
          75, CURRENT_DATE
        );
      ELSE
        UPDATE public.revision_queue SET
          priority = GREATEST(priority, 75),
          due_date = LEAST(due_date, CURRENT_DATE),
          reason = CASE _assessment_type
            WHEN 'practice' THEN 'practice_wrong'
            WHEN 'upload' THEN 'upload_wrong'
            WHEN 'screen_capture' THEN 'screen_capture_wrong'
            ELSE _assessment_type || '_wrong'
          END || CASE WHEN _lucky_guess THEN '_lucky_guess' ELSE '' END
        WHERE user_id = _uid AND NOT completed
          AND subject = _subject
          AND COALESCE(chapter, '') = COALESCE(_chapter, '')
          AND COALESCE(topic, '') = COALESCE(_concept_f, '');
      END IF;
    END IF;
  END IF;

  RETURN _mid;
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_record_concept_mistake(text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid, boolean) TO authenticated, service_role;

-- ── 4. Practice: a lucky guess takes the wrong answer's path ───────────────
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
  _confidence numeric := NULLIF(_m->>'confidence', '')::numeric;
  _attempt_number int := NULLIF(_m->>'attempt_number', '')::int;
  _timed_out boolean := COALESCE((_m->>'timed_out')::boolean, false);
  _answered_at timestamptz := COALESCE(NULLIF(_m->>'answered_at', '')::timestamptz, now());
  -- C2: right, and marked as a guess (metrics/answerConfidence.ts).
  _lucky boolean := false;
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

  -- PREMIUM (20261111000000): a NEW practice question answered by an
  -- individual account counts against its plan's daily allowance, and is
  -- refused past it -- before it is graded, so no verdict is given for a
  -- question the plan does not cover. A re-entry returned above and is never
  -- counted twice. Recovery, Revision and Mistake Book reattempts are free
  -- (the owner's ruling, 2026-09-27), and so are uploaded and captured
  -- questions, which have plan limits of their own.
  IF _src = 'practice' AND COALESCE(_practice_mode, '') NOT IN ('recovery', 'revision', 'incorrect') THEN
    PERFORM public._premium_require(_uid, 'practice.question', 1);
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
      -- A brought question (an upload or a capture) is filed under ITS OWN
      -- topic, read from the caller's own row — as a bank attempt is filed
      -- under the bank's (20261127000000). The client's label, then the
      -- chapter, only for one with no topic.
      _topic := COALESCE(
        (SELECT t.name FROM public.student_upload_questions u JOIN public.topics t ON t.id = u.topic_id
          WHERE u.id = NULLIF(_generated_question->>'upload_question_id', '')::uuid AND u.owner_id = _uid),
        (SELECT t.name FROM public.student_capture_questions c JOIN public.topics t ON t.id = c.topic_id
          WHERE c.id = NULLIF(_generated_question->>'capture_question_id', '')::uuid AND c.owner_id = _uid),
        _topic, NULLIF(_generated_question->>'topic', ''), _chapter);
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
    hint_used, confidence, attempt_number, source, source_id,
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
  END IF;

  -- A wrong answer goes to the Mistake Book, and so does a right one the
  -- student marked as a guess (C2): it is not knowledge, so it belongs in
  -- recovery and revision with the wrong ones.
  _lucky := _resolved_correct AND public._marked_as_guess(_confidence);
  IF NOT COALESCE(_skipped, false) AND (NOT _resolved_correct OR _lucky) THEN
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
      NULLIF(_generated_question->>'upload_question_id', '')::uuid,
      NULL,
      _lucky
    );
    END IF;
  END IF;

  RETURN public._attempt_verdict(_aid);
END;
$function$;

-- ── 5. A mock paper: the same ───────────────────────────────────────────────
-- Mark a paper, once: each answer against the bank, a withdrawn question
-- voided, every wrong answer — and every right one marked as a guess (C2) —
-- into the Mistake Book as practice puts it there.
CREATE OR REPLACE FUNCTION public._mock_grade(_attempt uuid, _auto boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _a          public.mock_attempts%ROWTYPE;
  _p          public.mock_papers%ROWTYPE;
  _q          record;
  _g          record;
  _gradable   boolean;
  _chapter_id uuid;
  _correct    int := 0;
  _wrong      int := 0;
  _unanswered int := 0;
  _voided     int := 0;
BEGIN
  SELECT * INTO _a FROM public.mock_attempts a WHERE a.id = _attempt FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'mock_attempt_not_found' USING ERRCODE = 'P0002'; END IF;
  IF _a.submitted_at IS NOT NULL THEN RETURN; END IF;   -- already marked; marking is once
  SELECT * INTO _p FROM public.mock_papers WHERE id = _a.paper_id;

  FOR _q IN
    SELECT q.qid, q.ord, ans.choice, COALESCE(ans.guessed, false) AS guessed
      FROM unnest(_p.question_ids) WITH ORDINALITY AS q(qid, ord)
      LEFT JOIN public.mock_answers ans ON ans.attempt_id = _a.id AND ans.question_id = q.qid
     ORDER BY q.ord
  LOOP
    IF _q.choice IS NULL THEN
      _unanswered := _unanswered + 1;
      CONTINUE;
    END IF;

    _gradable := true;
    BEGIN
      SELECT * INTO _g
        FROM public._practice_grade_from_bank(_q.qid, jsonb_build_object('index', _q.choice));
      IF NOT FOUND THEN _gradable := false; END IF;
    EXCEPTION WHEN others THEN
      -- The only expected failure is a question that is no longer in the bank
      -- or no longer approved. Anything else is a real error and must not be
      -- swallowed into a quiet zero.
      IF SQLERRM <> 'bank_question_not_found' THEN RAISE; END IF;
      _gradable := false;
    END;

    IF NOT _gradable THEN
      _voided := _voided + 1;
      UPDATE public.mock_answers SET is_correct = NULL
       WHERE attempt_id = _a.id AND question_id = _q.qid;
      CONTINUE;
    END IF;

    UPDATE public.mock_answers SET is_correct = _g.is_correct
     WHERE attempt_id = _a.id AND question_id = _q.qid;

    IF _g.is_correct THEN
      _correct := _correct + 1;
    ELSE
      _wrong := _wrong + 1;
    END IF;
    IF NOT _g.is_correct OR _q.guessed THEN
      -- The chapter, from the question's own topic: §5.1 reads this ARGUMENT
      -- to decide whether the miss bumps mastery and joins revision.
      SELECT t.chapter_id INTO _chapter_id FROM public.topics t WHERE t.id = _g.topic_id;
      PERFORM public.rpc_record_concept_mistake(
        'practice', _a.id, _q.qid,
        COALESCE(_g.subject, _p.subject), _g.chapter,
        COALESCE(_g.topic, _g.chapter), COALESCE(_g.topic, _g.chapter),
        _g.class_level,
        COALESCE(_g.question_text, ''),
        COALESCE(_g.options, '[]'::jsonb),
        jsonb_build_object('index', _q.choice),
        _g.correct_answer,
        COALESCE(_g.explanation, ''),
        _chapter_id, NULL, NULL,
        _g.is_correct);
    END IF;
  END LOOP;

  UPDATE public.mock_attempts a
     SET submitted_at   = now(),
         auto_submitted = _auto,
         correct        = _correct,
         wrong          = _wrong,
         unanswered     = _unanswered,
         voided         = _voided,
         score          = _correct * a.marks_correct + _wrong * a.marks_wrong
   WHERE a.id = _a.id;
END $$;

-- ── 6. PROOF, as the caller, before COMMIT ──────────────────────────────────
-- Everything the proof writes is undone by the raise that ends its inner block.
DO $proof$
DECLARE
  _uid      uuid;
  _school   uuid;
  _exam     uuid;
  _claims   text;
  _q        record;
  _qs       uuid[] := '{}';
  _keys     int[] := '{}';
  _wrongs   int[] := '{}';
  _gqs      jsonb[] := '{}';
  _sess     uuid;
  _sess2    uuid;
  _paper    uuid;
  _att      uuid;
  _before   bigint;
  _after    bigint;
  _row      record;
  _sig      text := 'public.rpc_record_concept_mistake(text,uuid,uuid,text,text,text,text,integer,text,jsonb,jsonb,jsonb,text,uuid,uuid,uuid,boolean)';
BEGIN
  -- An exam account that has practised, and has a students row (so mastery
  -- and the revision queue are written for it).
  SELECT ea.account_id, ps.school_id, ea.exam_id INTO _uid, _school, _exam
    FROM public.exam_accounts ea
    JOIN public.practice_sessions ps ON ps.user_id = ea.account_id
   WHERE EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = ea.account_id)
   ORDER BY ps.created_at DESC
   LIMIT 1;
  IF _uid IS NULL THEN RAISE EXCEPTION 'VERIFY FAILED: no exam account with a practice session to prove with'; END IF;
  _claims := json_build_object('sub', _uid, 'role', 'authenticated')::text;

  -- Three live bank questions in a chapter, none of them in this student's book.
  FOR _q IN
    SELECT qb.id, qb.correct_index, qb.question, qb.options, t.chapter_id
      FROM public.question_bank qb
      JOIN public.topics t ON t.id = qb.topic_id
     WHERE qb.is_active AND qb.is_approved AND qb.correct_index IS NOT NULL
       AND jsonb_typeof(qb.options) = 'array' AND jsonb_array_length(qb.options) >= 2
       AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id = qb.id)
     ORDER BY qb.id
     LIMIT 3
  LOOP
    _qs := _qs || _q.id;
    _keys := _keys || _q.correct_index;
    _wrongs := _wrongs || ((_q.correct_index + 1) % jsonb_array_length(_q.options));
    _gqs := _gqs || jsonb_build_object('question', _q.question, 'options', _q.options, 'chapter_id', _q.chapter_id);
  END LOOP;
  IF cardinality(_qs) <> 3 THEN RAISE EXCEPTION 'VERIFY FAILED: found % questions to prove with, not 3', cardinality(_qs); END IF;

  BEGIN
    -- Mistake Book retries ('incorrect'), so the plan's daily allowance is not touched.
    INSERT INTO public.practice_sessions (user_id, subject, school_id, practice_mode)
    VALUES (_uid, 'Proof', _school, 'incorrect') RETURNING id INTO _sess;
    INSERT INTO public.practice_sessions (user_id, subject, school_id, practice_mode)
    VALUES (_uid, 'Proof', _school, 'incorrect') RETURNING id INTO _sess2;
    PERFORM set_config('request.jwt.claims', _claims, true);
    SELECT COALESCE(sum(cm.total_attempts), 0) INTO _before FROM public.concept_mastery cm WHERE cm.user_id = _uid;

    -- a. Right, marked as a guess. b. Right, the tap there and not used.
    -- c. Right, no tap offered (a session before it).
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_record_question_attempt(NULL, _gqs[1], true, jsonb_build_object('index', _keys[1]), _sess,
      0, false, NULL, 4000, _qs[1], false, 'practice', '{"confidence": 0, "practice_mode": "incorrect"}'::jsonb);
    PERFORM public.rpc_record_question_attempt(NULL, _gqs[2], true, jsonb_build_object('index', _keys[2]), _sess,
      0, false, NULL, 4000, _qs[2], false, 'practice', '{"confidence": 1, "practice_mode": "incorrect"}'::jsonb);
    PERFORM public.rpc_record_question_attempt(NULL, _gqs[3], true, jsonb_build_object('index', _keys[3]), _sess,
      0, false, NULL, 4000, _qs[3], false, 'practice', '{"practice_mode": "incorrect"}'::jsonb);
    RESET ROLE;

    SELECT * INTO _row FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id = _qs[1];
    IF _row.id IS NULL OR _row.status <> 'open' OR _row.times_wrong <> 0 OR _row.lucky_guesses <> 1
       OR (_row.student_answer->>'index')::int IS DISTINCT FROM _keys[1] THEN
      RAISE EXCEPTION 'VERIFY FAILED: a right answer marked as a guess did not open a lucky-guess row: %', to_jsonb(_row);
    END IF;
    IF EXISTS (SELECT 1 FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id IN (_qs[2], _qs[3])) THEN
      RAISE EXCEPTION 'VERIFY FAILED: a right answer not marked as a guess went to the Mistake Book';
    END IF;
    -- Each answer counted once in mastery: a lucky guess is not counted again as a wrong one.
    SELECT COALESCE(sum(cm.total_attempts), 0) INTO _after FROM public.concept_mastery cm WHERE cm.user_id = _uid;
    IF _after - _before <> 3 THEN
      RAISE EXCEPTION 'VERIFY FAILED: mastery counted % attempts for 3 answers', _after - _before;
    END IF;

    -- d. The same question answered wrong later: the same row, one wrong now.
    SET LOCAL ROLE authenticated;
    PERFORM public.rpc_record_question_attempt(NULL, _gqs[1], false, jsonb_build_object('index', _wrongs[1]), _sess2,
      0, false, NULL, 4000, _qs[1], false, 'practice', '{"confidence": 1, "practice_mode": "incorrect"}'::jsonb);
    RESET ROLE;
    SELECT * INTO _row FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id = _qs[1];
    IF _row.times_wrong <> 1 OR _row.lucky_guesses <> 1 OR (_row.student_answer->>'index')::int IS DISTINCT FROM _wrongs[1] THEN
      RAISE EXCEPTION 'VERIFY FAILED: a wrong answer after a lucky guess did not join its row: %', to_jsonb(_row);
    END IF;

    -- e. A mock paper: one right answer marked as a guess, one right without.
    INSERT INTO public.mock_papers (exam_id, subject, question_ids)
    VALUES (_exam, 'Proof', ARRAY[_qs[2], _qs[3]]) RETURNING id INTO _paper;
    INSERT INTO public.mock_attempts (paper_id, user_id, marks_correct, marks_wrong, deadline, total)
    VALUES (_paper, _uid, 5, -1, now() + interval '1 hour', 2) RETURNING id INTO _att;
    INSERT INTO public.mock_answers (attempt_id, question_id, choice, guessed)
    VALUES (_att, _qs[2], _keys[2], true), (_att, _qs[3], _keys[3], false);
    PERFORM public._mock_grade(_att, false);
    SELECT * INTO _row FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id = _qs[2];
    IF _row.id IS NULL OR _row.times_wrong <> 0 OR _row.lucky_guesses <> 1 THEN
      RAISE EXCEPTION 'VERIFY FAILED: a mock answer right by a guess did not open a lucky-guess row: %', to_jsonb(_row);
    END IF;
    IF EXISTS (SELECT 1 FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id = _qs[3]) THEN
      RAISE EXCEPTION 'VERIFY FAILED: a mock answer right without a guess went to the Mistake Book';
    END IF;
    IF (SELECT a.correct FROM public.mock_attempts a WHERE a.id = _att) <> 2 THEN
      RAISE EXCEPTION 'VERIFY FAILED: a lucky guess was not marked right on the paper';
    END IF;

    RAISE EXCEPTION 'proof-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proof-rollback' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM public.student_mistakes sm WHERE sm.user_id = _uid AND sm.question_id = ANY (_qs)) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the proof''s rows survived';
  END IF;

  -- The database's reading of the tap: 0 is a guess, and nothing else is.
  IF NOT public._marked_as_guess(0) OR public._marked_as_guess(1) OR public._marked_as_guess(NULL) THEN
    RAISE EXCEPTION 'VERIFY FAILED: _marked_as_guess reads the tap wrongly';
  END IF;

  -- A row needs a reason: no wrong answer and no lucky guess is refused.
  BEGIN
    UPDATE public.student_mistakes SET times_wrong = 0
     WHERE id = (SELECT id FROM public.student_mistakes WHERE lucky_guesses = 0 LIMIT 1);
    RAISE EXCEPTION 'VERIFY FAILED: a row with no wrong answer and no lucky guess was accepted';
  EXCEPTION WHEN check_violation THEN
    NULL;
  END;

  -- The recorder's grants are what they were.
  IF has_function_privilege('anon', _sig, 'EXECUTE') OR NOT has_function_privilege('authenticated', _sig, 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_record_concept_mistake grants changed';
  END IF;
END $proof$;

COMMIT;
