-- =============================================================================
-- Practice Engine V1 — Question Record + Concept Confidence
-- =============================================================================
-- The Practice Engine becomes the single producer of student academic data.
-- Other modules (Recovery, Revision, Nova, Analysis, Teacher/Parent/Principal)
-- consume it; they never compute their own copies.
--
-- Role separation (these must never overlap):
--   question_attempts  = append-only audit log (every attempt, forever)
--   question_records   = current state (latest state per student per question)
--
-- Additive and backward-compatible:
--   * concept_mastery.mastery_score and its weighted producer are UNTOUCHED,
--     so Recovery / WeakConceptInsights keep their current numbers. The new
--     simple confidence lands in a separate, clearly-named column and the old
--     one is deprecated for removal once every consumer has migrated.
--   * rpc_refresh_academic_brain() is deliberately NOT changed here — that is
--     a performance change and must not share a commit with an architectural
--     one, or a regression could not be attributed to either.
-- =============================================================================

-- ── 1. Soft delete for questions ────────────────────────────────────────────
-- Questions must never be hard-deleted: Practice History, saved analysis
-- snapshots, Mistake Book and Bookmarks all reference them. Note that seed
-- migrations have historically run `DELETE FROM public.question_bank WHERE
-- source = '...'`, which is exactly the hazard this guards against.
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.question_bank.is_active IS
  'Soft delete. Set false to retire a question. Never hard-delete: student history references these rows.';

CREATE INDEX IF NOT EXISTS question_bank_active_filter_idx
  ON public.question_bank (subject, class_level, difficulty)
  WHERE is_approved AND is_active;

-- ── 2. question_records — current state, one row per (user, question) ────────
-- Stores STUDENT STATE only. Immutable question facts (subject/chapter/topic/
-- concept/difficulty/board/class/stream/correct answer) live in question_bank
-- and are joined on read — duplicating them here would drift whenever a
-- question is corrected or recategorised.
CREATE TABLE IF NOT EXISTS public.question_records (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  school_id uuid REFERENCES public.schools(id),

  -- RESTRICT, never CASCADE: a content operation must not be able to destroy
  -- a student's practice history.
  question_id uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE RESTRICT,

  current_status text NOT NULL
    CHECK (current_status IN ('correct', 'wrong', 'skipped')),
  bookmarked boolean NOT NULL DEFAULT false,

  attempt_count int NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  correct_count int NOT NULL DEFAULT 0 CHECK (correct_count >= 0),
  wrong_count   int NOT NULL DEFAULT 0 CHECK (wrong_count >= 0),
  skipped_count int NOT NULL DEFAULT 0 CHECK (skipped_count >= 0),

  question_source text NOT NULL DEFAULT 'practice'
    CHECK (question_source IN (
      'practice', 'battleground', 'teacher_test', 'homework',
      'pyq', 'revision', 'recovery'
    )),

  last_practice_mode text,
  last_session_id uuid REFERENCES public.practice_sessions(id) ON DELETE SET NULL,
  last_time_taken_ms int,
  last_selected_option jsonb,
  last_practiced_date timestamptz NOT NULL DEFAULT now(),

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT question_records_counter_sum
    CHECK (attempt_count = correct_count + wrong_count + skipped_count)
);

COMMENT ON TABLE public.question_records IS
  'Student latest state per question. Historical attempts remain in question_attempts and are never deleted.';

CREATE UNIQUE INDEX IF NOT EXISTS question_records_user_question_uidx
  ON public.question_records (user_id, question_id);
CREATE INDEX IF NOT EXISTS question_records_user_status_idx
  ON public.question_records (user_id, current_status);
CREATE INDEX IF NOT EXISTS question_records_user_bookmarked_idx
  ON public.question_records (user_id) WHERE bookmarked;
CREATE INDEX IF NOT EXISTS question_records_user_source_idx
  ON public.question_records (user_id, question_source);
CREATE INDEX IF NOT EXISTS question_records_school_idx
  ON public.question_records (school_id);

ALTER TABLE public.question_records ENABLE ROW LEVEL SECURITY;

-- Mirrors the concept_mastery self/parent/staff triad exactly.
DROP POLICY IF EXISTS "qrec self" ON public.question_records;
CREATE POLICY "qrec self" ON public.question_records
  FOR ALL TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "qrec parent" ON public.question_records;
CREATE POLICY "qrec parent" ON public.question_records
  FOR SELECT TO authenticated USING (
    EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = question_records.user_id
        AND s.parent_user_id = auth.uid()
    )
  );

DROP POLICY IF EXISTS "qrec teacher" ON public.question_records;
CREATE POLICY "qrec teacher" ON public.question_records
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = question_records.user_id
        AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── 3. concept_mastery — additive confidence columns ────────────────────────
-- mastery_score (weighted composite) is intentionally left in place and still
-- written by _upsert_concept_mastery, so existing consumers are unaffected.
-- A simple correct/attempted ratio is CONFIDENCE, not mastery, so it gets its
-- own correctly-named column rather than silently changing what an existing
-- field means.
ALTER TABLE public.concept_mastery
  ADD COLUMN IF NOT EXISTS confidence_score numeric
    CHECK (confidence_score IS NULL OR (confidence_score >= 0 AND confidence_score <= 100));

COMMENT ON COLUMN public.concept_mastery.confidence_score IS
  'V1 confidence = correct/attempted*100 over question_records. Written only by _recompute_concept_confidence_for_session at session end.';

COMMENT ON COLUMN public.concept_mastery.mastery_score IS
  'DEPRECATED (weighted composite). Retained for Recovery/Revision/Nova until every consumer migrates to confidence_score, then removed.';

-- Generated column: classification can never drift from confidence_score,
-- because no code path is able to write it. Thresholds live in exactly one
-- place — this definition.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'concept_mastery'
      AND column_name = 'classification'
  ) THEN
    ALTER TABLE public.concept_mastery
      ADD COLUMN classification text
      GENERATED ALWAYS AS (
        CASE
          WHEN confidence_score IS NULL THEN NULL
          WHEN confidence_score >= 80 THEN 'strong'
          WHEN confidence_score >= 60 THEN 'normal'
          ELSE 'weak'
        END
      ) STORED;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS concept_mastery_user_classification_idx
  ON public.concept_mastery (user_id, classification);

-- ── 4. practice_sessions — how the session ended ────────────────────────────
ALTER TABLE public.practice_sessions
  ADD COLUMN IF NOT EXISTS ended_normally boolean,
  ADD COLUMN IF NOT EXISTS ended_by_user boolean;

COMMENT ON COLUMN public.practice_sessions.ended_normally IS
  'True when the session reached its goal or was ended cleanly; false/NULL distinguishes timeouts and dropped connections.';

-- ── 5. _upsert_question_record ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._upsert_question_record(
  _uid uuid,
  _sid uuid,
  _school uuid,
  _question_id uuid,
  _status text,
  _source text DEFAULT 'practice',
  _practice_mode text DEFAULT NULL,
  _session_id uuid DEFAULT NULL,
  _time_taken_ms int DEFAULT NULL,
  _selected_option jsonb DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _src text := COALESCE(NULLIF(trim(_source), ''), 'practice');
BEGIN
  IF _uid IS NULL OR _question_id IS NULL THEN RETURN; END IF;
  IF _status NOT IN ('correct', 'wrong', 'skipped') THEN RETURN; END IF;

  -- question_source is CHECK-constrained; fall back rather than raise so a
  -- caller passing an unmapped source can never break attempt recording.
  IF _src NOT IN ('practice','battleground','teacher_test','homework','pyq','revision','recovery') THEN
    _src := 'practice';
  END IF;

  INSERT INTO public.question_records (
    user_id, student_id, school_id, question_id,
    current_status, attempt_count,
    correct_count, wrong_count, skipped_count,
    question_source, last_practice_mode, last_session_id,
    last_time_taken_ms, last_selected_option, last_practiced_date
  ) VALUES (
    _uid, _sid, _school, _question_id,
    _status, 1,
    CASE WHEN _status = 'correct' THEN 1 ELSE 0 END,
    CASE WHEN _status = 'wrong'   THEN 1 ELSE 0 END,
    CASE WHEN _status = 'skipped' THEN 1 ELSE 0 END,
    _src, _practice_mode, _session_id,
    _time_taken_ms, _selected_option, now()
  )
  ON CONFLICT (user_id, question_id) DO UPDATE SET
    -- latest result always wins
    current_status = EXCLUDED.current_status,
    attempt_count  = question_records.attempt_count + 1,
    correct_count  = question_records.correct_count
                     + CASE WHEN EXCLUDED.current_status = 'correct' THEN 1 ELSE 0 END,
    wrong_count    = question_records.wrong_count
                     + CASE WHEN EXCLUDED.current_status = 'wrong' THEN 1 ELSE 0 END,
    skipped_count  = question_records.skipped_count
                     + CASE WHEN EXCLUDED.current_status = 'skipped' THEN 1 ELSE 0 END,
    question_source      = EXCLUDED.question_source,
    last_practice_mode   = EXCLUDED.last_practice_mode,
    last_session_id      = EXCLUDED.last_session_id,
    last_time_taken_ms   = EXCLUDED.last_time_taken_ms,
    last_selected_option = EXCLUDED.last_selected_option,
    last_practiced_date  = now(),
    student_id           = COALESCE(EXCLUDED.student_id, question_records.student_id),
    school_id            = COALESCE(EXCLUDED.school_id, question_records.school_id),
    updated_at           = now();
    -- bookmarked is deliberately absent: re-practising must never clear a bookmark.
END;
$$;

GRANT EXECUTE ON FUNCTION public._upsert_question_record(
  uuid, uuid, uuid, uuid, text, text, text, uuid, int, jsonb
) TO authenticated;

-- ── 6. rpc_toggle_question_bookmark ─────────────────────────────────────────
-- Bookmarks are permanent and independent of correctness — only the student
-- adds or removes them.
CREATE OR REPLACE FUNCTION public.rpc_toggle_question_bookmark(
  _question_id uuid,
  _bookmarked boolean
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _school uuid;
  _rows int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  UPDATE public.question_records
  SET bookmarked = _bookmarked, updated_at = now()
  WHERE user_id = _uid AND question_id = _question_id;

  GET DIAGNOSTICS _rows = ROW_COUNT;
  IF _rows > 0 THEN RETURN _bookmarked; END IF;

  -- Allow bookmarking a question that has never been attempted (e.g. browsing
  -- a question set). It is seeded as skipped with zero attempts, so it does
  -- not pollute Skipped Practice, whose reads require attempt_count > 0.
  IF _bookmarked THEN
    SELECT id, school_id INTO _sid, _school
    FROM public.students WHERE user_id = _uid LIMIT 1;

    INSERT INTO public.question_records (
      user_id, student_id, school_id, question_id,
      current_status, attempt_count, correct_count, wrong_count, skipped_count,
      bookmarked
    ) VALUES (
      _uid, _sid, _school, _question_id,
      'skipped', 0, 0, 0, 0,
      true
    )
    ON CONFLICT (user_id, question_id) DO UPDATE
      SET bookmarked = true, updated_at = now();
  END IF;

  RETURN _bookmarked;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_toggle_question_bookmark(uuid, boolean) TO authenticated;

-- ── 7. _recompute_concept_confidence_for_session ────────────────────────────
-- Confidence is recomputed ONCE, at session completion — never per question.
-- An abandoned session never reaches rpc_finish_practice_session, so it never
-- contributes to confidence.
--
-- Aggregates over question_records (current state), not question_attempts, so
-- a student who fixes a mistake sees confidence rise rather than being held
-- down by historical wrong attempts. Skipped questions are excluded entirely.
CREATE OR REPLACE FUNCTION public._recompute_concept_confidence_for_session(
  _session_id uuid
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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
    -- Concept grain touched by this session, matching concept_mastery's key.
    SELECT DISTINCT
      COALESCE(qb.subject, 'General')                             AS subject,
      qb.chapter                                                  AS chapter,
      COALESCE(qb.concept, qb.chapter, qb.subject)                AS concept,
      COALESCE(qb.subconcept, qb.concept, qb.chapter, qb.subject) AS subconcept
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
    WHERE qa.session_id = _session_id
      AND qa.user_id = _uid
      AND qa.bank_question_id IS NOT NULL
  ),
  agg AS (
    -- Confidence spans ALL of the student's records for each touched concept,
    -- not just this session, so fixing an old mistake raises the score.
    SELECT
      t.subject, t.chapter, t.concept, t.subconcept,
      max(qb.class_level)                                        AS class_level,
      count(*) FILTER (
        WHERE qr.current_status IN ('correct', 'wrong') AND qr.attempt_count > 0
      )::int                                                     AS attempted,
      count(*) FILTER (
        WHERE qr.current_status = 'correct' AND qr.attempt_count > 0
      )::int                                                     AS correct
    FROM touched t
    JOIN public.question_bank qb
      ON COALESCE(qb.subject, 'General') = t.subject
     AND qb.chapter IS NOT DISTINCT FROM t.chapter
     AND COALESCE(qb.concept, qb.chapter, qb.subject) = t.concept
     AND COALESCE(qb.subconcept, qb.concept, qb.chapter, qb.subject) = t.subconcept
    JOIN public.question_records qr
      ON qr.question_id = qb.id AND qr.user_id = _uid
    GROUP BY t.subject, t.chapter, t.concept, t.subconcept
  )
  INSERT INTO public.concept_mastery AS cm (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    confidence_score, total_attempts, correct_attempts, last_attempt_at, updated_at
  )
  SELECT
    _uid, _sid, a.class_level, a.subject, a.chapter, a.concept, a.subconcept,
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
$$;

GRANT EXECUTE ON FUNCTION public._recompute_concept_confidence_for_session(uuid) TO authenticated;

-- ── 8. Wire into rpc_record_question_attempt (per answer) ───────────────────
-- CREATE OR REPLACE re-declaring the EXACT 13-arg signature from
-- 20260802630000_unify_rpc_record_question_attempt.sql. Do not change argument
-- names, order, or defaults: signature drift here re-creates the historical
-- "Could not choose the best candidate function between THREE overloads"
-- outage that blocked all practice submissions.
--
-- Only ONE change vs. that version: the _upsert_question_record call below.
-- The mastery/mistake block and rpc_refresh_academic_brain() are untouched.
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

-- ── 9. Wire into rpc_finish_practice_session (session end) ──────────────────
-- Adds two optional args. Every prior overload is dropped first (mirroring the
-- remediation in 20260802630000) so PostgREST can never face an ambiguous
-- candidate set — the failure mode this codebase has already hit once.
DO $$
DECLARE r record;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure AS sig
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'rpc_finish_practice_session'
  LOOP
    EXECUTE 'DROP FUNCTION IF EXISTS ' || r.sig;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(
  _session_id uuid,
  _attempts jsonb DEFAULT NULL,
  _ended_by_user boolean DEFAULT NULL,
  _ended_normally boolean DEFAULT true
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
  _xp := GREATEST(_correct, 0) * 5 + CASE WHEN NOT _already THEN 25 ELSE 0 END;

  UPDATE public.practice_sessions ps
  SET
    correct_count = _correct,
    score = _correct,
    skipped_count = _skipped,
    wrong_count = _wrong,
    total_time_ms = NULLIF(_time_ms, 0),
    accuracy = CASE WHEN _total > 0 THEN round((_correct::numeric / _total) * 100, 2) ELSE 0 END,
    question_count = CASE WHEN _total > 0 THEN _total ELSE ps.question_count END,
    xp_earned = CASE WHEN ps.finished_at IS NULL THEN _xp ELSE COALESCE(ps.xp_earned, _xp) END,
    finished_at = COALESCE(ps.finished_at, now()),
    ended_by_user = COALESCE(ps.ended_by_user, _ended_by_user),
    ended_normally = COALESCE(ps.ended_normally, _ended_normally)
  WHERE ps.id = _session_id AND ps.user_id = auth.uid()
  RETURNING ps.* INTO _s;

  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  IF NOT _already THEN
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

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'correct_count', _correct,
    'wrong_count', _wrong,
    'skipped_count', _skipped,
    'total', _total,
    'xp_earned', COALESCE(_s.xp_earned, _xp),
    'accuracy', _s.accuracy,
    'finished_at', _s.finished_at,
    'already_finished', _already,
    'progression', _prog
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid, jsonb, boolean, boolean)
  TO authenticated;

-- ── 10. Backfill from the existing attempt log ──────────────────────────────
-- Existing students must not appear to lose their Mistake Book, Incorrect,
-- Skipped or confidence data. Counters are derived consistently so the
-- attempt_count = correct + wrong + skipped constraint holds by construction.
WITH eligible AS (
  SELECT qa.*
  FROM public.question_attempts qa
  WHERE qa.bank_question_id IS NOT NULL
    AND qa.user_id IS NOT NULL
    AND EXISTS (SELECT 1 FROM public.question_bank qb WHERE qb.id = qa.bank_question_id)
),
counts AS (
  -- The three buckets are mutually exclusive AND exhaustive (note the
  -- COALESCE on is_correct: a NULL would otherwise land in no bucket and
  -- violate the attempt_count = correct+wrong+skipped constraint).
  SELECT
    user_id,
    bank_question_id,
    count(*)::int AS total,
    count(*) FILTER (
      WHERE COALESCE(is_correct, false) AND NOT COALESCE(skipped, false)
    )::int AS n_correct,
    count(*) FILTER (
      WHERE NOT COALESCE(is_correct, false) AND NOT COALESCE(skipped, false)
    )::int AS n_wrong,
    count(*) FILTER (WHERE COALESCE(skipped, false))::int AS n_skipped,
    min(created_at) AS first_at
  FROM eligible
  GROUP BY user_id, bank_question_id
),
latest AS (
  SELECT DISTINCT ON (user_id, bank_question_id) *
  FROM eligible
  ORDER BY user_id, bank_question_id, created_at DESC
)
INSERT INTO public.question_records (
  user_id, student_id, school_id, question_id,
  current_status, attempt_count, correct_count, wrong_count, skipped_count,
  question_source, last_practice_mode, last_session_id,
  last_time_taken_ms, last_selected_option, last_practiced_date, created_at
)
SELECT
  l.user_id,
  l.student_id,
  l.school_id,
  l.bank_question_id,
  CASE
    WHEN COALESCE(l.skipped, false) THEN 'skipped'
    WHEN COALESCE(l.is_correct, false) THEN 'correct'
    ELSE 'wrong'
  END,
  c.total, c.n_correct, c.n_wrong, c.n_skipped,
  CASE
    WHEN l.source IN ('practice','battleground','teacher_test','homework','pyq','revision','recovery')
      THEN l.source
    ELSE 'practice'
  END,
  l.practice_mode,
  -- Resolve through practice_sessions so a since-deleted session becomes NULL
  -- rather than failing the FK and aborting the whole backfill.
  (SELECT ps.id FROM public.practice_sessions ps WHERE ps.id = l.session_id),
  l.time_taken_ms,
  l.selected_answer,
  l.created_at,
  c.first_at
FROM latest l
JOIN counts c
  ON c.user_id = l.user_id
 AND c.bank_question_id = l.bank_question_id
ON CONFLICT (user_id, question_id) DO NOTHING;

-- Seed confidence from the backfilled records (same simple formula).
WITH agg AS (
  SELECT
    qr.user_id,
    max(qr.student_id::text)::uuid                              AS student_id,
    COALESCE(qb.subject, 'General')                             AS subject,
    qb.chapter                                                  AS chapter,
    COALESCE(qb.concept, qb.chapter, qb.subject)                AS concept,
    COALESCE(qb.subconcept, qb.concept, qb.chapter, qb.subject) AS subconcept,
    max(qb.class_level)                                         AS class_level,
    count(*) FILTER (WHERE qr.current_status IN ('correct','wrong') AND qr.attempt_count > 0)::int AS attempted,
    count(*) FILTER (WHERE qr.current_status = 'correct')::int  AS correct
  FROM public.question_records qr
  JOIN public.question_bank qb ON qb.id = qr.question_id
  GROUP BY qr.user_id, COALESCE(qb.subject,'General'), qb.chapter,
           COALESCE(qb.concept, qb.chapter, qb.subject),
           COALESCE(qb.subconcept, qb.concept, qb.chapter, qb.subject)
)
INSERT INTO public.concept_mastery AS cm (
  user_id, student_id, class_level, subject, chapter, concept, subconcept,
  confidence_score, total_attempts, correct_attempts, last_attempt_at, updated_at
)
SELECT
  a.user_id, a.student_id, a.class_level, a.subject, a.chapter, a.concept, a.subconcept,
  round((a.correct::numeric / a.attempted) * 100, 1),
  a.attempted, a.correct, now(), now()
FROM agg a
WHERE a.attempted > 0
ON CONFLICT (user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, ''))
DO UPDATE SET
  confidence_score = EXCLUDED.confidence_score,
  updated_at       = now();
