-- Practice diversity + recovery questions from templates (not empty placeholders)

CREATE OR REPLACE FUNCTION public.rpc_pick_question_templates(
  _class int,
  _subject text,
  _chapter text,
  _count int DEFAULT 10
)
RETURNS SETOF public.question_templates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH pool AS (
    SELECT *
    FROM public.question_templates
    WHERE class = _class
      AND lower(subject) = lower(_subject)
      AND chapter = _chapter
      AND is_active
  ),
  diverse AS (
    SELECT DISTINCT ON (template_type) *
    FROM pool
    ORDER BY template_type, random()
  ),
  need AS (SELECT GREATEST(_count, 1) AS n),
  first_pick AS (
    SELECT * FROM diverse
    LIMIT (SELECT n FROM need)
  ),
  extra AS (
    SELECT p.*
    FROM pool p
    WHERE p.id NOT IN (SELECT id FROM first_pick)
    ORDER BY random()
    LIMIT (
      SELECT GREATEST((SELECT n FROM need) - (SELECT count(*)::int FROM first_pick), 0)
    )
  )
  SELECT * FROM first_pick
  UNION ALL
  SELECT * FROM extra;
$$;

-- Recovery: fill from Class 12 templates when question_bank empty; client generates MCQs
CREATE OR REPLACE FUNCTION public.rpc_assign_concept_recovery(
  _subject text,
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _accuracy numeric DEFAULT 40,
  _source_type text DEFAULT NULL,
  _source_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _severity text; _cnt int; _aid uuid; _concept_f text;
  _qb record; _tm record; _idx int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _severity := public._concept_severity(_accuracy);
  _cnt := public._recovery_question_count(_severity);

  IF EXISTS (
    SELECT 1 FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND concept = _concept_f AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  ) THEN
    SELECT id INTO _aid FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND concept = _concept_f
    ORDER BY created_at DESC LIMIT 1;
    RETURN _aid;
  END IF;

  INSERT INTO public.recovery_assignments (
    user_id, student_id, subject, chapter, concept, subconcept,
    severity, question_count, source_type, source_id
  ) VALUES (
    _uid, _sid, _subject, _chapter, _concept_f, _subconcept,
    _severity, _cnt, _source_type, _source_id
  ) RETURNING id INTO _aid;

  FOR _qb IN
    SELECT id, question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_subject)
      AND (_chapter IS NULL OR chapter ILIKE '%' || _chapter || '%' OR concept ILIKE '%' || _concept_f || '%')
      AND (concept ILIKE '%' || _concept_f || '%' OR topic ILIKE '%' || _concept_f || '%' OR chapter ILIKE '%' || _concept_f || '%')
    ORDER BY random() LIMIT _cnt
  LOOP
    _idx := _idx + 1;
    INSERT INTO public.recovery_assignment_questions (
      assignment_id, order_index, question_text, options, correct_answer, explanation, bank_question_id
    ) VALUES (
      _aid, _idx, _qb.question, _qb.options,
      jsonb_build_object('correct_index', _qb.correct_index),
      _qb.explanation, _qb.id
    );
  END LOOP;

  IF _idx < _cnt AND lower(_subject) LIKE '%math%' THEN
    FOR _tm IN
      SELECT DISTINCT ON (template_type) id, chapter, template_type, template_data, explanation_template
      FROM public.question_templates
      WHERE is_active AND class = 12 AND lower(subject) = 'mathematics'
        AND (_chapter IS NULL OR chapter = _chapter)
      ORDER BY template_type, random()
      LIMIT (_cnt - _idx)
    LOOP
      _idx := _idx + 1;
      INSERT INTO public.recovery_assignment_questions (
        assignment_id, order_index, question_text, options, correct_answer, explanation, template_id
      ) VALUES (
        _aid, _idx,
        '',
        '[]'::jsonb,
        jsonb_build_object('client_generate', true),
        _tm.explanation_template,
        _tm.id
      );
    END LOOP;
  END IF;

  UPDATE public.recovery_assignments SET question_count = _idx WHERE id = _aid;

  IF _idx = 0 THEN
    DELETE FROM public.recovery_assignments WHERE id = _aid;
    RAISE EXCEPTION 'No recovery questions available for this topic yet — try Class 12 Math practice for %', COALESCE(_chapter, _subject);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed
      AND subject = _subject AND COALESCE(topic, '') = _concept_f AND reason = 'concept_recovery'
  ) THEN
    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    VALUES (_uid, _sid, _subject, _chapter, _concept_f, 'concept_recovery', 95, CURRENT_DATE);
  END IF;

  RETURN _aid;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_get_recovery_assignment(_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a record; _questions jsonb;
BEGIN
  SELECT * INTO _a FROM public.recovery_assignments
  WHERE id = _assignment_id AND user_id = auth.uid();
  IF _a IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  IF _a.status = 'pending' THEN
    UPDATE public.recovery_assignments SET status = 'in_progress' WHERE id = _assignment_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'order_index', q.order_index,
    'question_text', q.question_text, 'options', q.options,
    'correct_answer', q.correct_answer,
    'answered', q.answered, 'is_correct', q.is_correct,
    'explanation', q.explanation,
    'template_id', q.template_id,
    'client_generate', COALESCE((q.correct_answer->>'client_generate')::boolean, false),
    'template_type', qt.template_type,
    'template_data', qt.template_data,
    'chapter', COALESCE(qt.chapter, _a.chapter)
  ) ORDER BY q.order_index), '[]'::jsonb)
    INTO _questions
  FROM public.recovery_assignment_questions q
  LEFT JOIN public.question_templates qt ON qt.id = q.template_id
  WHERE q.assignment_id = _assignment_id;

  RETURN jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', _a.id, 'subject', _a.subject, 'chapter', _a.chapter,
      'concept', _a.concept, 'subconcept', _a.subconcept,
      'severity', _a.severity, 'status', _a.status,
      'question_count', _a.question_count,
      'questions_completed', _a.questions_completed,
      'questions_correct', _a.questions_correct
    ),
    'questions', _questions
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_pick_question_templates(int, text, text, int) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_assign_concept_recovery(text, text, text, text, numeric, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_get_recovery_assignment(uuid) TO authenticated;
