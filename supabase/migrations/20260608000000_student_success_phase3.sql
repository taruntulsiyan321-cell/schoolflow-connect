-- Phase 3: Intelligence — improvement plans, personalized revision queue, interventions, class trends

-- ── AI / rule improvement plans (cached per topic) ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_improvement_plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  chapter text,
  topic text,
  plan jsonb NOT NULL DEFAULT '{}'::jsonb,
  source text NOT NULL CHECK (source IN ('rule', 'ai')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS student_improvement_plans_user_topic
  ON public.student_improvement_plans (
    user_id, subject, COALESCE(chapter, ''), COALESCE(topic, '')
  );

ALTER TABLE public.student_improvement_plans ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "improvement plans self" ON public.student_improvement_plans;
CREATE POLICY "improvement plans self" ON public.student_improvement_plans
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- ── Revision priority scoring ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._revision_topic_priority(
  _uid uuid,
  _subject text,
  _chapter text,
  _topic text,
  _accuracy numeric DEFAULT NULL
)
RETURNS TABLE(priority int, sort_factors text[])
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _acc numeric := COALESCE(_accuracy, 50);
  _mistakes int := 0;
  _recent int := 0;
  _overdue boolean := false;
  _prio int;
  _factors text[] := ARRAY[]::text[];
BEGIN
  SELECT count(*)::int, count(*) FILTER (WHERE last_wrong_at >= now() - interval '7 days')::int
    INTO _mistakes, _recent
  FROM public.student_mistakes
  WHERE user_id = _uid AND NOT mastered
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND COALESCE(topic, '') = COALESCE(_topic, '');

  SELECT EXISTS (
    SELECT 1 FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed
      AND subject = _subject
      AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND COALESCE(topic, '') = COALESCE(_topic, '')
      AND due_date < CURRENT_DATE
  ) INTO _overdue;

  _prio := GREATEST(10, round((100 - _acc) * 1.4)::int);
  _factors := array_append(_factors, 'Accuracy ' || round(_acc, 0) || '%');

  IF _mistakes > 0 THEN
    _prio := _prio + LEAST(_mistakes * 12, 48);
    _factors := array_append(_factors, _mistakes::text || ' mistake book ' || CASE WHEN _mistakes = 1 THEN 'entry' ELSE 'entries' END);
  END IF;
  IF _recent > 0 THEN
    _prio := _prio + 18;
    _factors := array_append(_factors, 'Recent wrong answers (7d)');
  END IF;
  IF _overdue THEN
    _prio := _prio + 22;
    _factors := array_append(_factors, 'Overdue revision');
  END IF;

  priority := LEAST(_prio, 200);
  sort_factors := _factors;
  RETURN NEXT;
END; $$;

-- ── Rule-based improvement plan templates ──────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rule_improvement_plan(
  _subject text,
  _chapter text,
  _topic text,
  _accuracy numeric,
  _attempts int,
  _mistakes int
)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _label text := trim(both from concat_ws(' · ', _subject, NULLIF(_chapter, ''), NULLIF(_topic, '')));
  _steps text[];
BEGIN
  IF _accuracy < 40 THEN
    _steps := ARRAY[
      'Re-read NCERT / textbook basics for ' || COALESCE(_chapter, _subject) || ' (30 min).',
      'Watch one short concept video on ' || COALESCE(_topic, _chapter, _subject) || ' and note 5 key formulas.',
      'Solve 5 easy DPP questions — accuracy matters more than speed.',
      'Open your mistake book and re-attempt every wrong question for this topic.',
      'Ask your teacher one doubt before the next class test.'
    ];
  ELSIF _accuracy < 55 THEN
    _steps := ARRAY[
      'Revise ' || COALESCE(_topic, _chapter, _subject) || ' notes and highlight errors from past attempts.',
      'Complete 8 mixed-difficulty DPP questions on ' || _subject || '.',
      'Redo mistake book entries (' || _mistakes::text || ' saved) without looking at solutions first.',
      'Summarize the topic in 10 bullet points — teach-back method.',
      'Schedule a 20-minute revision block tomorrow for the same topic.'
    ];
  ELSE
    _steps := ARRAY[
      'Quick formula sheet review for ' || COALESCE(_chapter, _subject) || '.',
      'Attempt 10 timed DPP questions on ' || COALESCE(_topic, _chapter, _subject) || '.',
      'Compare your last 3 attempt scores and note recurring error types.',
      'Pair up with a study buddy for a 15-minute oral quiz on this topic.'
    ];
  END IF;

  RETURN jsonb_build_object(
    'headline', 'Strengthen ' || COALESCE(_topic, _chapter, _subject),
    'steps', to_jsonb(_steps[1:LEAST(array_length(_steps, 1), 5)]),
    'timeframe', CASE WHEN _accuracy < 45 THEN '5–7 days' WHEN _accuracy < 60 THEN '3–5 days' ELSE '2–3 days' END,
    'label', _label
  );
END; $$;

-- ── Personalized revision queue rebuild ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._rebuild_revision_queue(_uid uuid, _student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _row record;
  _prio int;
  _factors text[];
  _existing uuid;
  _due date;
BEGIN
  FOR _row IN
    SELECT * FROM public._weak_topics_for_user(_uid) WHERE accuracy < 60 ORDER BY accuracy ASC LIMIT 8
  LOOP
    SELECT p.priority, p.sort_factors INTO _prio, _factors
    FROM public._revision_topic_priority(_uid, _row.subject, _row.chapter, _row.topic, _row.accuracy) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed
      AND subject = _row.subject
      AND COALESCE(chapter, '') = COALESCE(_row.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_row.topic, '')
    LIMIT 1;

    _due := CURRENT_DATE + CASE WHEN _row.accuracy < 40 THEN 0 WHEN _row.accuracy < 50 THEN 1 ELSE 2 END;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = _prio, reason = 'weak_topic', due_date = LEAST(due_date, _due), student_id = _student_id
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (_uid, _student_id, _row.subject, _row.chapter, _row.topic, 'weak_topic', _prio, _due);
    END IF;
  END LOOP;

  FOR _row IN
    SELECT rq.*, w.accuracy
    FROM public.revision_queue rq
    LEFT JOIN public._weak_topics_for_user(_uid) w
      ON w.subject = rq.subject
     AND COALESCE(w.chapter, '') = COALESCE(rq.chapter, '')
     AND COALESCE(w.topic, '') = COALESCE(rq.topic, '')
    WHERE rq.user_id = _uid AND NOT rq.completed AND rq.reason = 'dpp_wrong'
  LOOP
    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(_uid, _row.subject, _row.chapter, _row.topic, _row.accuracy) p;
    UPDATE public.revision_queue SET priority = _prio WHERE id = _row.id;
  END LOOP;
END; $$;

-- ── Student revision queue RPC (ordered + sort hints) ───────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_revision_queue()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _s record; _items jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO _s FROM public.students WHERE user_id = _uid LIMIT 1;
  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', rq.id,
    'subject', rq.subject,
    'chapter', rq.chapter,
    'topic', rq.topic,
    'reason', rq.reason,
    'priority', rq.priority,
    'due_date', rq.due_date,
    'priority_label', CASE
      WHEN rq.priority >= 120 THEN 'High'
      WHEN rq.priority >= 70 THEN 'Medium'
      ELSE 'Low'
    END,
    'sort_factors', COALESCE(p.sort_factors, ARRAY[]::text[])
  ) ORDER BY rq.priority DESC, rq.due_date ASC), '[]'::jsonb)
    INTO _items
  FROM public.revision_queue rq
  LEFT JOIN LATERAL public._revision_topic_priority(
    _uid, rq.subject, rq.chapter, rq.topic,
    (SELECT accuracy FROM public._weak_topics_for_user(_uid) w
     WHERE w.subject = rq.subject
       AND COALESCE(w.chapter, '') = COALESCE(rq.chapter, '')
       AND COALESCE(w.topic, '') = COALESCE(rq.topic, '')
     LIMIT 1)
  ) p ON true
  WHERE rq.user_id = _uid AND NOT rq.completed;

  RETURN jsonb_build_object(
    'items', _items,
    'sort_note', 'Ordered by personalized priority (accuracy, mistakes, overdue, recent errors), then due date.'
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_revision_queue() TO authenticated;

-- ── Improvement plans RPC ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_improvement_plans()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _plans jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', w.subject,
    'chapter', w.chapter,
    'topic', w.topic,
    'accuracy', w.accuracy,
    'attempts', w.attempts,
    'mistake_count', (
      SELECT count(*)::int FROM public.student_mistakes m
      WHERE m.user_id = _uid AND NOT m.mastered
        AND m.subject = w.subject
        AND COALESCE(m.chapter, '') = COALESCE(w.chapter, '')
        AND COALESCE(m.topic, '') = COALESCE(w.topic, '')
    ),
    'rule_plan', public._rule_improvement_plan(
      w.subject, w.chapter, w.topic, w.accuracy, w.attempts,
      (SELECT count(*)::int FROM public.student_mistakes m
       WHERE m.user_id = _uid AND NOT m.mastered
         AND m.subject = w.subject
         AND COALESCE(m.chapter, '') = COALESCE(w.chapter, '')
         AND COALESCE(m.topic, '') = COALESCE(w.topic, ''))
    ),
    'ai_plan', (
      SELECT p.plan FROM public.student_improvement_plans p
      WHERE p.user_id = _uid AND p.source = 'ai'
        AND p.subject = w.subject
        AND COALESCE(p.chapter, '') = COALESCE(w.chapter, '')
        AND COALESCE(p.topic, '') = COALESCE(w.topic, '')
      LIMIT 1
    )
  ) ORDER BY w.accuracy ASC), '[]'::jsonb)
    INTO _plans
  FROM public._weak_topics_for_user(_uid) w
  WHERE w.accuracy < 65
  LIMIT 12;

  RETURN jsonb_build_object('plans', _plans);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_improvement_plans() TO authenticated;

-- ── Patch academic snapshot: revision ordering ─────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _dpp_open int := 0; _dpp_done int := 0;
  _rank int; _lb jsonb; _heat jsonb; _weak jsonb; _strong jsonb; _rev jsonb; _mistakes int;
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
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  );
END; $$;

-- ── DPP capture: dedupe open revision rows ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_dpp_mistakes(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att record; _q record; _ans record; _prio int; _existing uuid;
BEGIN
  SELECT a.*, d.subject, d.chapter, d.topic INTO _att
  FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
  WHERE a.id = _attempt_id;
  IF _att IS NULL THEN RETURN; END IF;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    IF _ans IS NULL OR COALESCE(_ans.is_correct, false) THEN CONTINUE; END IF;

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      subject, chapter, topic, question_text, options,
      student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _att.user_id, _att.student_id, 'dpp', _att.dpp_id, _q.id,
      COALESCE(_att.subject, 'General'), _att.chapter, _att.topic,
      _q.question, _q.options, _ans.response, _q.correct, _q.explanation, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      mastered = false;

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(
      _att.user_id, COALESCE(_att.subject, 'General'), _att.chapter, _att.topic, NULL
    ) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _att.user_id AND NOT completed
      AND subject = COALESCE(_att.subject, 'General')
      AND COALESCE(chapter, '') = COALESCE(_att.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_att.topic, '')
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, _prio), reason = 'dpp_wrong', due_date = LEAST(due_date, CURRENT_DATE)
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _att.user_id, _att.student_id,
        COALESCE(_att.subject, 'General'), _att.chapter, _att.topic,
        'dpp_wrong', _prio, CURRENT_DATE
      );
    END IF;
  END LOOP;
END; $$;

-- ── Teacher class insights + interventions ─────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_teacher_class_insights(_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _class_label text;
  _at_risk_cnt int;
  _interventions jsonb;
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal')
     AND NOT public.teacher_teaches_class(_uid, _class_id) THEN
    RAISE EXCEPTION 'Not authorized for this class';
  END IF;

  SELECT COALESCE(c.display_name, c.name || '-' || c.section) INTO _class_label
  FROM public.classes c WHERE c.id = _class_id;

  SELECT count(*)::int INTO _at_risk_cnt
  FROM public.students s
  JOIN LATERAL (
    SELECT
      CASE WHEN count(att.*) > 0 THEN round(100.0 * count(*) FILTER (WHERE att.status = 'present') / count(*), 1) ELSE 100 END AS att_pct,
      COALESCE((SELECT round(avg(CASE WHEN da.total_count > 0 THEN 100.0*da.correct_count/da.total_count END),1)
        FROM public.dpp_attempts da WHERE da.student_id = s.id AND da.status = 'submitted'), 0) AS acc
  ) sub ON true
  WHERE s.class_id = _class_id AND (sub.att_pct < 75 OR sub.acc < 55);

  SELECT COALESCE(jsonb_agg(x ORDER BY
      CASE x->>'priority' WHEN 'high' THEN 1 WHEN 'medium' THEN 2 ELSE 3 END,
      (x->>'accuracy')::numeric NULLS LAST), '[]'::jsonb)
    INTO _interventions
  FROM (
    SELECT jsonb_build_object(
      'priority', CASE WHEN t.accuracy < 45 THEN 'high' WHEN t.accuracy < 55 THEN 'medium' ELSE 'low' END,
      'action', 'Assign remedial DPP for ' || _class_label || ' ' || t.subject,
      'subject', t.subject,
      'chapter', t.chapter,
      'class_label', _class_label,
      'rationale', 'Class accuracy on ' || COALESCE(t.chapter, t.subject) || ' is ' || t.accuracy || '% across recent attempts.',
      'suggested_dpp_title', 'Remedial: ' || t.subject || ' — ' || COALESCE(t.chapter, 'Core revision'),
      'accuracy', t.accuracy
    ) AS x
    FROM (
      SELECT d.subject, d.chapter,
             round(100.0 * sum(CASE WHEN da.is_correct THEN 1 ELSE 0 END) / nullif(count(*),0), 1) AS accuracy
      FROM public.students s
      JOIN public.dpp_attempts att ON att.student_id = s.id AND att.status = 'submitted'
      JOIN public.dpps d ON d.id = att.dpp_id
      JOIN public.dpp_answers da ON da.attempt_id = att.id
      WHERE s.class_id = _class_id
      GROUP BY d.subject, d.chapter
      HAVING count(*) >= 5
      ORDER BY accuracy ASC LIMIT 5
    ) t
    UNION ALL
    SELECT jsonb_build_object(
      'priority', 'high',
      'action', 'Schedule 1:1 check-ins for ' || _class_label,
      'subject', NULL,
      'chapter', NULL,
      'class_label', _class_label,
      'rationale', _at_risk_cnt::text || ' students flagged at-risk (attendance or DPP accuracy).',
      'suggested_dpp_title', NULL,
      'accuracy', NULL
    )
    WHERE _at_risk_cnt >= 3
  ) combined;

  RETURN jsonb_build_object(
    'at_risk', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.full_name, 'roll', s.roll_number,
        'attendance_pct', sub.att_pct, 'avg_accuracy', sub.acc
      )), '[]'::jsonb)
      FROM public.students s
      JOIN LATERAL (
        SELECT
          CASE WHEN count(att.*) > 0 THEN round(100.0 * count(*) FILTER (WHERE att.status = 'present') / count(*), 1) ELSE 100 END AS att_pct,
          COALESCE((SELECT round(avg(CASE WHEN da.total_count > 0 THEN 100.0*da.correct_count/da.total_count END),1)
            FROM public.dpp_attempts da WHERE da.student_id = s.id AND da.status = 'submitted'), 0) AS acc
      ) sub ON true
      WHERE s.class_id = _class_id
        AND (sub.att_pct < 75 OR sub.acc < 55)
      LIMIT 15
    ),
    'improving', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.full_name)), '[]'::jsonb)
      FROM public.students s
      JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _class_id AND x.win_streak >= 2
      LIMIT 10
    ),
    'top_performers', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object('student_id', s.id, 'name', s.full_name, 'xp', x.xp)), '[]'::jsonb)
      FROM public.students s
      JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _class_id
      ORDER BY x.xp DESC LIMIT 5
    ),
    'class_weak_topics', (
      SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb)
      FROM (
        SELECT d.subject, d.chapter, round(100.0 * sum(CASE WHEN da.is_correct THEN 1 ELSE 0 END) / nullif(count(*),0), 1) AS accuracy
        FROM public.students s
        JOIN public.dpp_attempts att ON att.student_id = s.id AND att.status = 'submitted'
        JOIN public.dpps d ON d.id = att.dpp_id
        JOIN public.dpp_answers da ON da.attempt_id = att.id
        WHERE s.class_id = _class_id
        GROUP BY d.subject, d.chapter
        HAVING count(*) >= 5
        ORDER BY accuracy ASC LIMIT 5
      ) t
    ),
    'interventions', COALESCE(_interventions, '[]'::jsonb)
  );
END; $$;

-- ── Principal school health + class week-over-week trends ──────────────────────
CREATE OR REPLACE FUNCTION public.rpc_principal_school_health()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Principal or admin only';
  END IF;

  RETURN jsonb_build_object(
    'engagement_score', (
      SELECT round(avg(CASE WHEN x.total_battles > 0 OR x.xp > 50 THEN 100 ELSE 40 END), 0)
      FROM public.student_xp x
    ),
    'attendance_today_pct', (
      SELECT CASE WHEN count(*) > 0 THEN round(100.0 * count(*) FILTER (WHERE status = 'present') / count(*), 1) ELSE 0 END
      FROM public.attendance WHERE date = CURRENT_DATE
    ),
    'dpp_completion_pct', (
      SELECT CASE WHEN count(DISTINCT d.id) > 0 THEN round(100.0 * count(DISTINCT att.dpp_id) / count(DISTINCT d.id), 1) ELSE 0 END
      FROM public.dpps d
      LEFT JOIN public.dpp_attempts att ON att.dpp_id = d.id AND att.status = 'submitted'
      WHERE d.is_published
    ),
    'classes', (
      SELECT COALESCE(jsonb_agg(cls ORDER BY cls->>'name'), '[]'::jsonb)
      FROM (
        SELECT jsonb_build_object(
          'class_id', c.id,
          'name', COALESCE(c.display_name, c.name || '-' || c.section),
          'students', (SELECT count(*) FROM public.students s WHERE s.class_id = c.id),
          'avg_xp', (SELECT round(avg(x.xp),0) FROM public.students s JOIN public.student_xp x ON x.user_id = s.user_id WHERE s.class_id = c.id),
          'trend', CASE
            WHEN COALESCE(t.engagement_delta, 0) > 8 OR COALESCE(t.dpp_delta, 0) > 5 OR COALESCE(t.attendance_delta, 0) > 3 THEN 'up'
            WHEN COALESCE(t.engagement_delta, 0) < -8 OR COALESCE(t.dpp_delta, 0) < -5 OR COALESCE(t.attendance_delta, 0) < -3 THEN 'down'
            ELSE 'flat'
          END,
          'engagement_delta', COALESCE(t.engagement_delta, 0),
          'dpp_delta', COALESCE(t.dpp_delta, 0),
          'attendance_delta', COALESCE(t.attendance_delta, 0)
        ) AS cls
        FROM public.classes c
        LEFT JOIN LATERAL (
          WITH class_uids AS (
            SELECT s.user_id FROM public.students s WHERE s.class_id = c.id AND s.user_id IS NOT NULL
          ),
          recent_eng AS (
            SELECT COALESCE(sum(a.dpp_count + a.homework_count + a.battle_count), 0)::numeric AS v
            FROM public.academic_daily_activity a
            JOIN class_uids u ON u.user_id = a.user_id
            WHERE a.activity_date BETWEEN CURRENT_DATE - 6 AND CURRENT_DATE
          ),
          prior_eng AS (
            SELECT COALESCE(sum(a.dpp_count + a.homework_count + a.battle_count), 0)::numeric AS v
            FROM public.academic_daily_activity a
            JOIN class_uids u ON u.user_id = a.user_id
            WHERE a.activity_date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7
          ),
          recent_dpp AS (
            SELECT count(*)::numeric AS v FROM public.dpp_attempts att
            JOIN public.students s ON s.id = att.student_id
            WHERE s.class_id = c.id AND att.status = 'submitted'
              AND att.submitted_at >= (CURRENT_DATE - 6)::timestamptz
          ),
          prior_dpp AS (
            SELECT count(*)::numeric AS v FROM public.dpp_attempts att
            JOIN public.students s ON s.id = att.student_id
            WHERE s.class_id = c.id AND att.status = 'submitted'
              AND att.submitted_at >= (CURRENT_DATE - 13)::timestamptz
              AND att.submitted_at < (CURRENT_DATE - 6)::timestamptz
          ),
          recent_att AS (
            SELECT CASE WHEN count(*) > 0 THEN 100.0 * count(*) FILTER (WHERE at.status = 'present') / count(*) ELSE 0 END AS v
            FROM public.attendance at
            JOIN public.students s ON s.id = at.student_id
            WHERE s.class_id = c.id AND at.date BETWEEN CURRENT_DATE - 6 AND CURRENT_DATE
          ),
          prior_att AS (
            SELECT CASE WHEN count(*) > 0 THEN 100.0 * count(*) FILTER (WHERE at.status = 'present') / count(*) ELSE 0 END AS v
            FROM public.attendance at
            JOIN public.students s ON s.id = at.student_id
            WHERE s.class_id = c.id AND at.date BETWEEN CURRENT_DATE - 13 AND CURRENT_DATE - 7
          )
          SELECT
            round((SELECT v FROM recent_eng) - (SELECT v FROM prior_eng), 1) AS engagement_delta,
            round((SELECT v FROM recent_dpp) - (SELECT v FROM prior_dpp), 1) AS dpp_delta,
            round((SELECT v FROM recent_att) - (SELECT v FROM prior_att), 1) AS attendance_delta
        ) t ON true
        WHERE c.kind = 'class' OR c.kind IS NULL
      ) sub
    ),
    'declining_classes', '[]'::jsonb,
    'improving_classes', '[]'::jsonb
  );
END; $$;
