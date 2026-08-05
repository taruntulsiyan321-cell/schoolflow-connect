-- Bug #8 (independently verified via live Playwright network capture: every
-- wrong answer returns HTTP 409, code 23505, "duplicate key value violates
-- unique constraint revision_queue_open_unique").
--
-- Root cause: rpc_assign_concept_recovery's own existence-check (added in
-- 20260617000000_practice_recovery_quality.sql) does not match the partial
-- unique index revision_queue_open_unique added later in
-- 20260802330000_recovery_revision_integrity.sql:
--
--   index key:   (user_id, subject, COALESCE(chapter,''), COALESCE(topic,''))
--                WHERE completed = false
--   this check:  user_id, subject, topic, reason = 'concept_recovery'
--                (no chapter check; an extra reason filter the index knows
--                nothing about)
--
-- rpc_record_concept_mistake already inserts/updates a revision_queue row
-- for the same (user_id, subject, chapter, topic) with reason='practice_wrong'
-- just before calling this function in the same transaction. Because this
-- function's check filters on reason='concept_recovery', it never sees that
-- row, tries to INSERT again for the same index key, and the database
-- rejects it -- deterministically, on the very first wrong answer for any
-- concept, no concurrency required.
--
-- Because rpc_assign_concept_recovery is PERFORMed from rpc_record_concept_mistake,
-- which is PERFORMed from rpc_record_question_attempt, and none of the three
-- have any exception handling, this single uncaught error aborts the entire
-- attempt-recording transaction -- rolling back question_attempts and
-- question_records writes that already happened earlier in the same call.
--
-- Fix: replace the mismatched check-then-insert with an atomic upsert
-- against the actual unique index. Nothing else in this function changes --
-- signature, question-selection logic, and every other line are reproduced
-- verbatim from the live version (20260617000000_practice_recovery_quality.sql).

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

  -- ▼ Bug #8 fix: was `IF NOT EXISTS (SELECT ... WHERE reason='concept_recovery') THEN INSERT`,
  -- which does not match revision_queue_open_unique's actual key and can
  -- never see a row rpc_record_concept_mistake just inserted with a
  -- different reason. Atomic upsert against the real index instead.
  INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
  VALUES (_uid, _sid, _subject, _chapter, _concept_f, 'concept_recovery', 95, CURRENT_DATE)
  ON CONFLICT (user_id, subject, (COALESCE(chapter, '')), (COALESCE(topic, '')))
    WHERE completed = false
  DO NOTHING;
  -- ▲

  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_assign_concept_recovery(text, text, text, text, numeric, text, uuid) TO authenticated;
