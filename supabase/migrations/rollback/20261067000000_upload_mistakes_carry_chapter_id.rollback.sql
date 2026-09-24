-- Rollback for 20261067000000_upload_mistakes_carry_chapter_id.sql
--
-- Restores student_mistakes.source without 'upload', restores the 13-arg
-- rpc_record_concept_mistake body from 20260926000000, and strips the
-- upload/chapter_id arguments from the attempt→mistake call site.
--
-- Rows already written with source='upload' must be remapped first or the
-- CHECK re-add will fail.

BEGIN;

UPDATE public.student_mistakes SET source = 'practice' WHERE source = 'upload';

ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_source_check;
ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_source_check
  CHECK (source = ANY (ARRAY['test', 'battleground', 'exam', 'practice']));

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
  _explanation text DEFAULT NULL::text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  INSERT INTO public.student_mistakes (
    user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at
  ) VALUES (
    _uid, _sid,
    CASE _assessment_type
      WHEN 'battle' THEN 'battleground'
      WHEN 'practice' THEN 'practice'
      ELSE _assessment_type
    END,
    _source_id, _question_id,
    _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _assessment_type,
    _question_text, _options, _student_answer, _correct_answer, _explanation,
    1, now()
  )
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = student_mistakes.times_wrong + 1,
    last_wrong_at = now(),
    student_answer = EXCLUDED.student_answer,
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
    status = 'open', cleared_at = NULL
  RETURNING id INTO _mid;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  IF _assessment_type IN ('practice', 'test', 'battle') AND _sid IS NOT NULL THEN
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
        CASE _assessment_type WHEN 'practice' THEN 'practice_wrong' ELSE _assessment_type || '_wrong' END,
        75, CURRENT_DATE
      );
    ELSE
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, 75),
        due_date = LEAST(due_date, CURRENT_DATE),
        reason = CASE _assessment_type WHEN 'practice' THEN 'practice_wrong' ELSE _assessment_type || '_wrong' END
      WHERE user_id = _uid AND NOT completed
        AND subject = _subject
        AND COALESCE(chapter, '') = COALESCE(_chapter, '')
        AND COALESCE(topic, '') = COALESCE(_concept_f, '');
    END IF;
  END IF;

  RETURN _mid;
END; $fn$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text
) TO authenticated;

DO $rewrite$
DECLARE _def text; _new text;
BEGIN
  SELECT replace(pg_get_functiondef(p.oid), E'\r\n', E'\n') INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_record_question_attempt';
  IF _def IS NULL THEN RETURN; END IF;

  _new := replace(_def,
    '    PERFORM public.rpc_record_concept_mistake(
      CASE WHEN _src = ''upload'' THEN ''upload'' ELSE ''practice'' END,
      _session_id, _bank_id,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>''question'', ''''),
      COALESCE(_generated_question->''options'', ''[]''::jsonb),
      COALESCE(_selected_answer, ''{}''::jsonb),
      _resolved_correct_answer,
      _explanation,
      NULLIF(_generated_question->>''chapter_id'', '''')::uuid
    );',
    '    PERFORM public.rpc_record_concept_mistake(
      ''practice'', _session_id, _bank_id,
      _subject, _chapter, _concept_f, _sub_f, _class,
      COALESCE(_generated_question->>''question'', ''''),
      COALESCE(_generated_question->''options'', ''[]''::jsonb),
      COALESCE(_selected_answer, ''{}''::jsonb),
      _resolved_correct_answer,
      _explanation
    );');

  IF _new = _def THEN
    RAISE WARNING 'upload/chapter_id call site not found — body may already be rolled back';
  ELSE
    EXECUTE _new;
  END IF;
END $rewrite$;

COMMIT;
