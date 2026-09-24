-- Rollback for 20261070000000_upload_mistakes_know_their_question.sql
--
-- Restores the post-670 14-arg rpc_record_concept_mistake (chapter_id only),
-- strips upload_question_id from the attempt→mistake call site, and drops the
-- column / XOR check / indexes.

BEGIN;

-- ── 1. Strip trailing upload_question_id arg from attempt→mistake call ──────
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

  IF position(
       'NULLIF(_generated_question->>''upload_question_id'', '''')::uuid' IN _def
     ) = 0 THEN
    RAISE NOTICE 'attempt RPC already lacks upload_question_id arg';
    RETURN;
  END IF;

  _new := replace(_def,
    '      _resolved_correct_answer,
      _explanation,
      NULLIF(_generated_question->>''chapter_id'', '''')::uuid,
      NULLIF(_generated_question->>''upload_question_id'', '''')::uuid
    );',
    '      _resolved_correct_answer,
      _explanation,
      NULLIF(_generated_question->>''chapter_id'', '''')::uuid
    );');

  IF _new = _def THEN
    RAISE EXCEPTION
      'rollback upload_question_id anchor matched nothing — re-read live rpc_record_question_attempt';
  END IF;

  EXECUTE _new;
END $rewrite$;

-- ── 2. Restore 14-arg mistake writer (post-670) ─────────────────────────────
DROP FUNCTION IF EXISTS public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid
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

-- ── 3. Drop indexes, CHECK, column ──────────────────────────────────────────
DROP INDEX IF EXISTS public.student_mistakes_user_source_upload_q;
DROP INDEX IF EXISTS public.student_mistakes_upload_question_idx;

ALTER TABLE public.student_mistakes
  DROP CONSTRAINT IF EXISTS student_mistakes_question_xor_upload;

ALTER TABLE public.student_mistakes
  DROP COLUMN IF EXISTS upload_question_id;

-- ── 4. VERIFY rollback ──────────────────────────────────────────────────────
DO $prove$
DECLARE
  _src text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'student_mistakes'
       AND column_name = 'upload_question_id'
  ) THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: upload_question_id still present';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_question_attempt';
  IF position('NULLIF(_generated_question->>''upload_question_id'', '''')::uuid' IN _src) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: attempt RPC still passes upload_question_id';
  END IF;

  SELECT replace(prosrc, E'\r\n', E'\n') INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_concept_mistake'
   ORDER BY p.oid DESC LIMIT 1;
  IF position('_upload_question_id' IN _src) > 0 THEN
    RAISE EXCEPTION 'ROLLBACK VERIFY FAILED: mistake RPC still has _upload_question_id';
  END IF;
END $prove$;

COMMIT;
