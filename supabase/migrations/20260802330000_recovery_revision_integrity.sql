-- Recovery / revision integrity: no revision-queue dupes on mistakes,
-- complete AI/template recovery sessions, expose completed recovery count.

-- ── 1) Deduplicate open revision_queue rows (same user+subject+chapter+topic) ─
DELETE FROM public.revision_queue a
USING public.revision_queue b
WHERE a.user_id = b.user_id
  AND a.completed = false
  AND b.completed = false
  AND a.id > b.id
  AND a.subject = b.subject
  AND COALESCE(a.chapter, '') = COALESCE(b.chapter, '')
  AND COALESCE(a.topic, '') = COALESCE(b.topic, '');

CREATE UNIQUE INDEX IF NOT EXISTS revision_queue_open_unique
  ON public.revision_queue (user_id, subject, COALESCE(chapter, ''), COALESCE(topic, ''))
  WHERE completed = false;

-- ── 2) Mistake → revision insert is idempotent ───────────────────────────────
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

-- ── 3) Complete recovery when session used AI/template (no bank Q UUIDs) ─────
CREATE OR REPLACE FUNCTION public.rpc_complete_recovery_assignment(
  _assignment_id uuid,
  _questions_completed int DEFAULT NULL,
  _questions_correct int DEFAULT NULL
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _a public.recovery_assignments%ROWTYPE;
  _done int;
  _correct int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _a FROM public.recovery_assignments
  WHERE id = _assignment_id AND user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  IF _a.status = 'completed' THEN
    RETURN jsonb_build_object('completed', true, 'assignment_id', _a.id, 'already', true);
  END IF;

  _done := COALESCE(_questions_completed, _a.question_count, 0);
  _correct := COALESCE(_questions_correct, _a.questions_correct, 0);

  UPDATE public.recovery_assignments SET
    status = 'completed',
    completed_at = now(),
    questions_completed = GREATEST(questions_completed, _done),
    questions_correct = GREATEST(questions_correct, _correct),
    question_count = GREATEST(question_count, _done)
  WHERE id = _assignment_id
  RETURNING * INTO _a;

  PERFORM public._upsert_concept_mastery(
    _uid, _a.student_id, NULL, _a.subject, _a.chapter,
    COALESCE(_a.concept, _a.chapter, _a.subject),
    COALESCE(_a.subconcept, _a.concept, _a.chapter, _a.subject),
    CASE WHEN _done > 0 AND _correct * 2 >= _done THEN true ELSE false END,
    true
  );

  PERFORM public._rebuild_revision_queue(_uid, _a.student_id);

  RETURN jsonb_build_object(
    'completed', true,
    'assignment_id', _a.id,
    'questions_completed', _a.questions_completed,
    'questions_correct', _a.questions_correct
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_complete_recovery_assignment(uuid, int, int) TO authenticated;

-- ── 4) Recovery zone includes completed count + recent history ───────────────
CREATE OR REPLACE FUNCTION public.rpc_student_recovery_zone()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _pending int;
  _completed int;
  _weak jsonb;
  _mastery jsonb;
  _open jsonb;
  _recent jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT count(*)::int INTO _pending FROM public.recovery_assignments
  WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT count(*)::int INTO _completed FROM public.recovery_assignments
  WHERE user_id = _uid AND status = 'completed';

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score, 'mistake_count', mistake_count, 'last_attempt_at', last_attempt_at
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _weak
  FROM (
    SELECT * FROM public.concept_mastery
    WHERE user_id = _uid AND mastery_score < 60
    ORDER BY mastery_score ASC
    LIMIT 12
  ) w;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score
  ) ORDER BY mastery_score DESC), '[]'::jsonb)
    INTO _mastery
  FROM (
    SELECT * FROM public.concept_mastery
    WHERE user_id = _uid
    ORDER BY mastery_score DESC
    LIMIT 20
  ) m;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'chapter', chapter, 'concept', concept,
    'severity', severity, 'status', status,
    'question_count', question_count, 'questions_completed', questions_completed,
    'created_at', created_at
  ) ORDER BY
    CASE severity WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
    created_at DESC), '[]'::jsonb)
    INTO _open
  FROM (
    SELECT * FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
    ORDER BY
      CASE severity WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
      created_at DESC
    LIMIT 15
  ) o;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'concept', concept, 'subject', subject,
    'date', COALESCE(completed_at, created_at),
    'score', CASE
      WHEN question_count > 0 THEN round(100.0 * questions_correct / question_count)::int
      ELSE 0
    END,
    'improved', questions_correct * 2 >= GREATEST(question_count, 1)
  ) ORDER BY COALESCE(completed_at, created_at) DESC), '[]'::jsonb)
    INTO _recent
  FROM (
    SELECT * FROM public.recovery_assignments
    WHERE user_id = _uid AND status = 'completed'
    ORDER BY COALESCE(completed_at, created_at) DESC
    LIMIT 10
  ) r;

  RETURN jsonb_build_object(
    'pending_count', _pending,
    'completed_count', _completed,
    'weak_concepts', _weak,
    'mastery', _mastery,
    'open_assignments', _open,
    'recent_completed', _recent
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_recovery_zone() TO authenticated;
