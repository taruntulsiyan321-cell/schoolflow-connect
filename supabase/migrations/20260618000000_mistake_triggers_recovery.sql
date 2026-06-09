-- Wrong answers immediately queue recovery assignments (not only at session end)

CREATE OR REPLACE FUNCTION public.rpc_record_concept_mistake(
  _assessment_type text,
  _source_id uuid,
  _question_id uuid DEFAULT NULL,
  _subject text DEFAULT 'General',
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _class_level int DEFAULT NULL,
  _question_text text DEFAULT '',
  _options jsonb DEFAULT '[]'::jsonb,
  _student_answer jsonb DEFAULT '{}'::jsonb,
  _correct_answer jsonb DEFAULT '{}'::jsonb,
  _explanation text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
  _mastery numeric;
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
    mastered = false
  RETURNING id INTO _mid;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  IF _assessment_type IN ('practice', 'dpp', 'battle') AND _sid IS NOT NULL THEN
    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    VALUES (
      _uid, _sid, _subject, _chapter, _concept_f,
      CASE _assessment_type WHEN 'practice' THEN 'practice_wrong' ELSE _assessment_type || '_wrong' END,
      75, CURRENT_DATE
    );
  END IF;

  SELECT mastery_score INTO _mastery FROM public.concept_mastery
  WHERE user_id = _uid AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND concept = _concept_f
  LIMIT 1;

  IF _assessment_type IN ('practice', 'dpp', 'battle') THEN
    PERFORM public.rpc_assign_concept_recovery(
      _subject, _chapter, _concept_f, _sub_f,
      COALESCE(_mastery, 35),
      _assessment_type, _source_id
    );
  END IF;

  RETURN _mid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(text, uuid, uuid, text, text, text, text, int, text, jsonb, jsonb, jsonb, text) TO authenticated;
