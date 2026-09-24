-- ===========================================================================
-- UNTAGGED MISTAKES SKIP REVISION / MASTERY
--
-- Binding: docs/custom-practice-upload-spec.md §5.1
--          docs/screen-capture-mistakes-spec.md §7.2 / §7.4
--
-- Measured defect: rpc_record_concept_mistake (770) always upserts concept
-- mastery and revision_queue for screen_capture / upload, even when
-- chapter_id IS NULL. Spec §5.1: untagged questions stay practisable but are
-- EXCLUDED from recovery and revision — a guessed chapter is worse than none.
-- Screen-capture Stage 1 writes subject '' (not 'General') when the bank
-- does not match; the old 'General' + null chapter path also poisoned the
-- revision queue and was filtered out of the Mistake Book.
--
-- Fix: only call _upsert_concept_mastery and revision_queue when
-- _chapter_id IS NOT NULL.
--
-- ROLLBACK: rollback/20261079000000_untagged_mistakes_skip_revision.rollback.sql
-- ===========================================================================

BEGIN;

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
  _upload_question_id uuid DEFAULT NULL::uuid,
  _capture_question_id uuid DEFAULT NULL::uuid
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
  _cap_qid uuid := _capture_question_id;
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
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, NULL, NULL, _cap_qid, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      1, now()
    )
    ON CONFLICT (user_id, source, capture_question_id)
      WHERE capture_question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
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
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, NULL, _up_qid, NULL, _chapter_id,
      _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _atype,
      _question_text, _options, _student_answer, _correct_answer, _explanation,
      1, now()
    )
    ON CONFLICT (user_id, source, upload_question_id)
      WHERE upload_question_id IS NOT NULL DO UPDATE SET
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
      user_id, student_id, source, source_id, question_id, upload_question_id,
      capture_question_id, chapter_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation,
      times_wrong, last_wrong_at
    ) VALUES (
      _uid, _sid, _src, _source_id, _bank_qid, NULL, NULL, _chapter_id,
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

  -- §5.1 — no chapter_id ⇒ no mastery bump and no revision_queue row.
  IF _chapter_id IS NOT NULL THEN
    PERFORM public._upsert_concept_mastery(
      _uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

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
            WHEN 'screen_capture' THEN 'screen_capture_wrong'
            ELSE _assessment_type || '_wrong'
          END
        WHERE user_id = _uid AND NOT completed
          AND subject = _subject
          AND COALESCE(chapter, '') = COALESCE(_chapter, '')
          AND COALESCE(topic, '') = COALESCE(_concept_f, '');
      END IF;
    END IF;
  END IF;

  RETURN _mid;
END;
$fn$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(
  text, uuid, uuid, text, text, text, text, integer, text, jsonb, jsonb, jsonb, text, uuid, uuid, uuid
) TO authenticated;

DO $verify$
DECLARE
  _src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_record_concept_mistake'
     AND pg_get_function_identity_arguments(p.oid) LIKE '%_capture_question_id%';
  IF _src IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: 16-arg rpc_record_concept_mistake missing';
  END IF;
  IF position('IF _chapter_id IS NOT NULL THEN' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: untagged gate on chapter_id missing';
  END IF;
  IF position('_upsert_concept_mastery' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: mastery upsert missing inside chapter gate';
  END IF;
END;
$verify$;

COMMIT;
