-- ===========================================================================
-- UPLOAD MISTAKES KNOW THEIR QUESTION
--
-- Binding: docs/custom-practice-upload-spec.md §9 / §9.1
--
-- Measured defect (2026-09-24):
--   Upload attempts write bank_question_id NULL (§9.1). rpc_record_concept_mistake
--   only stores question_id (bank), so the mistake row has null question_id even
--   when chapter_id is set (670). There is no pointer back to the private upload
--   original in student_upload_questions.
--
-- Fix (this migration only):
--   1. Nullable student_mistakes.upload_question_id → student_upload_questions
--      ON DELETE SET NULL
--   2. CHECK: at most one of question_id / upload_question_id
--      (question_id may be null when upload_question_id is set; both null = legacy)
--   3. rpc_record_concept_mistake accepts _upload_question_id; upsert on it
--   4. rpc_record_question_attempt passes generated_question.upload_question_id
--
-- Recovery plan / queue / trigger (`from_upload`, counting upload mistakes in
-- the ladder) is owned by a sibling — do not rewrite those here.
--
-- ROLLBACK: rollback/20261070000000_upload_mistakes_know_their_question.rollback.sql
-- ===========================================================================

BEGIN;

-- ── 1. Column + XOR check + upsert index ────────────────────────────────────
ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS upload_question_id uuid
    REFERENCES public.student_upload_questions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.student_mistakes.upload_question_id IS
  'Spec §9.1: private upload original. At most one of question_id (bank) / upload_question_id; both null allowed for legacy text-only rows.';

ALTER TABLE public.student_mistakes
  DROP CONSTRAINT IF EXISTS student_mistakes_question_xor_upload;

ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_question_xor_upload CHECK (
    num_nonnulls(question_id, upload_question_id) <= 1
  );

CREATE UNIQUE INDEX IF NOT EXISTS student_mistakes_user_source_upload_q
  ON public.student_mistakes (user_id, source, upload_question_id)
  WHERE upload_question_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS student_mistakes_upload_question_idx
  ON public.student_mistakes (upload_question_id)
  WHERE upload_question_id IS NOT NULL;

-- ── 2. Mistake writer: optional upload_question_id ──────────────────────────
-- Drop the 14-arg form (post-670) so the 15-arg form replaces it.
DROP FUNCTION IF EXISTS public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid
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
  _chapter_id uuid DEFAULT NULL::uuid,
  _upload_question_id uuid DEFAULT NULL::uuid
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
  _bank_qid uuid := _question_id;
  _up_qid uuid := _upload_question_id;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  -- Never store both; prefer bank when a caller hands over both by mistake.
  IF _bank_qid IS NOT NULL AND _up_qid IS NOT NULL THEN
    _up_qid := NULL;
  END IF;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  _src := CASE _assessment_type
    WHEN 'battle' THEN 'battleground'
    WHEN 'practice' THEN 'practice'
    WHEN 'upload' THEN 'upload'
    ELSE _assessment_type
  END;
  _atype := CASE WHEN _assessment_type = 'upload' THEN 'practice' ELSE _assessment_type END;

  IF _up_qid IS NOT NULL THEN
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, NULL, _up_qid, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      1, now()
    )
    ON CONFLICT (user_id, source, upload_question_id) WHERE upload_question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      chapter_id = COALESCE(student_mistakes.chapter_id, EXCLUDED.chapter_id),
      status = 'open', cleared_at = NULL
    RETURNING id INTO _mid;
  ELSE
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id, upload_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, _bank_qid, NULL, _chapter_id,
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
  END IF;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

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
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid
) TO authenticated;

-- ── 3. Attempt path: pass upload_question_id from generated_question ────────
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

  -- Idempotent: already passing the upload id as trailing arg.
  IF position(
       E'NULLIF(_generated_question->>''chapter_id'', '''')::uuid,\n'
       || E'      NULLIF(_generated_question->>''upload_question_id'', '''')::uuid'
       IN _def
     ) > 0 THEN
    RAISE NOTICE 'rpc_record_question_attempt already passes upload_question_id';
    RETURN;
  END IF;

  _new := replace(_def,
    '      _resolved_correct_answer,
      _explanation,
      NULLIF(_generated_question->>''chapter_id'', '''')::uuid
    );',
    '      _resolved_correct_answer,
      _explanation,
      NULLIF(_generated_question->>''chapter_id'', '''')::uuid,
      NULLIF(_generated_question->>''upload_question_id'', '''')::uuid
    );');

  IF _new = _def THEN
    RAISE EXCEPTION
      'mistake-call upload_question_id anchor matched nothing — live rpc_record_question_attempt changed shape; re-read with pg_get_functiondef';
  END IF;

  EXECUTE _new;
END $rewrite$;

-- ── 4. VERIFY (must be able to fail) ────────────────────────────────────────
DO $prove$
DECLARE
  _uid uuid;
  _school uuid;
  _chap uuid;
  _up uuid;
  _upload uuid;
  _id uuid;
  _got_up uuid;
  _both_ok boolean := false;
  _src text;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'student_mistakes'
       AND column_name = 'upload_question_id'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: upload_question_id column missing';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conname = 'student_mistakes_question_xor_upload'
  ) THEN
    RAISE EXCEPTION 'VERIFY FAILED: XOR check missing';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_concept_mistake'
   ORDER BY p.oid DESC LIMIT 1;
  IF position('_upload_question_id' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_record_concept_mistake ignores _upload_question_id';
  END IF;
  IF position('upload_question_id' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_record_concept_mistake does not write upload_question_id';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';
  IF position('NULLIF(_generated_question->>''upload_question_id'', '''')::uuid' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: attempt RPC does not pass upload_question_id';
  END IF;

  SELECT s.user_id, s.school_id INTO _uid, _school
    FROM public.students s
   WHERE s.user_id IS NOT NULL AND s.school_id IS NOT NULL
   LIMIT 1;
  SELECT c.id INTO _chap FROM public.chapters c LIMIT 1;
  SELECT u.id INTO _upload
    FROM public.student_uploads u
   WHERE u.owner_id IS NOT NULL
   LIMIT 1;
  SELECT q.id INTO _up
    FROM public.student_upload_questions q
   WHERE _upload IS NOT NULL AND q.upload_id = _upload
   LIMIT 1;

  IF _uid IS NULL OR _chap IS NULL THEN
    RAISE WARNING 'no student/chapter to probe; schema + bodies verified only';
    RETURN;
  END IF;

  -- Positive control: upload_question_id alone is accepted (question_id null).
  IF _up IS NOT NULL THEN
    INSERT INTO public.student_mistakes (
      user_id, school_id, source, subject, question_text, chapter_id, upload_question_id
    ) VALUES (
      _uid, _school, 'upload', '__probe_up_mist__', '__probe_up_mist__', _chap, _up
    )
    RETURNING id, upload_question_id INTO _id, _got_up;

    IF _got_up IS DISTINCT FROM _up THEN
      RAISE EXCEPTION 'VERIFY FAILED: probe upload_question_id expected %, got %', _up, _got_up;
    END IF;

    -- Positive control for XOR: both set must fail.
    BEGIN
      INSERT INTO public.student_mistakes (
        user_id, school_id, source, subject, question_text, chapter_id,
        question_id, upload_question_id
      ) VALUES (
        _uid, _school, 'upload', '__probe_xor__', '__probe_xor__', _chap,
        '00000000-0000-4000-8000-000000000001'::uuid, _up
      );
      _both_ok := true;
    EXCEPTION WHEN check_violation THEN
      _both_ok := false;
    END;
    IF _both_ok THEN
      RAISE EXCEPTION 'VERIFY FAILED: XOR check allowed both question_id and upload_question_id';
    END IF;

    DELETE FROM public.student_mistakes WHERE id = _id;
  ELSE
    RAISE WARNING 'no student_upload_questions row; skip insert probe';
  END IF;
END $prove$;

COMMIT;
