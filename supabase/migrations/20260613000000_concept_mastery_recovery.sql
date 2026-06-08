-- Concept Mastery & Mistake Recovery System
-- Extends Student Success Phases 1-3 with concept tagging, mastery scores, recovery assignments.

-- ── Concept columns on question sources ───────────────────────────────────────
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.dpp_questions
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS chapter text,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.battle_questions
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.question_templates
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text,
  ADD COLUMN IF NOT EXISTS assessment_type text;

UPDATE public.student_mistakes SET assessment_type = source WHERE assessment_type IS NULL;

-- ── Concept mastery per student ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concept_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  class_level int,
  subject text NOT NULL,
  chapter text,
  concept text NOT NULL,
  subconcept text,
  mastery_score numeric NOT NULL DEFAULT 0 CHECK (mastery_score >= 0 AND mastery_score <= 100),
  total_attempts int NOT NULL DEFAULT 0,
  correct_attempts int NOT NULL DEFAULT 0,
  recovery_attempts int NOT NULL DEFAULT 0,
  recovery_correct int NOT NULL DEFAULT 0,
  mistake_count int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS concept_mastery_user_concept
  ON public.concept_mastery (
    user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, '')
  );

CREATE INDEX IF NOT EXISTS concept_mastery_user_score
  ON public.concept_mastery (user_id, mastery_score ASC);

ALTER TABLE public.concept_mastery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mastery self" ON public.concept_mastery;
CREATE POLICY "mastery self" ON public.concept_mastery
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "mastery parent" ON public.concept_mastery;
CREATE POLICY "mastery parent" ON public.concept_mastery
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = concept_mastery.user_id AND s.parent_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "mastery teacher" ON public.concept_mastery;
CREATE POLICY "mastery teacher" ON public.concept_mastery
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = concept_mastery.user_id AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── Recovery assignments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recovery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  subject text NOT NULL,
  chapter text,
  concept text NOT NULL,
  subconcept text,
  severity text NOT NULL CHECK (severity IN ('minor', 'moderate', 'severe')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  question_count int NOT NULL DEFAULT 0,
  questions_completed int NOT NULL DEFAULT 0,
  questions_correct int NOT NULL DEFAULT 0,
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS recovery_assignments_user_open
  ON public.recovery_assignments (user_id, status) WHERE status IN ('pending', 'in_progress');

ALTER TABLE public.recovery_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recovery self" ON public.recovery_assignments;
CREATE POLICY "recovery self" ON public.recovery_assignments
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.recovery_assignment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.recovery_assignments(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  question_text text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text,
  bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.question_templates(id) ON DELETE SET NULL,
  answered boolean NOT NULL DEFAULT false,
  is_correct boolean,
  student_answer jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_questions_assignment
  ON public.recovery_assignment_questions (assignment_id, order_index);

ALTER TABLE public.recovery_assignment_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recovery q via assignment" ON public.recovery_assignment_questions;
CREATE POLICY "recovery q via assignment" ON public.recovery_assignment_questions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.recovery_assignments a WHERE a.id = assignment_id AND a.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.recovery_assignments a WHERE a.id = assignment_id AND a.user_id = auth.uid())
  );

-- ── Concept tag helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._humanize_template_type(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT initcap(replace(replace(_t, '_', ' '), 'rf ', 'Relations '));
$$;

CREATE OR REPLACE FUNCTION public._backfill_question_bank_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.question_bank SET
    concept = COALESCE(NULLIF(concept, ''), NULLIF(topic, ''), NULLIF(chapter, ''), subject),
    subconcept = COALESCE(NULLIF(subconcept, ''), NULLIF(topic, ''), concept)
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_dpp_question_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.dpp_questions dq SET
    class_level = COALESCE(
      dq.class_level,
      CASE WHEN c.name ~ '^[0-9]+$' THEN c.name::int ELSE NULL END
    ),
    subject = COALESCE(dq.subject, d.subject),
    chapter = COALESCE(dq.chapter, d.chapter),
    concept = COALESCE(NULLIF(dq.concept, ''), NULLIF(dq.subconcept, ''), NULLIF(d.topic, ''), NULLIF(d.chapter, ''), d.subject),
    subconcept = COALESCE(NULLIF(dq.subconcept, ''), NULLIF(d.topic, ''), dq.concept)
  FROM public.dpps d
  LEFT JOIN public.classes c ON c.id = d.class_id
  WHERE dq.dpp_id = d.id AND (dq.concept IS NULL OR dq.concept = '');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_battle_question_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.battle_questions bq SET
    concept = v.new_concept,
    subconcept = v.new_subconcept
  FROM (
    SELECT
      bq2.id,
      COALESCE(NULLIF(bq2.concept, ''), NULLIF(qb.concept, ''), NULLIF(qb.topic, ''), NULLIF(b.chapter, ''), b.subject) AS new_concept,
      COALESCE(NULLIF(bq2.subconcept, ''), NULLIF(qb.subconcept, ''), NULLIF(qb.topic, ''), bq2.concept) AS new_subconcept
    FROM public.battle_questions bq2
    INNER JOIN public.battles b ON bq2.battle_id = b.id
    LEFT JOIN public.question_bank qb ON qb.id = bq2.bank_question_id
    WHERE bq2.concept IS NULL OR bq2.concept = ''
  ) v
  WHERE bq.id = v.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_template_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.question_templates SET
    concept = COALESCE(NULLIF(concept, ''), chapter),
    subconcept = COALESCE(NULLIF(subconcept, ''), public._humanize_template_type(template_type))
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_backfill_question_concepts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'principal') THEN
    RAISE EXCEPTION 'Admin or principal only';
  END IF;
  RETURN jsonb_build_object(
    'question_bank', public._backfill_question_bank_concepts(),
    'dpp_questions', public._backfill_dpp_question_concepts(),
    'battle_questions', public._backfill_battle_question_concepts(),
    'question_templates', public._backfill_template_concepts()
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_backfill_question_concepts() TO authenticated;

-- Run backfill on migration
SELECT public._backfill_question_bank_concepts();
SELECT public._backfill_dpp_question_concepts();
SELECT public._backfill_battle_question_concepts();
SELECT public._backfill_template_concepts();

-- ── Mastery computation ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._compute_mastery_score(
  _attempts int, _correct int, _recovery_attempts int, _recovery_correct int, _mistakes int, _last_at timestamptz
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _acc numeric := CASE WHEN _attempts > 0 THEN 100.0 * _correct / _attempts ELSE 50 END;
  _rec numeric := CASE WHEN _recovery_attempts > 0 THEN 100.0 * _recovery_correct / _recovery_attempts ELSE _acc END;
  _cons numeric := CASE WHEN _attempts >= 8 THEN LEAST(100, _acc + 5) WHEN _attempts >= 4 THEN _acc ELSE _acc * 0.9 END;
  _recency numeric := CASE
    WHEN _last_at IS NULL THEN 40
    WHEN _last_at >= now() - interval '3 days' THEN 100
    WHEN _last_at >= now() - interval '14 days' THEN 75
    WHEN _last_at >= now() - interval '30 days' THEN 50
    ELSE 30
  END;
  _penalty numeric := LEAST(25, _mistakes * 3);
BEGIN
  RETURN LEAST(100, GREATEST(0, round(
    0.45 * _acc + 0.25 * _rec + 0.15 * _cons + 0.15 * _recency - _penalty, 1
  )));
END; $$;

CREATE OR REPLACE FUNCTION public._upsert_concept_mastery(
  _uid uuid, _sid uuid, _class int, _subject text, _chapter text, _concept text, _subconcept text,
  _is_correct boolean, _is_recovery boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _mistakes int;
BEGIN
  IF _concept IS NULL OR _concept = '' THEN
    _concept := COALESCE(_chapter, _subject, 'General');
  END IF;

  SELECT count(*)::int INTO _mistakes FROM public.student_mistakes
  WHERE user_id = _uid AND NOT mastered
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND COALESCE(concept, topic, '') = COALESCE(_concept, '');

  INSERT INTO public.concept_mastery (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    total_attempts, correct_attempts, recovery_attempts, recovery_correct,
    mistake_count, last_attempt_at, mastery_score, updated_at
  ) VALUES (
    _uid, _sid, _class, _subject, _chapter, _concept, _subconcept,
    1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    _mistakes, now(),
    public._compute_mastery_score(
      1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    now()
  )
  ON CONFLICT (user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, ''))
  DO UPDATE SET
    student_id = COALESCE(EXCLUDED.student_id, concept_mastery.student_id),
    class_level = COALESCE(EXCLUDED.class_level, concept_mastery.class_level),
    total_attempts = concept_mastery.total_attempts + 1,
    correct_attempts = concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
    recovery_attempts = concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    recovery_correct = concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    mistake_count = _mistakes,
    last_attempt_at = now(),
    mastery_score = public._compute_mastery_score(
      concept_mastery.total_attempts + 1,
      concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
      concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    updated_at = now();
END; $$;

-- ── Unified mistake recording with concepts ───────────────────────────────────
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
DECLARE _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
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

  RETURN _mid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(text, uuid, uuid, text, text, text, text, int, text, jsonb, jsonb, jsonb, text) TO authenticated;

-- ── Severity from accuracy ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._concept_severity(_accuracy numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _accuracy < 35 THEN 'severe'
    WHEN _accuracy < 55 THEN 'moderate'
    ELSE 'minor'
  END;
$$;

CREATE OR REPLACE FUNCTION public._recovery_question_count(_severity text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _severity
    WHEN 'severe' THEN 12
    WHEN 'moderate' THEN 6
    ELSE 3
  END;
$$;

-- ── Assign recovery questions for a weak concept ──────────────────────────────
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
      SELECT id, chapter, template_type, explanation_template
      FROM public.question_templates
      WHERE is_active AND class = 12 AND lower(subject) = 'mathematics'
        AND (_chapter IS NULL OR chapter = _chapter)
        AND (concept = _concept_f OR subconcept ILIKE '%' || COALESCE(_subconcept, _concept_f) || '%')
      ORDER BY random() LIMIT (_cnt - _idx)
    LOOP
      _idx := _idx + 1;
      INSERT INTO public.recovery_assignment_questions (
        assignment_id, order_index, question_text, options, correct_answer, explanation, template_id
      ) VALUES (
        _aid, _idx,
        'Practice: ' || public._humanize_template_type(_tm.template_type) || ' (' || _tm.chapter || ')',
        '["Option A","Option B","Option C","Option D"]'::jsonb,
        '{"correct_index":0,"note":"Complete via Class 12 Math practice for full generated question"}'::jsonb,
        _tm.explanation_template, _tm.id
      );
    END LOOP;
  END IF;

  UPDATE public.recovery_assignments SET question_count = _idx WHERE id = _aid;

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

GRANT EXECUTE ON FUNCTION public.rpc_assign_concept_recovery(text, text, text, text, numeric, text, uuid) TO authenticated;

-- ── Read-only concept report builder (no side effects) ────────────────────────
CREATE OR REPLACE FUNCTION public._build_concept_recovery_report(
  _source_type text,
  _source_id uuid,
  _uid uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total int := 0; _correct int := 0; _time_sec int := 0;
  _weak jsonb := '[]'::jsonb; _strong jsonb := '[]'::jsonb; _row record;
BEGIN

  IF _source_type = 'dpp_attempt' THEN
    SELECT att.correct_count, att.total_count, att.time_spent_sec
      INTO _correct, _total, _time_sec
    FROM public.dpp_attempts att WHERE att.id = _source_id AND att.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(dq.subject, d.subject, 'General') AS subject,
        COALESCE(dq.chapter, d.chapter) AS chapter,
        COALESCE(dq.concept, dq.subconcept, d.topic, d.chapter, d.subject) AS concept,
        dq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE da.is_correct)::int AS correct
      FROM public.dpp_answers da
      JOIN public.dpp_questions dq ON dq.id = da.question_id
      JOIN public.dpp_attempts att ON att.id = da.attempt_id
      JOIN public.dpps d ON d.id = att.dpp_id
      WHERE att.id = _source_id AND att.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'subconcept', _row.subconcept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1),
          'attempts', _row.attempts, 'correct', _row.correct
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'battle_participant' THEN
    SELECT bp.correct_count, bp.answered_count,
           GREATEST(EXTRACT(EPOCH FROM (bp.finished_at - bp.joined_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.battle_participants bp WHERE bp.id = _source_id AND bp.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(b.subject, 'General') AS subject,
        b.chapter,
        b.class_level,
        COALESCE(bq.concept, b.topic, b.chapter, b.subject) AS concept,
        bq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE ba.is_correct)::int AS correct
      FROM public.battle_answers ba
      JOIN public.battle_questions bq ON bq.id = ba.question_id
      JOIN public.battle_participants bp ON bp.id = ba.participant_id
      JOIN public.battles b ON b.id = bp.battle_id
      WHERE bp.id = _source_id AND bp.user_id = _uid
      GROUP BY 1, 2, 3, 4, 5
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'practice_session' THEN
    SELECT ps.correct_count, ps.question_count,
           GREATEST(EXTRACT(EPOCH FROM (ps.finished_at - ps.created_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.practice_sessions ps WHERE ps.id = _source_id AND ps.user_id = _uid;

    FOR _row IN
      SELECT
        ps.subject,
        ps.chapter,
        COALESCE(qt.concept, qt.chapter) AS concept,
        qt.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE qa.is_correct)::int AS correct
      FROM public.question_attempts qa
      JOIN public.practice_sessions ps ON ps.id = qa.session_id
      JOIN public.question_templates qt ON qt.id = qa.template_id
      WHERE ps.id = _source_id AND ps.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown source_type: %', _source_type;
  END IF;

  RETURN jsonb_build_object(
    'source_type', _source_type,
    'source_id', _source_id,
    'accuracy_pct', CASE WHEN _total > 0 THEN round(100.0 * _correct / _total, 1) ELSE 0 END,
    'correct_count', _correct,
    'total_count', _total,
    'time_sec', _time_sec,
    'time_minutes', round(COALESCE(_time_sec, 0) / 60.0, 1),
    'weak_concepts', _weak,
    'strong_concepts', _strong,
    'improvement_areas', (
      SELECT COALESCE(jsonb_agg(w->>'concept'), '[]'::jsonb)
      FROM jsonb_array_elements(_weak) w
    )
  );
END; $$;

-- Read-only report for result pages (safe to call on every view)
CREATE OR REPLACE FUNCTION public.rpc_get_concept_recovery_report(_source_type text, _source_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _report jsonb; _assignments jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _report := public._build_concept_recovery_report(_source_type, _source_id, _uid);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assignment_id', id, 'concept', concept, 'severity', severity, 'status', status
  )), '[]'::jsonb)
    INTO _assignments
  FROM public.recovery_assignments
  WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id;

  RETURN _report || jsonb_build_object('recovery_assignments', _assignments);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_get_concept_recovery_report(text, uuid) TO authenticated;

-- One-shot post-assessment: assign recovery + rebuild revision (idempotent per source)
CREATE OR REPLACE FUNCTION public.rpc_post_assessment_concept_analysis(
  _source_type text,
  _source_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _report jsonb;
  _weak jsonb; _w record; _aid uuid; _assignments jsonb := '[]'::jsonb;
  _already boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;
  _report := public._build_concept_recovery_report(_source_type, _source_id, _uid);
  _weak := _report->'weak_concepts';

  SELECT EXISTS (
    SELECT 1 FROM public.recovery_assignments
    WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id
  ) INTO _already;

  IF NOT _already THEN
    FOR _w IN SELECT * FROM jsonb_to_recordset(_weak) AS x(
      subject text, chapter text, concept text, subconcept text, accuracy numeric
    ) LOOP
      _aid := public.rpc_assign_concept_recovery(
        _w.subject, _w.chapter, _w.concept, _w.subconcept,
        _w.accuracy, _source_type, _source_id
      );
      _assignments := _assignments || jsonb_build_array(jsonb_build_object(
        'assignment_id', _aid, 'concept', _w.concept,
        'severity', public._concept_severity(_w.accuracy)
      ));
    END LOOP;
    PERFORM public._rebuild_revision_queue(_uid, _sid);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'assignment_id', id, 'concept', concept, 'severity', severity
    )), '[]'::jsonb)
      INTO _assignments
    FROM public.recovery_assignments
    WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id;
  END IF;

  RETURN _report || jsonb_build_object('recovery_assignments', _assignments);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_post_assessment_concept_analysis(text, uuid) TO authenticated;

-- ── Recovery zone dashboard ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_recovery_zone()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _pending int; _weak jsonb; _mastery jsonb; _open jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT count(*)::int INTO _pending FROM public.recovery_assignments
  WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score, 'mistake_count', mistake_count, 'last_attempt_at', last_attempt_at
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _weak
  FROM public.concept_mastery
  WHERE user_id = _uid AND mastery_score < 60
  LIMIT 12;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score
  ) ORDER BY mastery_score DESC), '[]'::jsonb)
    INTO _mastery
  FROM public.concept_mastery
  WHERE user_id = _uid
  LIMIT 20;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'chapter', chapter, 'concept', concept,
    'severity', severity, 'status', status,
    'question_count', question_count, 'questions_completed', questions_completed,
    'created_at', created_at
  ) ORDER BY
    CASE severity WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
    created_at DESC), '[]'::jsonb)
    INTO _open
  FROM public.recovery_assignments
  WHERE user_id = _uid AND status IN ('pending', 'in_progress')
  LIMIT 15;

  RETURN jsonb_build_object(
    'pending_count', _pending,
    'weak_concepts', _weak,
    'mastery', _mastery,
    'open_assignments', _open
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_recovery_zone() TO authenticated;

-- ── Recovery session: load assignment ─────────────────────────────────────────
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
    'answered', q.answered, 'is_correct', q.is_correct,
    'explanation', q.explanation
  ) ORDER BY q.order_index), '[]'::jsonb)
    INTO _questions
  FROM public.recovery_assignment_questions q
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

GRANT EXECUTE ON FUNCTION public.rpc_get_recovery_assignment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_submit_recovery_answer(
  _question_id uuid,
  _student_answer jsonb,
  _is_correct boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record; _a record; _uid uuid := auth.uid(); _done boolean;
BEGIN
  SELECT q.*, a.user_id, a.student_id, a.subject, a.chapter, a.concept, a.subconcept, a.id AS assignment_id
    INTO _q
  FROM public.recovery_assignment_questions q
  JOIN public.recovery_assignments a ON a.id = q.assignment_id
  WHERE q.id = _question_id AND a.user_id = _uid;

  IF _q IS NULL THEN RAISE EXCEPTION 'Question not found'; END IF;

  UPDATE public.recovery_assignment_questions SET
    answered = true, is_correct = _is_correct, student_answer = _student_answer
  WHERE id = _question_id;

  UPDATE public.recovery_assignments SET
    questions_completed = questions_completed + 1,
    questions_correct = questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  WHERE id = _q.assignment_id
  RETURNING * INTO _a;

  PERFORM public._upsert_concept_mastery(
    _uid, _a.student_id, NULL, _a.subject, _a.chapter, _a.concept, _a.subconcept, _is_correct, true
  );

  SELECT count(*) = _a.question_count INTO _done
  FROM public.recovery_assignment_questions WHERE assignment_id = _q.assignment_id AND answered;

  IF _done THEN
    UPDATE public.recovery_assignments SET status = 'completed', completed_at = now() WHERE id = _q.assignment_id;
    PERFORM public._rebuild_revision_queue(_uid, _a.student_id);
  END IF;

  RETURN jsonb_build_object(
    'completed', _done,
    'questions_completed', _a.questions_completed + 1,
    'questions_correct', _a.questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_answer(uuid, jsonb, boolean) TO authenticated;

-- ── Student concept mastery list ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_concept_mastery()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _items jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score, 'total_attempts', total_attempts,
    'correct_attempts', correct_attempts, 'recovery_attempts', recovery_attempts,
    'mistake_count', mistake_count, 'last_attempt_at', last_attempt_at
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _items
  FROM public.concept_mastery WHERE user_id = _uid;
  RETURN jsonb_build_object('items', _items);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_concept_mastery() TO authenticated;

-- ── Patch DPP mistake capture with concepts ───────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_dpp_mistakes(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att record; _q record; _ans record; _prio int; _existing uuid;
  _concept text; _subconcept text;
BEGIN
  SELECT a.*, d.subject, d.chapter, d.topic INTO _att
  FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
  WHERE a.id = _attempt_id;
  IF _att IS NULL THEN RETURN; END IF;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    IF _ans IS NULL OR COALESCE(_ans.is_correct, false) THEN
      IF _ans IS NOT NULL THEN
        _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
        _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);
        PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
          COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
          _concept, _subconcept, true, false);
      END IF;
      CONTINUE;
    END IF;

    _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
    _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _att.user_id, _att.student_id, 'dpp', _att.dpp_id, _q.id,
      _q.class_level, COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _att.topic, _concept, _subconcept, 'dpp',
      _q.question, _q.options, _ans.response, _q.correct, _q.explanation, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
      COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _concept, _subconcept, false, false);

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(
      _att.user_id, COALESCE(_att.subject, 'General'), _att.chapter, _concept, NULL
    ) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _att.user_id AND NOT completed
      AND subject = COALESCE(_att.subject, 'General')
      AND COALESCE(chapter, '') = COALESCE(_att.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_concept, '')
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, _prio), reason = 'dpp_wrong', due_date = LEAST(due_date, CURRENT_DATE)
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _att.user_id, _att.student_id,
        COALESCE(_att.subject, 'General'), _att.chapter, _concept,
        'dpp_wrong', _prio, CURRENT_DATE
      );
    END IF;
  END LOOP;
END; $$;

-- ── Patch battle mistake capture with concepts ────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_battle_mistakes(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bp record; _ba record; _concept text; _subconcept text;
BEGIN
  SELECT bp.*, b.subject, b.chapter, b.topic, b.class_level
    INTO _bp
  FROM public.battle_participants bp
  JOIN public.battles b ON b.id = bp.battle_id
  WHERE bp.id = _participant_id;
  IF _bp IS NULL THEN RETURN; END IF;

  FOR _ba IN
    SELECT ba.*, bq.question, bq.options, bq.correct_index, bq.bank_question_id,
           bq.concept, bq.subconcept
    FROM public.battle_answers ba
    JOIN public.battle_questions bq ON bq.id = ba.question_id
    WHERE ba.participant_id = _participant_id
  LOOP
    _concept := COALESCE(_ba.concept, _bp.topic, _bp.chapter, _bp.subject);
    _subconcept := COALESCE(_ba.subconcept, _ba.concept, _bp.topic);

    IF _ba.is_correct THEN
      PERFORM public._upsert_concept_mastery(_bp.user_id, _bp.student_id, _bp.class_level,
        COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, true, false);
      CONTINUE;
    END IF;

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _bp.user_id, _bp.student_id, 'battleground', _bp.battle_id, _ba.question_id,
      _bp.class_level, COALESCE(_bp.subject, 'General'), _bp.chapter, _bp.topic,
      _concept, _subconcept, 'battle',
      _ba.question, _ba.options,
      jsonb_build_object('selected_index', _ba.selected_index),
      jsonb_build_object('correct_index', _ba.correct_index),
      NULL, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_bp.user_id, _bp.student_id, _bp.class_level,
      COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, false, false);
  END LOOP;
END; $$;

-- ── Patch practice attempt recording ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _session_id uuid,
  _template_id uuid,
  _generated_question jsonb,
  _correct_answer jsonb,
  _selected_answer jsonb DEFAULT NULL,
  _is_correct boolean DEFAULT NULL,
  _score numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _student uuid; _aid uuid; _tm record; _concept text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
  _concept := COALESCE(_tm.concept, _tm.chapter);

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct
  ) VALUES (
    _session_id, _student, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct
  ) RETURNING id INTO _aid;

  IF _is_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1, score = score + COALESCE(_score, 1)
      WHERE id = _session_id AND user_id = _uid;
  ELSE
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _aid,
      _tm.subject, _tm.chapter, _concept, _tm.subconcept, _tm.class,
      COALESCE(_generated_question->>'question', 'Practice question'),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _correct_answer,
      _tm.explanation_template
    );
  END IF;

  PERFORM public._upsert_concept_mastery(_uid, _student, _tm.class, _tm.subject, _tm.chapter,
    _concept, _tm.subconcept, COALESCE(_is_correct, false), false);

  RETURN _aid;
END; $$;

-- ── Teacher concept analytics ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_teacher_concept_analytics(_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _base jsonb;
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal')
     AND NOT public.teacher_teaches_class(_uid, _class_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _base := public.rpc_teacher_class_insights(_class_id);

  RETURN _base || jsonb_build_object(
    'class_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', cm.subject, 'chapter', cm.chapter, 'concept', cm.concept,
        'avg_mastery', round(avg(cm.mastery_score), 1),
        'students', count(DISTINCT cm.user_id)
      ) ORDER BY avg(cm.mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 55
      GROUP BY cm.subject, cm.chapter, cm.concept
      LIMIT 10
    ),
    'student_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.full_name,
        'concept', cm.concept, 'subject', cm.subject,
        'mastery_score', cm.mastery_score
      ) ORDER BY cm.mastery_score ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 45
      LIMIT 20
    ),
    'recovery_completion_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE ra.status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments ra
      JOIN public.students s ON s.user_id = ra.user_id
      WHERE s.class_id = _class_id
    ),
    'mastery_distribution', (
      SELECT jsonb_build_object(
        'below_40', count(*) FILTER (WHERE cm.mastery_score < 40),
        '40_60', count(*) FILTER (WHERE cm.mastery_score >= 40 AND cm.mastery_score < 60),
        '60_80', count(*) FILTER (WHERE cm.mastery_score >= 60 AND cm.mastery_score < 80),
        'above_80', count(*) FILTER (WHERE cm.mastery_score >= 80)
      )
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_teacher_concept_analytics(uuid) TO authenticated;

-- ── Parent concept analytics (no question detail) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_parent_concept_analytics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _parent uuid := auth.uid(); _result jsonb := '[]'::jsonb; _child record;
BEGIN
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  FOR _child IN SELECT s.* FROM public.students s WHERE s.parent_user_id = _parent
  LOOP
    IF _child.user_id IS NULL THEN CONTINUE; END IF;
    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name', _child.full_name,
      'weak_areas', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'subject', subject, 'concept', concept, 'mastery_score', mastery_score
        ) ORDER BY mastery_score ASC), '[]'::jsonb)
        FROM public.concept_mastery
        WHERE user_id = _child.user_id AND mastery_score < 55
        LIMIT 5
      ),
      'recovery_pending', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status IN ('pending', 'in_progress')
      ),
      'recovery_completed', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status = 'completed'
          AND completed_at >= now() - interval '30 days'
      ),
      'mastery_trend', (
        SELECT round(avg(mastery_score), 1) FROM public.concept_mastery WHERE user_id = _child.user_id
      )
    ));
  END LOOP;

  RETURN jsonb_build_object('children', _result);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_parent_concept_analytics() TO authenticated;

-- ── Principal concept analytics ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_principal_concept_analytics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Principal or admin only';
  END IF;

  RETURN jsonb_build_object(
    'school_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject, 'concept', concept,
        'avg_mastery', round(avg(mastery_score), 1),
        'students_affected', count(DISTINCT user_id)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      WHERE mastery_score < 50
      GROUP BY subject, concept
      LIMIT 12
    ),
    'subject_performance', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject,
        'avg_mastery', round(avg(mastery_score), 1),
        'concepts_tracked', count(*)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      GROUP BY subject
    ),
    'recovery_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments
    ),
    'recovery_participation', (
      SELECT count(DISTINCT user_id)::int FROM public.recovery_assignments
      WHERE created_at >= now() - interval '30 days'
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_principal_concept_analytics() TO authenticated;

-- ── Extend academic snapshot with recovery + mastery ──────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _dpp_open int := 0; _dpp_done int := 0;
  _weak jsonb; _strong jsonb; _rev jsonb; _mistakes int; _heat jsonb;
  _recovery_pending int := 0; _mastery_summary jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _s FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _uid;

  IF _s.id IS NOT NULL THEN
    SELECT count(*) FILTER (WHERE hs.status IN ('submitted','graded')),
           count(*) FILTER (WHERE hs.status IS NULL OR hs.status = 'pending')
      INTO _hw_done, _hw_pending
    FROM public.homework h
    LEFT JOIN public.homework_submissions hs ON hs.homework_id = h.id AND hs.student_id = _s.id
    WHERE h.class_id = _s.class_id;

    SELECT count(*) FILTER (WHERE att.status = 'submitted'),
           count(*) FILTER (WHERE att.status IS DISTINCT FROM 'submitted')
      INTO _dpp_done, _dpp_open
    FROM public.dpps d
    LEFT JOIN public.dpp_attempts att ON att.dpp_id = d.id AND att.user_id = _uid
    WHERE d.is_published AND d.class_id = _s.class_id;
  END IF;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _weak FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy < 65 LIMIT 5;

  SELECT COALESCE(jsonb_agg(row_to_json(w) ORDER BY w.accuracy DESC), '[]'::jsonb)
    INTO _strong FROM public._weak_topics_for_user(_uid) w WHERE w.accuracy >= 75 LIMIT 5;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'date', activity_date, 'dpp', dpp_count, 'homework', homework_count,
    'battles', battle_count, 'minutes', practice_minutes
  ) ORDER BY activity_date), '[]'::jsonb)
    INTO _heat FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28;

  SELECT count(*) INTO _mistakes FROM public.student_mistakes
    WHERE user_id = _uid AND NOT mastered;

  SELECT count(*)::int INTO _recovery_pending FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'topic', topic, 'chapter', chapter,
    'priority', priority, 'due_date', due_date, 'reason', reason
  ) ORDER BY priority DESC, due_date ASC), '[]'::jsonb)
    INTO _rev FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed LIMIT 10;

  RETURN jsonb_build_object(
    'student', CASE WHEN _s.id IS NULL THEN NULL ELSE jsonb_build_object(
      'id', _s.id, 'full_name', _s.full_name, 'class_id', _s.class_id,
      'roll_number', _s.roll_number, 'admission_number', _s.admission_number
    ) END,
    'xp', CASE WHEN _xp IS NULL THEN NULL ELSE to_jsonb(_xp) END,
    'homework', jsonb_build_object('pending', _hw_pending, 'completed', _hw_done),
    'dpp', jsonb_build_object('open', _dpp_open, 'completed', _dpp_done),
    'weak_topics', _weak,
    'strong_topics', _strong,
    'revision_queue', _rev,
    'mistake_count', _mistakes,
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  );
END; $$;
