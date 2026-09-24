-- ===========================================================================
-- UPLOAD MISTAKES CARRY CHAPTER_ID
--
-- Binding: docs/custom-practice-upload-spec.md §9 / §9.1
--
-- Measured defect (code-trace, 2026-09-24):
--
--   1. question_attempts.source admits 'upload' (20261063000000), but
--      student_mistakes_source_check still only allows
--      test | battleground | exam | practice — so a real source='upload'
--      mistake INSERT is rejected.
--
--   2. rpc_record_question_attempt always calls rpc_record_concept_mistake
--      with the literal 'practice', so even when _source = 'upload' the
--      mistake row is filed as practice and cannot be told apart (§9.1).
--
--   3. chapter_id on generated_question is never read. rpc_record_concept_mistake
--      does not accept or write chapter_id; tg_student_mistakes_set_chapter_id
--      only looks up question_bank by question_id — and upload questions are
--      not in the bank (_bank_id is null). Recovery/revision key on
--      student_mistakes.chapter_id (§5 / §9); a free-text chapter name is not
--      enough. So the attempt→mistake path drops the one fact §9 needs.
--
-- Fix, as narrow as the rule: admit 'upload' on the mistake CHECK; pass
-- upload through as source (assessment_type stays 'practice' so that CHECK
-- is untouched); accept optional _chapter_id on the mistake writer; feed it
-- from generated_question->>'chapter_id' at the attempt call site.
--
-- ROLLBACK: supabase/migrations/rollback/20261067000000_upload_mistakes_carry_chapter_id.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. student_mistakes.source admits upload (§9.1) ─────────────────────────
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_source_check;
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_source_check
  CHECK (source = ANY (ARRAY['test', 'battleground', 'exam', 'practice', 'upload']));

-- ── 2. Mistake writer: source=upload + optional chapter_id ──────────────────
-- Drop the 13-arg form so the 14-arg form (trailing DEFAULT) replaces it.
-- Callers that omit _chapter_id still resolve via DEFAULT NULL.
DROP FUNCTION IF EXISTS public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text
);

CREATE OR REPLACE FUNCTION public.rpc_record_concept_mistake(
  _assessment_type text,
  _source_id uuid,
  _question_id uuid DEFAULT NULL::uuid,
  _subject text DEFAULT 'General'::text,
  _chapter text DEFAULT NULL::text,
  _concept text DEFAULT NULL::text,
  _subconcept text DEFAULT NULL::text,
  _class_level integer DEFAULT NULL::integer,
  _question_text text DEFAULT ''::text,
  _options jsonb DEFAULT '[]'::jsonb,
  _student_answer jsonb DEFAULT '{}'::jsonb,
  _correct_answer jsonb DEFAULT '{}'::jsonb,
  _explanation text DEFAULT NULL::text,
  _chapter_id uuid DEFAULT NULL::uuid
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid;
  _mid uuid;
  _concept_f text;
  _sub_f text;
  _src text;
  _atype text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  -- source vocabulary: battle→battleground; upload stays upload (§9.1).
  -- assessment_type CHECK still only admits practice|test|battle — map upload
  -- to practice there so we do not widen a second CHECK for one feature.
  _src := CASE _assessment_type
    WHEN 'battle' THEN 'battleground'
    WHEN 'practice' THEN 'practice'
    WHEN 'upload' THEN 'upload'
    ELSE _assessment_type
  END;
  _atype := CASE WHEN _assessment_type = 'upload' THEN 'practice' ELSE _assessment_type END;

  INSERT INTO public.student_mistakes (
    user_id, student_id, source, source_id, question_id, chapter_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at
  ) VALUES (
    _uid, _sid, _src, _source_id, _question_id, _chapter_id,
    _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
    _question_text, _options, _student_answer, _correct_answer, _explanation,
    1, now()
  )
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = student_mistakes.times_wrong + 1,
    last_wrong_at = now(),
    student_answer = EXCLUDED.student_answer,
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
    chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
    status = 'open', cleared_at = NULL
  RETURNING id INTO _mid;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  -- Upload feeds the same revision queue as practice (§9 downstream).
  IF _assessment_type IN ('practice', 'test', 'battle', 'upload') AND _sid IS NOT NULL THEN
    IF NOT EXISTS (
      SELECT 1 FROM public.revision_queue
      WHERE user_id = _uid AND NOT completed
        AND subject = _subject
        AND COALESCE(chapter, '') = COALESCE(_chapter, '')
        AND COALESCE(topic, '') = COALESCE(_concept_f, '')
    ) THEN
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _uid, _sid, _subject, _chapter, _concept_f,
        CASE _assessment_type
          WHEN 'practice' THEN 'practice_wrong'
          WHEN 'upload' THEN 'upload_wrong'
          ELSE _assessment_type || '_wrong'
        END,
        75, CURRENT_DATE
      );
    ELSE
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, 75),
        due_date = LEAST(due_date, CURRENT_DATE),
        reason = CASE _assessment_type
          WHEN 'practice' THEN 'practice_wrong'
          WHEN 'upload' THEN 'upload_wrong'
          ELSE _assessment_type || '_wrong'
        END
      WHERE user_id = _uid AND NOT completed
        AND subject = _subject
        AND COALESCE(chapter, '') = COALESCE(_chapter, '')
        AND COALESCE(topic, '') = COALESCE(_concept_f, '');
    END IF;
  END IF;

  RETURN _mid;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid
) TO authenticated;

-- ── 3. Attempt path: pass upload + chapter_id from generated_question ───────
DO $rewrite$
DECLARE
  _def text;
  _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_record_question_attempt';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_record_question_attempt not found';
  END IF;
  IF position(E'\r' IN _def) > 0 THEN
    RAISE EXCEPTION 'a carriage return survived normalisation';
  END IF;

  -- Already patched (idempotent re-run).
  IF position('CASE WHEN _src = ''upload'' THEN ''upload'' ELSE ''practice'' END' IN _def) > 0
     AND position('NULLIF(_generated_question->>''chapter_id'', '''')::uuid' IN _def) > 0 THEN
    RAISE NOTICE 'rpc_record_question_attempt already passes upload + chapter_id';
    RETURN;
  END IF;

  -- Live shape (post-bank/upload mistake id rewrite) uses _mistake_qid, not
  -- the older _bank_id-only call. Match what pg_get_functiondef returns.
  _new := replace(_def,
    '    PERFORM public.rpc_record_concept_mistake(
      ''practice'', _session_id, _mistake_qid,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>''question'', ''''),
      COALESCE(_generated_question->''options'', ''[]''::jsonb),
      COALESCE(_selected_answer, ''{}''::jsonb),
      _resolved_correct_answer,
      _explanation
    );',
    '    PERFORM public.rpc_record_concept_mistake(
      CASE WHEN _src = ''upload'' THEN ''upload'' ELSE ''practice'' END,
      _session_id, _mistake_qid,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>''question'', ''''),
      COALESCE(_generated_question->''options'', ''[]''::jsonb),
      COALESCE(_selected_answer, ''{}''::jsonb),
      _resolved_correct_answer,
      _explanation,
      NULLIF(_generated_question->>''chapter_id'', '''')::uuid
    );');

  IF _new = _def THEN
    RAISE EXCEPTION
      'mistake-call anchor matched nothing — live rpc_record_question_attempt changed shape; re-read with pg_get_functiondef';
  END IF;

  EXECUTE _new;
END $rewrite$;

-- ── 4. VERIFY (must be able to fail) ────────────────────────────────────────
DO $prove$
DECLARE
  _src text;
  _uid uuid;
  _school uuid;
  _chap uuid;
  _id uuid;
  _got_src text;
  _got_chap uuid;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_mistakes_source_check'
       AND pg_get_constraintdef(oid) ILIKE '%upload%'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: student_mistakes.source does not admit upload';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';
  IF position('CASE WHEN _src = ''upload'' THEN ''upload'' ELSE ''practice'' END' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: attempt RPC still hardcodes practice for mistakes';
  END IF;
  IF position('NULLIF(_generated_question->>''chapter_id'', '''')::uuid' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: attempt RPC does not pass generated_question.chapter_id';
  END IF;

  SELECT s.user_id, s.school_id INTO _uid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;
  SELECT c.id INTO _chap FROM public.chapters c LIMIT 1;

  IF _uid IS NULL OR _chap IS NULL THEN
    RAISE WARNING 'no student/chapter to probe; CHECK + body verified only';
    RETURN;
  END IF;

  -- Positive control: a direct INSERT with source=upload + chapter_id must land.
  -- (Fails if the CHECK still rejects upload, or chapter_id FK is wrong.)
  INSERT INTO public.student_mistakes (
    user_id, school_id, source, subject, question_text, chapter_id
  ) VALUES (
    _uid, _school, 'upload', '__probe_upload__', '__probe_upload__', _chap
  )
  RETURNING id, source, chapter_id INTO _id, _got_src, _got_chap;

  DELETE FROM public.student_mistakes WHERE id = _id;

  IF _got_src IS DISTINCT FROM 'upload' THEN
    RAISE EXCEPTION 'VERIFY FAILED: probe source expected upload, got %', _got_src;
  END IF;
  IF _got_chap IS DISTINCT FROM _chap THEN
    RAISE EXCEPTION 'VERIFY FAILED: probe chapter_id expected %, got %', _chap, _got_chap;
  END IF;
END $prove$;

COMMIT;
