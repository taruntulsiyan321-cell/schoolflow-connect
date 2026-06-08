-- FRESH DATABASE batch 11/12
-- For NEW empty Supabase project (paste in SQL Editor → Run)
-- Project: imrsjhftejghcrhzdjrl

-- ── 20260606000000_student_success_platform.sql

-- Wisdom Campus — Student Success & Academic Engagement Platform (Phase 1)
-- Mistake bank, revision queue, activity heatmap, unified academic RPCs, role-scoped visibility.

-- ── Mistake bank ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.student_mistakes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  source text NOT NULL CHECK (source IN ('dpp', 'battleground', 'exam', 'practice')),
  source_id uuid,
  question_id uuid,
  subject text NOT NULL DEFAULT 'General',
  chapter text,
  topic text,
  question_text text NOT NULL,
  options jsonb,
  student_answer jsonb,
  correct_answer jsonb,
  explanation text,
  times_wrong int NOT NULL DEFAULT 1,
  last_wrong_at timestamptz NOT NULL DEFAULT now(),
  mastered boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS student_mistakes_user_source_q
  ON public.student_mistakes (user_id, source, question_id)
  WHERE question_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS student_mistakes_user_active
  ON public.student_mistakes (user_id, mastered, last_wrong_at DESC);

ALTER TABLE public.student_mistakes ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mistakes self" ON public.student_mistakes;
CREATE POLICY "mistakes self" ON public.student_mistakes
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "mistakes parent child" ON public.student_mistakes;
CREATE POLICY "mistakes parent child" ON public.student_mistakes
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = student_mistakes.user_id AND s.parent_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "mistakes teacher class" ON public.student_mistakes;
CREATE POLICY "mistakes teacher class" ON public.student_mistakes
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin')
    OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = student_mistakes.user_id
        AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── Revision queue ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.revision_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  subject text NOT NULL,
  chapter text,
  topic text,
  reason text NOT NULL DEFAULT 'weak_topic',
  priority int NOT NULL DEFAULT 50,
  due_date date NOT NULL DEFAULT CURRENT_DATE,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS revision_queue_user_open
  ON public.revision_queue (user_id, completed, priority DESC);

ALTER TABLE public.revision_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "revision self" ON public.revision_queue;
CREATE POLICY "revision self" ON public.revision_queue
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "revision parent" ON public.revision_queue;
CREATE POLICY "revision parent" ON public.revision_queue
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = revision_queue.user_id AND s.parent_user_id = auth.uid())
  );

-- ── Daily academic activity (heatmap) ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.academic_daily_activity (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  activity_date date NOT NULL,
  dpp_count int NOT NULL DEFAULT 0,
  homework_count int NOT NULL DEFAULT 0,
  battle_count int NOT NULL DEFAULT 0,
  practice_minutes int NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, activity_date)
);

ALTER TABLE public.academic_daily_activity ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "activity self" ON public.academic_daily_activity;
CREATE POLICY "activity self" ON public.academic_daily_activity
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "activity parent" ON public.academic_daily_activity;
CREATE POLICY "activity parent" ON public.academic_daily_activity
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = academic_daily_activity.user_id AND s.parent_user_id = auth.uid())
  );

-- ── Bump daily activity ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._bump_academic_activity(
  _uid uuid, _dpp int DEFAULT 0, _hw int DEFAULT 0, _battle int DEFAULT 0, _mins int DEFAULT 0
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.academic_daily_activity (user_id, activity_date, dpp_count, homework_count, battle_count, practice_minutes)
  VALUES (_uid, CURRENT_DATE, _dpp, _hw, _battle, _mins)
  ON CONFLICT (user_id, activity_date) DO UPDATE SET
    dpp_count = academic_daily_activity.dpp_count + EXCLUDED.dpp_count,
    homework_count = academic_daily_activity.homework_count + EXCLUDED.homework_count,
    battle_count = academic_daily_activity.battle_count + EXCLUDED.battle_count,
    practice_minutes = academic_daily_activity.practice_minutes + EXCLUDED.practice_minutes;
END; $$;

-- ── Record mistakes from DPP attempt ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_dpp_mistakes(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att record; _dpp record; _q record; _ans record;
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

    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    VALUES (
      _att.user_id, _att.student_id,
      COALESCE(_att.subject, 'General'), _att.chapter, _att.topic,
      'dpp_wrong', 70, CURRENT_DATE
    );
  END LOOP;
END; $$;

-- ── Rebuild revision queue from weak topic stats ─────────────────────────────
CREATE OR REPLACE FUNCTION public._rebuild_revision_queue(_uid uuid, _student_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _row record;
BEGIN
  DELETE FROM public.revision_queue WHERE user_id = _uid AND reason = 'weak_topic' AND NOT completed;
  FOR _row IN
    SELECT * FROM public._weak_topics_for_user(_uid) WHERE accuracy < 60 ORDER BY accuracy ASC LIMIT 8
  LOOP
    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    VALUES (_uid, _student_id, _row.subject, _row.chapter, _row.topic, 'weak_topic', 90 - _row.accuracy::int, CURRENT_DATE);
  END LOOP;
END; $$;

-- Weak topic helper (DPP + battles)
CREATE OR REPLACE FUNCTION public._weak_topics_for_user(_uid uuid)
RETURNS TABLE(subject text, chapter text, topic text, attempts int, correct int, accuracy numeric)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH dpp_stats AS (
    SELECT d.subject, d.chapter, d.topic,
           count(*)::int AS attempts,
           count(*) FILTER (WHERE da.is_correct)::int AS correct
    FROM public.dpp_attempts att
    JOIN public.dpps d ON d.id = att.dpp_id
    JOIN public.dpp_answers da ON da.attempt_id = att.id
    WHERE att.user_id = _uid AND att.status = 'submitted'
    GROUP BY d.subject, d.chapter, d.topic
  ),
  battle_stats AS (
    SELECT b.subject, b.chapter, b.topic,
           count(ba.id)::int AS attempts,
           count(*) FILTER (WHERE ba.is_correct)::int AS correct
    FROM public.battle_participants bp
    JOIN public.battles b ON b.id = bp.battle_id
    JOIN public.battle_answers ba ON ba.participant_id = bp.id
    WHERE bp.user_id = _uid AND bp.finished_at IS NOT NULL
    GROUP BY b.subject, b.chapter, b.topic
  ),
  combined AS (
    SELECT subject, chapter, topic, sum(attempts) AS attempts, sum(correct) AS correct
    FROM (
      SELECT * FROM dpp_stats UNION ALL SELECT * FROM battle_stats
    ) u GROUP BY subject, chapter, topic
  )
  SELECT subject, chapter, topic, attempts, correct,
         CASE WHEN attempts > 0 THEN round(100.0 * correct / attempts, 1) ELSE 0 END AS accuracy
  FROM combined WHERE attempts >= 2;
$$;

-- ── Exam readiness score ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._exam_readiness(_uid uuid, _student_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att_pct numeric := 0; _dpp_pct numeric := 0; _acc numeric := 0;
  _practice int := 0; _score numeric := 0; _label text; _tone text;
  _att_total int; _att_present int; _dpp_done int; _dpp_total int;
BEGIN
  IF _student_id IS NOT NULL THEN
    SELECT count(*), count(*) FILTER (WHERE status = 'present')
      INTO _att_total, _att_present FROM public.attendance WHERE student_id = _student_id;
    IF _att_total > 0 THEN _att_pct := 100.0 * _att_present / _att_total; END IF;
  END IF;

  SELECT count(DISTINCT dpp_id) FILTER (WHERE status = 'submitted'),
         count(DISTINCT dpp_id)
    INTO _dpp_done, _dpp_total
  FROM public.dpp_attempts WHERE user_id = _uid;
  IF _dpp_total > 0 THEN _dpp_pct := 100.0 * _dpp_done / _dpp_total; END IF;

  SELECT COALESCE(round(avg(CASE WHEN total_count > 0 THEN 100.0 * correct_count / total_count END), 1), 0)
    INTO _acc FROM public.dpp_attempts WHERE user_id = _uid AND status = 'submitted';

  SELECT COALESCE(sum(dpp_count + homework_count + battle_count), 0)
    INTO _practice FROM public.academic_daily_activity
    WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14;

  _score := LEAST(100, round(
    _att_pct * 0.25 + _dpp_pct * 0.25 + _acc * 0.35 + LEAST(_practice, 14) / 14.0 * 100 * 0.15
  , 0));

  IF _score >= 75 THEN _label := 'Ready'; _tone := 'ready';
  ELSIF _score >= 50 THEN _label := 'Needs Improvement'; _tone := 'improving';
  ELSE _label := 'High Risk'; _tone := 'risk';
  END IF;

  RETURN jsonb_build_object(
    'score', _score, 'label', _label, 'tone', _tone,
    'attendance_pct', round(_att_pct, 1), 'dpp_completion_pct', round(_dpp_pct, 1),
    'accuracy_pct', _acc, 'active_days_14d', _practice
  );
END; $$;

-- ── Student academic snapshot (self only) ──────────────────────────────────────
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

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'topic', topic, 'chapter', chapter, 'priority', priority, 'due_date', due_date
  ) ORDER BY priority DESC), '[]'::jsonb)
    INTO _rev FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed LIMIT 10;

  PERFORM public._rebuild_revision_queue(_uid, _s.id);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'topic', topic, 'chapter', chapter, 'priority', priority, 'due_date', due_date
  ) ORDER BY priority DESC), '[]'::jsonb)
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

GRANT EXECUTE ON FUNCTION public.rpc_student_academic_snapshot() TO authenticated;

-- Internal snapshot by user id (parent / service)
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot_internal(_uid uuid, _student_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN jsonb_build_object(
    'weak_topics', (SELECT COALESCE(jsonb_agg(row_to_json(w)), '[]'::jsonb) FROM public._weak_topics_for_user(_uid) w WHERE accuracy < 65 LIMIT 5),
    'strong_topics', (SELECT COALESCE(jsonb_agg(row_to_json(w)), '[]'::jsonb) FROM public._weak_topics_for_user(_uid) w WHERE accuracy >= 75 LIMIT 5),
    'exam_readiness', public._exam_readiness(_uid, _student_id),
    'mistake_count', (SELECT count(*) FROM public.student_mistakes WHERE user_id = _uid AND NOT mastered),
    'activity_heatmap', (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', activity_date, 'total', dpp_count+homework_count+battle_count) ORDER BY activity_date), '[]'::jsonb)
      FROM public.academic_daily_activity WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 14)
  );
END; $$;

-- ── Parent: child snapshot ─────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_parent_child_snapshot(_student_id uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _s record; _child_uid uuid;
BEGIN
  IF NOT public.has_role(_uid, 'parent') AND NOT public.has_role(_uid, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;
  SELECT * INTO _s FROM public.students
    WHERE (_student_id IS NULL AND parent_user_id = _uid)
       OR (id = _student_id AND (parent_user_id = _uid OR public.has_role(_uid, 'admin')))
    LIMIT 1;
  IF _s IS NULL THEN RETURN '{}'::jsonb; END IF;
  _child_uid := _s.user_id;
  IF _child_uid IS NULL THEN
    RETURN jsonb_build_object('student', to_jsonb(_s), 'linked', false);
  END IF;
  RETURN jsonb_build_object(
    'student', to_jsonb(_s),
    'linked', true,
    'snapshot', (SELECT public.rpc_student_academic_snapshot_internal(_child_uid, _s.id))
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_parent_child_snapshot(uuid) TO authenticated;

-- ── Teacher: class insights ──────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_teacher_class_insights(_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal')
     AND NOT public.teacher_teaches_class(_uid, _class_id) THEN
    RAISE EXCEPTION 'Not authorized for this class';
  END IF;

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
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_teacher_class_insights(uuid) TO authenticated;

-- ── Principal: school health (aggregates only) ─────────────────────────────────
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
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'class_id', c.id, 'name', COALESCE(c.display_name, c.name || '-' || c.section),
        'students', (SELECT count(*) FROM public.students s WHERE s.class_id = c.id),
        'avg_xp', (SELECT round(avg(x.xp),0) FROM public.students s JOIN public.student_xp x ON x.user_id = s.user_id WHERE s.class_id = c.id)
      )), '[]'::jsonb)
      FROM public.classes c WHERE c.kind = 'class' OR c.kind IS NULL
    ),
    'declining_classes', '[]'::jsonb,
    'improving_classes', '[]'::jsonb
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_principal_school_health() TO authenticated;

-- ── Patch DPP submit: mistakes + activity ────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_dpp_submit(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _att record; _q record; _ans record; _correct boolean; _award numeric;
        _score numeric := 0; _correct_n int := 0; _total int := 0; _neg numeric;
        _resp jsonb; _selected jsonb; _val numeric; _tol numeric;
BEGIN
  SELECT * INTO _att FROM public.dpp_attempts WHERE id = _attempt_id;
  IF _att IS NULL OR _att.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your attempt'; END IF;
  IF _att.status = 'submitted' THEN RETURN; END IF;
  SELECT negative_marking INTO _neg FROM public.dpps WHERE id = _att.dpp_id;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    _total := _total + 1;
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    _correct := false; _award := 0;
    IF _ans IS NOT NULL THEN
      _resp := _ans.response;
      IF _q.kind IN ('mcq','multi') THEN
        _selected := COALESCE(_resp->'indexes','[]'::jsonb);
        IF (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_selected) AS value)
           = (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_q.correct->'indexes') AS value)
        THEN _correct := true; END IF;
      ELSIF _q.kind = 'numerical' THEN
        _val := (_resp->>'value')::numeric;
        _tol := COALESCE((_q.correct->>'tolerance')::numeric, 0);
        IF _val IS NOT NULL AND abs(_val - (_q.correct->>'value')::numeric) <= _tol THEN _correct := true; END IF;
      ELSIF _q.kind = 'short' THEN
        IF lower(trim(COALESCE(_resp->>'text',''))) = lower(trim(COALESCE(_q.correct->>'text',''))) THEN _correct := true; END IF;
      END IF;

      IF _correct THEN
        _award := _q.marks; _correct_n := _correct_n + 1;
      ELSIF _resp <> '{}'::jsonb THEN
        _award := -1 * _neg;
      END IF;

      UPDATE public.dpp_answers SET is_correct = _correct, marks_awarded = _award WHERE id = _ans.id;
      _score := _score + _award;
    END IF;
  END LOOP;

  UPDATE public.dpp_attempts SET
    status = 'submitted', submitted_at = now(),
    score = _score, correct_count = _correct_n, total_count = _total,
    time_spent_sec = GREATEST(EXTRACT(EPOCH FROM (now() - started_at))::int, 0)
  WHERE id = _attempt_id;

  INSERT INTO public.student_xp(user_id, xp, level, last_battle_at)
  VALUES (auth.uid(), GREATEST(_score::int,0), 1 + (GREATEST(_score::int,0) / 100), now())
  ON CONFLICT (user_id) DO UPDATE SET
    xp = student_xp.xp + GREATEST(_score::int,0),
    level = 1 + ((student_xp.xp + GREATEST(_score::int,0)) / 100),
    updated_at = now();

  INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'first_dpp','bronze')
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  IF _total > 0 AND _correct_n = _total THEN
    INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'dpp_perfect','gold')
      ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;

  PERFORM public._capture_dpp_mistakes(_attempt_id);
  PERFORM public._bump_academic_activity(auth.uid(), 1, 0, 0, GREATEST(_att.time_spent_sec / 60, 1));
END; $$;

-- Mark revision item complete
CREATE OR REPLACE FUNCTION public.rpc_complete_revision(_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.revision_queue SET completed = true, completed_at = now()
    WHERE id = _id AND user_id = auth.uid();
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_complete_revision(uuid) TO authenticated;



-- ── 20260607000000_student_success_phase2.sql

-- Phase 2: Parent digests, battle mistakes, charts RPC, expanded badges

-- ── Parent in-app alerts (weekly digest) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.parent_academic_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  parent_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid NOT NULL REFERENCES public.students(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('weakness', 'consistency', 'improvement', 'participation')),
  title text NOT NULL,
  body text NOT NULL,
  read boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS parent_alerts_parent_recent
  ON public.parent_academic_alerts (parent_user_id, created_at DESC);

ALTER TABLE public.parent_academic_alerts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "parent alerts own" ON public.parent_academic_alerts;
CREATE POLICY "parent alerts own" ON public.parent_academic_alerts
  FOR ALL TO authenticated
  USING (parent_user_id = auth.uid()) WITH CHECK (parent_user_id = auth.uid());

-- ── Capture battle wrong answers into mistake bank ───────────────────────────
CREATE OR REPLACE FUNCTION public._capture_battle_mistakes(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bp record; _ba record; _bq record; _b record;
BEGIN
  SELECT bp.*, b.subject, b.chapter, b.topic
    INTO _bp
  FROM public.battle_participants bp
  JOIN public.battles b ON b.id = bp.battle_id
  WHERE bp.id = _participant_id;
  IF _bp IS NULL THEN RETURN; END IF;

  FOR _ba IN
    SELECT ba.*, bq.question, bq.options, bq.correct_index, bq.bank_question_id
    FROM public.battle_answers ba
    JOIN public.battle_questions bq ON bq.id = ba.question_id
    WHERE ba.participant_id = _participant_id AND NOT ba.is_correct
  LOOP
    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      subject, chapter, topic, question_text, options,
      student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _bp.user_id, _bp.student_id, 'battleground', _bp.battle_id, _ba.question_id,
      COALESCE(_bp.subject, 'General'), _bp.chapter, _bp.topic,
      _ba.question, _ba.options,
      jsonb_build_object('selected_index', _ba.selected_index),
      jsonb_build_object('correct_index', _ba.correct_index),
      NULL, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      mastered = false;
  END LOOP;
END; $$;

-- ── Expanded badge awards (consistency, mastery, hidden) ────────────────────
CREATE OR REPLACE FUNCTION public._award_engagement_badges(_uid uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _xp record; _subj record; _distinct_subjects int; _dpp_count int; _rank int;
BEGIN
  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _uid;
  IF _xp IS NULL THEN RETURN; END IF;

  IF COALESCE(_xp.current_streak, 0) >= 3  THEN PERFORM public._award_badge(_uid, 'streak_starter', 'bronze'); END IF;
  IF COALESCE(_xp.current_streak, 0) >= 7  THEN PERFORM public._award_badge(_uid, 'consistency', 'silver'); END IF;
  IF COALESCE(_xp.current_streak, 0) >= 30 THEN PERFORM public._award_badge(_uid, 'streak_legend', 'platinum'); END IF;

  SELECT count(*) INTO _dpp_count FROM public.dpp_attempts WHERE user_id = _uid AND status = 'submitted';
  IF _dpp_count >= 10 THEN PERFORM public._award_badge(_uid, 'homework_warrior', 'silver'); END IF;

  SELECT count(DISTINCT b.subject) INTO _distinct_subjects
  FROM public.battle_participants bp
  JOIN public.battles b ON b.id = bp.battle_id
  WHERE bp.user_id = _uid AND bp.finished_at IS NOT NULL;
  IF _distinct_subjects >= 5 THEN PERFORM public._award_badge(_uid, 'explorer', 'bronze'); END IF;

  FOR _subj IN
    SELECT subject, accuracy FROM public._weak_topics_for_user(_uid) WHERE accuracy >= 85 AND attempts >= 8
  LOOP
    IF lower(_subj.subject) LIKE '%math%' THEN
      PERFORM public._award_badge(_uid, 'math_master', 'gold');
    ELSIF lower(_subj.subject) LIKE '%phys%' OR lower(_subj.subject) LIKE '%chem%' OR lower(_subj.subject) = 'science' THEN
      PERFORM public._award_badge(_uid, 'science_master', 'gold');
    END IF;
  END LOOP;

  IF (SELECT count(*) FROM public._weak_topics_for_user(_uid) WHERE accuracy >= 80 AND attempts >= 5) >= 3 THEN
    PERFORM public._award_badge(_uid, 'polymath', 'legendary');
  END IF;

  IF _xp.win_streak = 1 AND _xp.wins > 0 AND COALESCE(_xp.best_win_streak, 0) <= 1 THEN
    PERFORM public._award_badge(_uid, 'comeback_king', 'gold');
  END IF;

  IF _xp.total_battles = 42 AND _xp.total_correct >= _xp.total_answered AND _xp.total_answered > 0 THEN
    PERFORM public._award_badge(_uid, 'the_chosen_one', 'legendary');
  END IF;

  SELECT count(*) + 1 INTO _rank
  FROM public.students peer
  JOIN public.student_xp px ON px.user_id = peer.user_id
  WHERE peer.class_id = (SELECT class_id FROM public.students WHERE user_id = _uid LIMIT 1)
    AND peer.user_id <> _uid
    AND px.xp > COALESCE(_xp.xp, 0);
  IF _rank = 1 THEN
    PERFORM public._award_badge(_uid, 'class_king', 'gold');
    PERFORM public._award_badge(_uid, 'podium', 'silver');
  ELSIF _rank <= 3 THEN
    PERFORM public._award_badge(_uid, 'podium', 'silver');
  END IF;
END; $$;

-- ── Parent weekly digest + alert generation ──────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_parent_weekly_digest()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _parent uuid := auth.uid(); _result jsonb := '[]'::jsonb; _child record; _snap jsonb;
  _week_ago date := CURRENT_DATE - 7;
BEGIN
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  FOR _child IN
    SELECT s.* FROM public.students s WHERE s.parent_user_id = _parent
  LOOP
    IF _child.user_id IS NOT NULL THEN
      _snap := public.rpc_student_academic_snapshot_internal(_child.user_id, _child.id);

      IF (_snap->'exam_readiness'->>'score')::numeric < 50
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'weakness' AND a.title = 'Needs support in practice'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'weakness',
          'Needs support in practice',
          _child.full_name || ' exam readiness is below 50%. Encourage daily DPP and revision.');
      END IF;

      IF COALESCE((_snap->'exam_readiness'->>'active_days_14d')::int, 0) < 3
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'consistency' AND a.title = 'Low study consistency'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'consistency',
          'Low study consistency',
          _child.full_name || ' had fewer than 3 active study days in the last two weeks.');
      END IF;

      IF COALESCE((_snap->'mistake_count')::int, 0) > 5
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'weakness' AND a.title = 'Mistakes need revision'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'weakness',
          'Mistakes need revision',
          _child.full_name || ' has ' || (_snap->>'mistake_count') || ' topics in their mistake book.');
      END IF;

      IF (_snap->'exam_readiness'->>'score')::numeric >= 70
         AND jsonb_array_length(COALESCE(_snap->'strong_topics', '[]'::jsonb)) >= 1
         AND NOT EXISTS (
           SELECT 1 FROM public.parent_academic_alerts a
           WHERE a.parent_user_id = _parent AND a.student_id = _child.id
             AND a.kind = 'improvement' AND a.title = 'Strong progress this week'
             AND a.created_at >= now() - interval '7 days'
         ) THEN
        INSERT INTO public.parent_academic_alerts (parent_user_id, student_id, kind, title, body)
        VALUES (_parent, _child.id, 'improvement',
          'Strong progress this week',
          _child.full_name || ' exam readiness is ' || (_snap->'exam_readiness'->>'score') || '% with strong topics emerging. Celebrate the momentum!');
      END IF;
    END IF;

    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name', _child.full_name,
      'class', (SELECT COALESCE(display_name, name || '-' || section) FROM public.classes WHERE id = _child.class_id),
      'snapshot', COALESCE(_snap, '{}'::jsonb),
      'alerts', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'id', a.id, 'kind', a.kind, 'title', a.title, 'body', a.body,
          'read', a.read, 'created_at', a.created_at
        ) ORDER BY a.created_at DESC), '[]'::jsonb)
        FROM public.parent_academic_alerts a
        WHERE a.parent_user_id = _parent AND a.student_id = _child.id
          AND a.created_at >= now() - interval '7 days'
      )
    ));
  END LOOP;

  RETURN jsonb_build_object('children', _result, 'generated_at', now());
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_parent_weekly_digest() TO authenticated;

-- ── Chart data for student analytics ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_performance_charts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  RETURN jsonb_build_object(
    'subjects', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'name', subject, 'accuracy', accuracy, 'attempts', attempts
      ) ORDER BY accuracy DESC), '[]'::jsonb)
      FROM public._weak_topics_for_user(_uid)
    ),
    'weekly_activity', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', activity_date,
        'total', dpp_count + homework_count + battle_count,
        'dpp', dpp_count,
        'battles', battle_count
      ) ORDER BY activity_date), '[]'::jsonb)
      FROM public.academic_daily_activity
      WHERE user_id = _uid AND activity_date >= CURRENT_DATE - 28
    ),
    'dpp_trend', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'date', date_trunc('day', submitted_at)::date,
        'score_pct', round(100.0 * score / NULLIF(max_score, 0), 1)
      ) ORDER BY date_trunc('day', submitted_at)), '[]'::jsonb)
      FROM public.dpp_attempts
      WHERE user_id = _uid AND status = 'submitted' AND submitted_at >= now() - interval '30 days'
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_performance_charts() TO authenticated;

-- ── Patch finish_battle: mistakes + activity + badges ────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _battle uuid; _score int; _correct int; _answered int; _time int;
  _won boolean := false; _max_score int; _xp record; _avg_ms numeric; _hour int;
  _subject text; _class uuid; _name text; _opp text; _participants int;
  _mins int;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms, display_name
    INTO _user, _battle, _score, _correct, _answered, _time, _name
    FROM public.battle_participants WHERE id = _participant_id;
  IF _user IS NULL OR _user <> auth.uid() THEN RAISE EXCEPTION 'Not your participation'; END IF;

  UPDATE public.battle_participants SET finished_at = COALESCE(finished_at, now()) WHERE id = _participant_id;

  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  SELECT MAX(score), count(*) INTO _max_score, _participants
    FROM public.battle_participants WHERE battle_id = _battle;
  _won := (_score = _max_score AND _score > 0);

  INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at)
  SELECT _user, bq.bank_question_id, 1, now()
  FROM public.battle_answers ba
  JOIN public.battle_questions bq ON bq.id = ba.question_id
  WHERE ba.participant_id = _participant_id AND bq.bank_question_id IS NOT NULL
  ON CONFLICT (user_id, question_id) DO UPDATE
    SET times_seen = student_question_history.times_seen + 1, last_seen_at = now();

  INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at,
    best_score, total_correct, total_answered, win_streak, best_win_streak)
  VALUES (_user, _score, 1 + (_score/100), 1, CASE WHEN _won THEN 1 ELSE 0 END, now(),
    _score, _correct, _answered, CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END)
  ON CONFLICT (user_id) DO UPDATE SET
    xp              = student_xp.xp + EXCLUDED.xp,
    level           = 1 + ((student_xp.xp + EXCLUDED.xp)/100),
    total_battles   = student_xp.total_battles + 1,
    wins            = student_xp.wins + CASE WHEN _won THEN 1 ELSE 0 END,
    last_battle_at  = now(),
    best_score      = GREATEST(student_xp.best_score, _score),
    total_correct   = student_xp.total_correct + _correct,
    total_answered  = student_xp.total_answered + _answered,
    win_streak      = CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END,
    best_win_streak = GREATEST(student_xp.best_win_streak,
                               CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END),
    updated_at      = now(),
    current_streak  = CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1
                      ELSE 0 END,
    longest_streak  = GREATEST(COALESCE(student_xp.longest_streak, 0),
                      CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1 ELSE 0 END);

  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _user;
  _avg_ms := CASE WHEN _answered > 0 THEN _time::numeric / _answered ELSE NULL END;
  _hour   := EXTRACT(HOUR FROM now());

  IF _won THEN PERFORM public._award_badge(_user,'first_win','bronze'); END IF;
  IF _correct >= 5 THEN PERFORM public._award_badge(_user,'sharp_shooter','silver'); END IF;
  IF _answered >= 5 AND _correct = _answered THEN PERFORM public._award_badge(_user,'flawless','gold'); END IF;
  IF _avg_ms IS NOT NULL AND _avg_ms <= 5000 AND _correct >= 3 THEN PERFORM public._award_badge(_user,'speed_master','gold'); END IF;
  IF _avg_ms IS NOT NULL AND _avg_ms <= 3000 AND _correct >= 5 THEN PERFORM public._award_badge(_user,'lightning','platinum'); END IF;
  IF _xp.wins >= 5   THEN PERFORM public._award_badge(_user,'quiz_winner','silver'); END IF;
  IF _xp.wins >= 25  THEN PERFORM public._award_badge(_user,'battleground_master','gold'); END IF;
  IF _xp.wins >= 100 THEN PERFORM public._award_badge(_user,'arena_legend','platinum'); END IF;
  IF _xp.win_streak >= 3  THEN PERFORM public._award_badge(_user,'win_streak_3','silver'); END IF;
  IF _xp.win_streak >= 5  THEN PERFORM public._award_badge(_user,'win_streak_5','gold'); END IF;
  IF _xp.win_streak >= 10 THEN PERFORM public._award_badge(_user,'win_streak_10','platinum'); END IF;
  IF _xp.total_battles >= 10 THEN PERFORM public._award_badge(_user,'gladiator','bronze'); END IF;
  IF _xp.total_battles >= 50 THEN PERFORM public._award_badge(_user,'veteran','gold'); END IF;
  IF _hour < 5 THEN PERFORM public._award_badge(_user,'night_owl','silver'); END IF;
  IF _hour >= 5 AND _hour < 8 THEN PERFORM public._award_badge(_user,'early_bird','silver'); END IF;
  IF _score >= 150 THEN PERFORM public._award_badge(_user,'high_scorer','gold'); END IF;
  IF _score >= 300 THEN PERFORM public._award_badge(_user,'unstoppable','platinum'); END IF;

  SELECT b.subject, b.class_id INTO _subject, _class FROM public.battles b WHERE b.id = _battle;
  SELECT display_name INTO _opp
    FROM public.battle_participants
    WHERE battle_id = _battle AND id <> _participant_id AND finished_at IS NOT NULL
    ORDER BY score DESC LIMIT 1;

  IF _won AND _participants > 1 AND _opp IS NOT NULL THEN
    PERFORM public._battle_event('win', _user, _name,
      'defeated ' || _opp || ' in ' || COALESCE(_subject,'a battle'),
      _subject, _opp, _battle, _class, 'sword');
  ELSIF _won THEN
    PERFORM public._battle_event('win', _user, _name,
      'won a ' || COALESCE(_subject,'') || ' battle',
      _subject, NULL, _battle, _class, 'trophy');
  END IF;

  IF _answered >= 4 AND _correct = _answered THEN
    PERFORM public._battle_event('flawless', _user, _name,
      'achieved 100% accuracy in ' || COALESCE(_subject,'a battle'),
      _subject, NULL, _battle, _class, 'target');
  END IF;

  IF _xp.win_streak >= 3 THEN
    PERFORM public._battle_event('streak', _user, _name,
      'is on a ' || _xp.win_streak || '-battle win streak',
      _subject, NULL, _battle, _class, 'flame');
  END IF;

  _mins := GREATEST(COALESCE(_time / 60000, 1), 1);
  PERFORM public._capture_battle_mistakes(_participant_id);
  PERFORM public._bump_academic_activity(_user, 0, 0, 1, _mins);
  PERFORM public._award_engagement_badges(_user);

  PERFORM public._snapshot_battle_report(_participant_id);
END; $$;

-- ── Patch DPP submit: engagement badges ────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_dpp_submit(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _att record; _q record; _ans record; _correct boolean; _award numeric;
        _score numeric := 0; _correct_n int := 0; _total int := 0; _neg numeric;
        _resp jsonb; _selected jsonb; _val numeric; _tol numeric;
BEGIN
  SELECT * INTO _att FROM public.dpp_attempts WHERE id = _attempt_id;
  IF _att IS NULL OR _att.user_id <> auth.uid() THEN RAISE EXCEPTION 'Not your attempt'; END IF;
  IF _att.status = 'submitted' THEN RETURN; END IF;
  SELECT negative_marking INTO _neg FROM public.dpps WHERE id = _att.dpp_id;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    _total := _total + 1;
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    _correct := false; _award := 0;
    IF _ans IS NOT NULL THEN
      _resp := _ans.response;
      IF _q.kind IN ('mcq','multi') THEN
        _selected := COALESCE(_resp->'indexes','[]'::jsonb);
        IF (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_selected) AS value)
           = (SELECT array_agg(value::int ORDER BY value::int) FROM jsonb_array_elements_text(_q.correct->'indexes') AS value)
        THEN _correct := true; END IF;
      ELSIF _q.kind = 'numerical' THEN
        _val := (_resp->>'value')::numeric;
        _tol := COALESCE((_q.correct->>'tolerance')::numeric, 0);
        IF _val IS NOT NULL AND abs(_val - (_q.correct->>'value')::numeric) <= _tol THEN _correct := true; END IF;
      ELSIF _q.kind = 'short' THEN
        IF lower(trim(COALESCE(_resp->>'text',''))) = lower(trim(COALESCE(_q.correct->>'text',''))) THEN _correct := true; END IF;
      END IF;

      IF _correct THEN
        _award := _q.marks; _correct_n := _correct_n + 1;
      ELSIF _resp <> '{}'::jsonb THEN
        _award := -1 * _neg;
      END IF;

      UPDATE public.dpp_answers SET is_correct = _correct, marks_awarded = _award WHERE id = _ans.id;
      _score := _score + _award;
    END IF;
  END LOOP;

  UPDATE public.dpp_attempts SET
    status = 'submitted', submitted_at = now(),
    score = _score, correct_count = _correct_n, total_count = _total,
    time_spent_sec = GREATEST(EXTRACT(EPOCH FROM (now() - started_at))::int, 0)
  WHERE id = _attempt_id;

  INSERT INTO public.student_xp(user_id, xp, level, last_battle_at)
  VALUES (auth.uid(), GREATEST(_score::int,0), 1 + (GREATEST(_score::int,0) / 100), now())
  ON CONFLICT (user_id) DO UPDATE SET
    xp = student_xp.xp + GREATEST(_score::int,0),
    level = 1 + ((student_xp.xp + GREATEST(_score::int,0)) / 100),
    updated_at = now();

  INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'first_dpp','bronze')
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  IF _total > 0 AND _correct_n = _total THEN
    INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (auth.uid(), 'dpp_perfect','gold')
      ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;

  PERFORM public._capture_dpp_mistakes(_attempt_id);
  PERFORM public._bump_academic_activity(auth.uid(), 1, 0, 0, GREATEST(_att.time_spent_sec / 60, 1));
  PERFORM public._award_engagement_badges(auth.uid());
END; $$;



-- ── 20260608000000_student_success_phase3.sql

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



-- ── 20260609000000_fix_quick_battle_overload.sql

-- Fix: "Could not choose the best candidate function" for rpc_create_quick_battle
-- Cause: 6-arg version (20260513) + 7-arg version (phase4) both exist after partial migrations.

DROP FUNCTION IF EXISTS public.rpc_create_quick_battle(text, text, integer, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.rpc_create_quick_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _class_id uuid DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (
    'Quick Battle · ' || _subject || COALESCE(' · ' || _chapter, ''),
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now()
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;


