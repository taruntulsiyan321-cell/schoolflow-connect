-- Bug #11 — every wrong practice answer double-applies the concept_mastery
-- update, inflating total_attempts (and, as of Slice 2, half_life_estimate /
-- forgetting_events_count) for every concept with any wrong answers.
--
-- Discovered by Slice 2's replay-verification diagnostic
-- (e2e/diag-retention-revision-slice2.spec.ts), which independently tracks
-- the exact correct/wrong sequence it sent and replays the half-life
-- formula step by step -- not just checking final state. On the 4th
-- attempt (a deliberate wrong answer after three correct ones), the
-- expected half_life was 3.24 * 0.3 = 0.972; the actual stored value was
-- 0.5 (the floor), which is exactly what two decay applications in a row
-- produce (0.972 * 0.3 = 0.2916, floored to 0.5). That mismatch is what
-- exposed this.
--
-- Root cause: rpc_record_question_attempt's wrong-answer branch (the
-- `ELSIF NOT COALESCE(_skipped, false)` branch) calls two things back to
-- back:
--   1. rpc_record_concept_mistake(...) -- which itself, unconditionally,
--      calls _upsert_concept_mastery(..., false, false) internally
--      (20260613000000_concept_mastery_recovery.sql line 358, unchanged
--      since that migration).
--   2. _upsert_concept_mastery(..., false, false) again, directly, with
--      identical arguments.
-- So every wrong answer applies the mastery update twice. Correct answers
-- are unaffected -- that branch calls _upsert_concept_mastery exactly once
-- (no call to rpc_record_concept_mistake at all).
--
-- This is not new: grepping every historical redefinition of
-- rpc_record_question_attempt shows the identical double-call pattern
-- mechanically copied forward, unchanged, through every single one --
-- 20260619000000_academic_intelligence_system.sql (the first version to
-- have this shape), 20260620000000, 20260621000000, 20260622000000,
-- 20260802200000, 20260802240000, 20260802250000, 20260802630000,
-- 20260804010000, and the current live 20260805020000. The bug has existed
-- since the concept-mastery system's inception on 2026-06-19.
--
-- Blast radius: concept_mastery.total_attempts is inflated for every
-- concept with any wrong answers (correct_attempts is untouched --
-- correct-answer path never double-calls). mastery_score, being derived
-- from total_attempts, inherits the error. mistake_count is unaffected --
-- it's a fresh COUNT(*) re-read each call, not an increment, so calling it
-- twice in a row is redundant but idempotent, not additive.
--
-- Data correction: NOT attempted here, deliberately. question_attempts
-- (the true, un-doubled append-only log) only exists from
-- 20260804010000_practice_engine_question_record.sql onward, so a precise
-- recompute of total_attempts is only possible for attempts recorded after
-- that date -- for the seven weeks of history before it (06-19 to 08-04),
-- the true wrong-answer count was never independently recorded anywhere,
-- and cannot be recovered. A partial correction (accurate post-08-04,
-- silently wrong pre-08-04) risks being more confusing than the current,
-- uniformly-documented inflation. This is a known data-quality caveat,
-- not resolved by this migration -- only the ongoing corruption is
-- stopped. A future dedicated task can decide whether a best-effort,
-- post-08-04-only correction is worth doing.
--
-- Fix: delete the redundant direct call. rpc_record_concept_mistake's own
-- internal call already does this exact update -- no other function calls
-- rpc_record_concept_mistake (confirmed via grep across supabase/migrations
-- and src/), so removing the duplicate here changes nothing else.
--
-- Reproduced verbatim from the live definition
-- (20260805020000_guard_refresh_academic_brain_bug9.sql) except for the
-- deletion of the three-line redundant call, marked below. Signature
-- unchanged on purpose -- this repo has hit a real outage before from
-- rpc_record_question_attempt signature drift creating an ambiguous
-- overload set for PostgREST.

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

  -- ▼ Practice Engine: project this attempt into current state.
  -- Runs for all three outcomes. Confidence is NOT computed here — it is
  -- recomputed once at session completion.
  IF _bank_id IS NOT NULL THEN
    PERFORM public._upsert_question_record(
      _uid, _sid, _school, _bank_id,
      CASE WHEN COALESCE(_skipped, false) THEN 'skipped'
           WHEN _resolved_correct THEN 'correct'
           ELSE 'wrong' END,
      _src, _practice_mode, _session_id, _time_taken_ms,
      COALESCE(_selected_answer, '{}'::jsonb)
    );
  END IF;
  -- ▲

  IF _resolved_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1,
          score = score + COALESCE(_resolved_score, 1)
      WHERE id = _session_id AND user_id = _uid;
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class, _subject, _chapter, _concept_f, _sub_f, true, false
    );
    -- ▼ Bug #9 fix: rpc_refresh_academic_brain() is not guaranteed to exist
    -- on every deployment (confirmed missing live). The other call site, in
    -- rpc_finish_practice_session, already guards this identical call the
    -- same way -- apply the same guard here so a missing/broken brain
    -- refresh can never abort attempt recording.
    BEGIN
      PERFORM public.rpc_refresh_academic_brain();
    EXCEPTION WHEN others THEN
      NULL;
    END;
    -- ▲
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
    -- ▼ Bug #11 fix: this used to be followed by a second, redundant direct
    -- call to public._upsert_concept_mastery(_uid, _sid, _class, _subject,
    -- _chapter, _concept_f, _sub_f, false, false) -- but
    -- rpc_record_concept_mistake already performs that exact call
    -- internally (20260613000000_concept_mastery_recovery.sql line 358).
    -- Deleted; every wrong answer was applying the mastery update twice.
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _aid,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>'question', ''),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _resolved_correct_answer,
      _explanation
    );
    -- ▲
  END IF;

  RETURN _aid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(
  jsonb, jsonb, boolean, jsonb, uuid, numeric, boolean, uuid, int, uuid, boolean, text, jsonb
) TO authenticated;
