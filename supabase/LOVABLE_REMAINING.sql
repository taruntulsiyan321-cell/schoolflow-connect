-- LOVABLE REMAINING: paste once in SQL Editor
-- Project: kdmjipeksjdyojjdokbi (Lovable)

-- ========== 20260607000000_student_success_phase2.sql ==========

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


-- ========== 20260608000000_student_success_phase3.sql ==========

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


-- ========== 20260607033426_44e6c2c6-c95e-4dc5-9444-9cf9ce5a4758.sql ==========

-- Wisdom Campus demo dataset (idempotent) — fixed for current schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public._demo_upsert_auth_user(
  _id uuid, _email text, _password text, _full_name text
) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = _id) THEN
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
      created_at, updated_at,
      confirmation_token, email_change, email_change_token_new, recovery_token
    ) VALUES (
      _id, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
      lower(_email), extensions.crypt(_password, extensions.gen_salt('bf')), now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', _full_name),
      now(), now(), '', '', '', ''
    );
  ELSE
    UPDATE auth.users SET
      email = lower(_email),
      encrypted_password = extensions.crypt(_password, extensions.gen_salt('bf')),
      email_confirmed_at = COALESCE(email_confirmed_at, now()),
      raw_user_meta_data = jsonb_build_object('full_name', _full_name),
      updated_at = now()
    WHERE id = _id;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM auth.identities WHERE user_id = _id AND provider = 'email') THEN
    INSERT INTO auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
    VALUES (_id, _id, jsonb_build_object('sub', _id::text, 'email', lower(_email)), 'email', _id::text, now(), now(), now());
  END IF;
END;
$$;

DO $demo$
DECLARE
  _pw text := 'DemoPass123!';
  u_admin     uuid := 'd1000001-0001-4000-8000-000000000001';
  u_principal uuid := 'd1000001-0002-4000-8000-000000000002';
  u_t_math    uuid := 'd1000002-0001-4000-8000-000000000001';
  u_t_phys    uuid := 'd1000002-0002-4000-8000-000000000002';
  u_s1        uuid := 'd1000003-0001-4000-8000-000000000001';
  u_s2        uuid := 'd1000003-0002-4000-8000-000000000002';
  u_s3        uuid := 'd1000003-0003-4000-8000-000000000003';
  u_s4        uuid := 'd1000003-0004-4000-8000-000000000004';
  u_s5        uuid := 'd1000003-0005-4000-8000-000000000005';
  u_p1        uuid := 'd1000004-0001-4000-8000-000000000001';
  u_p2        uuid := 'd1000004-0002-4000-8000-000000000002';
  c10a        uuid := 'd2000001-0001-4000-8000-000000000001';
  c9a         uuid := 'd2000001-0002-4000-8000-000000000002';
  t_math      uuid := 'd3000002-0001-4000-8000-000000000001';
  t_phys      uuid := 'd3000002-0002-4000-8000-000000000002';
  st1         uuid := 'd3000001-0001-4000-8000-000000000001';
  st2         uuid := 'd3000001-0002-4000-8000-000000000002';
  st3         uuid := 'd3000001-0003-4000-8000-000000000003';
  st4         uuid := 'd3000001-0004-4000-8000-000000000004';
  st5         uuid := 'd3000001-0005-4000-8000-000000000005';
  b_sched     uuid := 'd4000001-0001-4000-8000-000000000001';
  b_live      uuid := 'd4000001-0002-4000-8000-000000000002';
  b_done      uuid := 'd4000001-0003-4000-8000-000000000003';
  bp_done1    uuid := 'd4000002-0001-4000-8000-000000000001';
  bp_done2    uuid := 'd4000002-0002-4000-8000-000000000002';
  bq_done1    uuid := 'd4000003-0001-4000-8000-000000000001';
  bq_done2    uuid := 'd4000003-0002-4000-8000-000000000002';
  dpp_pub     uuid := 'd5000001-0001-4000-8000-000000000001';
  dpp_draft   uuid := 'd5000001-0002-4000-8000-000000000002';
  dpp_q1      uuid := 'd5000002-0001-4000-8000-000000000001';
  dpp_q2      uuid := 'd5000002-0002-4000-8000-000000000002';
  dpp_att     uuid := 'd5000003-0001-4000-8000-000000000001';
  hw1         uuid := 'd6000001-0001-4000-8000-000000000001';
  hw_sub1     uuid := 'd6000002-0001-4000-8000-000000000001';
  lib_book1   uuid := 'd7000001-0001-4000-8000-000000000001';
  lib_co1     uuid := 'd7000002-0001-4000-8000-000000000001';
  exam1       uuid := 'd8000001-0001-4000-8000-000000000001';
  exam2       uuid := 'd8000001-0002-4000-8000-000000000002';
  _qb_id      uuid;
  _today      date := CURRENT_DATE;
  _yr         text := '2025-26';
BEGIN
  PERFORM public._demo_upsert_auth_user(u_admin,     'admin@wisdomcampus.demo',         _pw, 'Ravi Krishnan');
  PERFORM public._demo_upsert_auth_user(u_principal, 'principal@wisdomcampus.demo',     _pw, 'Sunita Nair');
  PERFORM public._demo_upsert_auth_user(u_t_math,    'priya.sharma@wisdomcampus.demo',  _pw, 'Priya Sharma');
  PERFORM public._demo_upsert_auth_user(u_t_phys,    'rajesh.verma@wisdomcampus.demo',  _pw, 'Rajesh Verma');
  PERFORM public._demo_upsert_auth_user(u_s1,        'arjun.mehta@wisdomcampus.demo',   _pw, 'Arjun Mehta');
  PERFORM public._demo_upsert_auth_user(u_s2,        'priya.patel@wisdomcampus.demo',   _pw, 'Priya Patel');
  PERFORM public._demo_upsert_auth_user(u_s3,        'rohan.singh@wisdomcampus.demo',   _pw, 'Rohan Singh');
  PERFORM public._demo_upsert_auth_user(u_s4,        'ananya.iyer@wisdomcampus.demo',   _pw, 'Ananya Iyer');
  PERFORM public._demo_upsert_auth_user(u_s5,        'vikram.joshi@wisdomcampus.demo',  _pw, 'Vikram Joshi');
  PERFORM public._demo_upsert_auth_user(u_p1,        'mehta.parent@wisdomcampus.demo',  _pw, 'Suresh Mehta');
  PERFORM public._demo_upsert_auth_user(u_p2,        'patel.parent@wisdomcampus.demo',  _pw, 'Kavita Patel');

  INSERT INTO public.profiles (id, full_name, email) VALUES
    (u_admin,'Ravi Krishnan','admin@wisdomcampus.demo'),
    (u_principal,'Sunita Nair','principal@wisdomcampus.demo'),
    (u_t_math,'Priya Sharma','priya.sharma@wisdomcampus.demo'),
    (u_t_phys,'Rajesh Verma','rajesh.verma@wisdomcampus.demo'),
    (u_s1,'Arjun Mehta','arjun.mehta@wisdomcampus.demo'),
    (u_s2,'Priya Patel','priya.patel@wisdomcampus.demo'),
    (u_s3,'Rohan Singh','rohan.singh@wisdomcampus.demo'),
    (u_s4,'Ananya Iyer','ananya.iyer@wisdomcampus.demo'),
    (u_s5,'Vikram Joshi','vikram.joshi@wisdomcampus.demo'),
    (u_p1,'Suresh Mehta','mehta.parent@wisdomcampus.demo'),
    (u_p2,'Kavita Patel','patel.parent@wisdomcampus.demo')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin,'admin'),(u_principal,'principal'),
    (u_t_math,'teacher'),(u_t_phys,'teacher'),
    (u_s1,'student'),(u_s2,'student'),(u_s3,'student'),(u_s4,'student'),(u_s5,'student'),
    (u_p1,'parent'),(u_p2,'parent')
  ON CONFLICT (user_id, role) DO NOTHING;

  INSERT INTO public.classes (id, name, section, academic_year, kind, display_name, category) VALUES
    (c10a,'10','A',_yr,'class','Class 10-A','Secondary'),
    (c9a, '9', 'A',_yr,'class','Class 9-A', 'Secondary')
  ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, section=EXCLUDED.section, academic_year=EXCLUDED.academic_year, display_name=EXCLUDED.display_name, category=EXCLUDED.category;

  INSERT INTO public.teachers (id, user_id, full_name, subject, mobile, email, is_class_teacher, class_teacher_of, employee_id, department, qualification, joining_date, status) VALUES
    (t_math, u_t_math, 'Priya Sharma', 'Mathematics', '9876501001', 'priya.sharma@wisdomcampus.demo', true,  c10a, 'EMP-T-001', 'Mathematics', 'M.Sc Mathematics', '2018-06-01', 'active'),
    (t_phys, u_t_phys, 'Rajesh Verma', 'Physics',     '9876501002', 'rajesh.verma@wisdomcampus.demo', false, NULL, 'EMP-T-002', 'Science',     'M.Sc Physics',     '2019-07-15', 'active')
  ON CONFLICT (id) DO UPDATE SET user_id=EXCLUDED.user_id, full_name=EXCLUDED.full_name, email=EXCLUDED.email, is_class_teacher=EXCLUDED.is_class_teacher, class_teacher_of=EXCLUDED.class_teacher_of;

  INSERT INTO public.teacher_classes (teacher_id, class_id, subject) VALUES
    (t_math, c10a, 'Mathematics'),(t_math, c9a, 'Mathematics'),(t_phys, c10a, 'Physics')
  ON CONFLICT (teacher_id, class_id, subject) DO NOTHING;

  INSERT INTO public.students (id, user_id, full_name, admission_number, roll_number, class_id, parent_user_id, parent_name, parent_mobile, address, date_of_birth) VALUES
    (st1, u_s1, 'Arjun Mehta',  'WC10A001', '1', c10a, u_p1, 'Suresh Mehta',  '9876502001', '12, MG Road, Pune', '2010-03-15'),
    (st2, u_s2, 'Priya Patel',  'WC10A002', '2', c10a, u_p2, 'Kavita Patel',  '9876502002', '45, FC Road, Pune', '2010-07-22'),
    (st3, u_s3, 'Rohan Singh',  'WC10A003', '3', c10a, NULL, 'Harpreet Singh','9876502003', '8, Koregaon Park',  '2010-01-08'),
    (st4, u_s4, 'Ananya Iyer',  'WC10A004', '4', c10a, NULL, 'Lakshmi Iyer',  '9876502004', '22, Baner Road',    '2010-11-30'),
    (st5, u_s5, 'Vikram Joshi', 'WC10A005', '5', c10a, NULL, 'Amit Joshi',    '9876502005', '3, Aundh',          '2010-05-18')
  ON CONFLICT (id) DO UPDATE SET user_id=EXCLUDED.user_id, class_id=EXCLUDED.class_id, parent_user_id=EXCLUDED.parent_user_id, roll_number=EXCLUDED.roll_number;

  INSERT INTO public.attendance (student_id, class_id, date, status, marked_by) VALUES
    (st1, c10a, _today,     'present', u_t_math),(st2, c10a, _today,     'present', u_t_math),
    (st3, c10a, _today,     'absent',  u_t_math),(st4, c10a, _today,     'present', u_t_math),
    (st5, c10a, _today,     'leave',   u_t_math),
    (st1, c10a, _today - 1, 'present', u_t_math),(st2, c10a, _today - 1, 'present', u_t_math),
    (st3, c10a, _today - 1, 'present', u_t_math),(st4, c10a, _today - 1, 'absent',  u_t_math),
    (st5, c10a, _today - 1, 'present', u_t_math)
  ON CONFLICT (student_id, date) DO UPDATE SET status=EXCLUDED.status, marked_by=EXCLUDED.marked_by;

  INSERT INTO public.attendance_locks (class_id, date, locked_by) VALUES (c10a, _today - 2, u_t_math)
  ON CONFLICT (class_id, date) DO NOTHING;

  INSERT INTO public.attendance_audit (class_id, date, student_id, prev_status, new_status, edited_by) VALUES
    (c10a, _today - 2, st3, 'absent', 'present', u_principal);

  INSERT INTO public.fees (student_id, month, amount, paid_amount, due_date, status, notes) VALUES
    (st1, to_char(_today,'YYYY')||'-04', 4500, 4500, (_today-30)::date, 'paid',   'April tuition'),
    (st1, to_char(_today,'YYYY')||'-05', 4500, 2000, (_today+10)::date, 'partial','May — partial payment'),
    (st1, to_char(_today,'YYYY')||'-06', 4500, 0,    (_today+25)::date, 'unpaid', 'June due'),
    (st2, to_char(_today,'YYYY')||'-05', 4500, 4500, (_today-5)::date,  'paid',   NULL),
    (st2, to_char(_today,'YYYY')||'-06', 4500, 0,    (_today+20)::date, 'unpaid', NULL),
    (st3, to_char(_today,'YYYY')||'-06', 4500, 4500, (_today)::date,    'paid',   NULL)
  ON CONFLICT (student_id, month) DO UPDATE SET amount=EXCLUDED.amount, paid_amount=EXCLUDED.paid_amount, status=EXCLUDED.status, notes=EXCLUDED.notes;

  INSERT INTO public.exams (id, name, exam_type, class_id, subject, max_marks, exam_date, created_by) VALUES
    (exam1, 'Unit Test 1 — Real Numbers', 'unit_test',   c10a, 'Mathematics', 20, _today-14, u_t_math),
    (exam2, 'Half Yearly — Electricity',  'half_yearly', c10a, 'Physics',     50, _today-7,  u_t_phys)
  ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, exam_date=EXCLUDED.exam_date;

  INSERT INTO public.marks (exam_id, student_id, marks_obtained, remarks) VALUES
    (exam1, st1, 18, 'Excellent'),(exam1, st2, 16, 'Good'),(exam1, st3, 12, 'Needs practice'),
    (exam1, st4, 19, 'Top scorer'),(exam1, st5, 14, NULL),
    (exam2, st1, 42, NULL),(exam2, st2, 38, NULL),(exam2, st3, 45, 'Outstanding'),
    (exam2, st4, 40, NULL),(exam2, st5, 35, NULL)
  ON CONFLICT (exam_id, student_id) DO UPDATE SET marks_obtained=EXCLUDED.marks_obtained, remarks=EXCLUDED.remarks;

  INSERT INTO public.notices (id, title, body, audience, class_id, posted_by, expires_at) VALUES
    ('d9000001-0001-4000-8000-000000000001','PTM — Class 10-A','Parent-Teacher meeting on Saturday 10 AM in Room 12.','class', c10a, u_t_math, now()+interval '30 days'),
    ('d9000001-0002-4000-8000-000000000002','Holiday — Guru Purnima','School closed on Guru Purnima.','all', NULL, u_principal, now()+interval '60 days'),
    ('d9000001-0003-4000-8000-000000000003','Teachers: CBSE workshop','Mandatory NCERT-aligned workshop.','teachers', NULL, u_principal, now()+interval '14 days'),
    ('d9000001-0004-4000-8000-000000000004','Fee reminder','Please clear pending June fees.','parents', NULL, u_admin, now()+interval '21 days')
  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title, body=EXCLUDED.body;

  INSERT INTO public.homework (id, class_id, subject, title, description, due_date, created_by) VALUES
    (hw1, c10a, 'Mathematics', 'NCERT Ch 1 — Euclid''s Division Lemma', 'Solve Ex 1.1 Q 1–5 and upload working.', _today+3, u_t_math)
  ON CONFLICT (id) DO UPDATE SET title=EXCLUDED.title;

  INSERT INTO public.homework_submissions (id, homework_id, student_id, content, status, grade, teacher_remarks, submitted_at, graded_at) VALUES
    (hw_sub1, hw1, st1, 'Completed all five questions with steps.', 'graded', 'A', 'Neat presentation', now()-interval '1 day', now())
  ON CONFLICT (homework_id, student_id) DO UPDATE SET status=EXCLUDED.status, grade=EXCLUDED.grade;

  INSERT INTO public.homework_submissions (homework_id, student_id, content, status, submitted_at) VALUES
    (hw1, st2, 'Submitted — pending review', 'submitted', now()-interval '2 hours')
  ON CONFLICT (homework_id, student_id) DO NOTHING;

  -- Library (current schema: no shelf_location; checkouts use library_books_id, no issued_by)
  INSERT INTO public.library_books (id, title, author, isbn, category, total_copies, available_copies) VALUES
    (lib_book1, 'Mathematics — Class X (NCERT)', 'NCERT', '978-81-7450-634-4', 'Textbook', 5, 4),
    ('d7000001-0002-4000-8000-000000000002', 'Science — Class X (NCERT)', 'NCERT', '978-81-7450-636-8', 'Textbook', 5, 5),
    ('d7000001-0003-4000-8000-000000000003', 'Physics Refresher', 'H.C. Verma', '978-8177091878', 'Reference', 2, 2)
  ON CONFLICT (id) DO UPDATE SET available_copies=EXCLUDED.available_copies;

  INSERT INTO public.library_checkouts (id, library_books_id, student_id, due_date, status) VALUES
    (lib_co1, lib_book1, st1, _today+10, 'borrowed')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status;

  INSERT INTO public.messages (sender_id, receiver_id, content, is_read) VALUES
    (u_p1, u_t_math, 'Namaste Ma''am, Arjun was unwell yesterday.', true),
    (u_t_math, u_p1, 'Received. Hope Arjun feels better soon.', true),
    (u_p1, u_t_math, 'Thank you. When is the PTM?', false)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.leave_requests (id, applicant_user_id, applicant_kind, student_id, class_id, leave_type, from_date, to_date, reason, status, reviewed_by, reviewed_at) VALUES
    ('d9000002-0001-4000-8000-000000000001', u_s5, 'student', st5, c10a, 'medical', _today, _today+1, 'Viral fever', 'pending', NULL, NULL),
    ('d9000002-0002-4000-8000-000000000002', u_s3, 'student', st3, c10a, 'family',  _today-10, _today-9, 'Family function', 'approved', u_t_math, now()-interval '11 days'),
    ('d9000002-0003-4000-8000-000000000003', u_t_phys, 'teacher', NULL, NULL, 'personal', _today+5, _today+5, 'Personal work', 'rejected', u_principal, now()-interval '1 day')
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status;

  INSERT INTO public.staff_attendance (teacher_id, date, status, marked_by) VALUES
    (t_math, _today, 'present', u_principal),
    (t_phys, _today, 'present', u_principal),
    (t_math, _today-1, 'present', u_principal)
  ON CONFLICT (teacher_id, date) DO NOTHING;

  INSERT INTO public.school_inquiries (id, contact_name, contact_phone, contact_email, grade_interest, message, status, created_by) VALUES
    ('d9000003-0001-4000-8000-000000000001', 'Amit Deshmukh', '9988776655', 'amit@example.com', 'Class 9', 'Interested in CBSE admission for 2026-27.', 'open', u_admin)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.school_complaints (id, student_id, submitted_by, complainant_name, subject, body, category, status) VALUES
    ('d9000004-0001-4000-8000-000000000001', st3, u_p1, 'Suresh Mehta', 'Canteen hygiene', 'Request to improve lunch hygiene standards.', 'facilities', 'in_progress')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.student_xp (user_id, xp, level, current_streak, longest_streak, total_battles, wins, equipped_badge, last_battle_at) VALUES
    (u_s1, 320, 4, 3, 7, 8, 3, 'first_win',     now()-interval '1 day'),
    (u_s2, 180, 2, 1, 5, 4, 1, NULL,            now()-interval '3 days'),
    (u_s3, 450, 5, 5, 12,12, 6, 'sharp_shooter',now()-interval '2 hours')
  ON CONFLICT (user_id) DO UPDATE SET xp=EXCLUDED.xp, level=EXCLUDED.level, wins=EXCLUDED.wins;

  INSERT INTO public.student_badges (user_id, badge_code, tier) VALUES
    (u_s1, 'first_win', 'bronze'),(u_s1, 'first_dpp', 'bronze'),
    (u_s3, 'first_win', 'bronze'),(u_s3, 'sharp_shooter', 'silver'),(u_s3, 'dpp_perfect', 'gold')
  ON CONFLICT (user_id, badge_code) DO NOTHING;

  INSERT INTO public.battles (id, class_id, creator_user_id, title, subject, topic, chapter, difficulty, type, status, starts_at, duration_sec, per_question_sec, question_count, is_public, mode, source, class_level) VALUES
    (b_sched, c10a, u_t_math, 'Scheduled: Trigonometry Warm-up', 'Mathematics', 'Trigonometry', 'Introduction',          'easy',   'mcq', 'scheduled', now()+interval '2 days', 100, 20, 5, true, 'class', 'bank', 10),
    (b_live,  c10a, u_s3,     'Live: Physics Electricity',       'Physics',     'Electricity', 'Current Electricity',   'medium', 'mcq', 'live',      now(),                   100, 20, 5, true, 'class', 'bank', 10),
    (b_done,  c10a, u_s1,     'Finished: Real Numbers Quiz',     'Mathematics', 'Real Numbers','Real Numbers',          'medium', 'mcq', 'finished',  now()-interval '2 days', 100, 20, 2, true, 'class', 'bank', 10)
  ON CONFLICT (id) DO UPDATE SET status=EXCLUDED.status, title=EXCLUDED.title;

  SELECT id INTO _qb_id FROM public.question_bank WHERE is_approved AND subject='Mathematics' AND class_level=10 LIMIT 1;

  INSERT INTO public.battle_questions (id, battle_id, order_index, question, options, correct_index, points, bank_question_id) VALUES
    (bq_done1, b_done, 0, 'The HCF of 12 and 18 is:', '["6","12","3","9"]'::jsonb, 0, 10, _qb_id),
    (bq_done2, b_done, 1, 'The value of sin 30° is:', '["1/2","√3/2","1","0"]'::jsonb, 0, 10,
      (SELECT id FROM public.question_bank WHERE is_approved AND subject='Mathematics' AND class_level=10 OFFSET 1 LIMIT 1))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.battle_participants (id, battle_id, user_id, student_id, display_name, joined_at, finished_at, score, correct_count, answered_count, total_time_ms, rank) VALUES
    (bp_done1, b_done, u_s1, st1, 'Arjun Mehta', now()-interval '2 days', now()-interval '2 days' + interval '90 seconds',  20, 2, 2, 45000, 1),
    (bp_done2, b_done, u_s3, st3, 'Rohan Singh', now()-interval '2 days', now()-interval '2 days' + interval '120 seconds', 10, 1, 2, 90000, 2)
  ON CONFLICT (battle_id, user_id) DO UPDATE SET score=EXCLUDED.score, rank=EXCLUDED.rank, finished_at=EXCLUDED.finished_at;

  INSERT INTO public.battle_answers (participant_id, question_id, selected_index, is_correct, time_ms) VALUES
    (bp_done1, bq_done1, 0, true,  20000),
    (bp_done1, bq_done2, 0, true,  25000),
    (bp_done2, bq_done1, 0, true,  40000),
    (bp_done2, bq_done2, 1, false, 50000)
  ON CONFLICT (participant_id, question_id) DO NOTHING;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id, status) VALUES
    (b_live, u_s1, u_s3, 'pending')
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  INSERT INTO public.battle_events (kind, actor_user_id, actor_name, opponent_name, subject, detail, battle_id, class_id, icon) VALUES
    ('win',       u_s3, 'Rohan Singh', 'Arjun Mehta', 'Mathematics', 'won a close Real Numbers duel',  b_done, c10a, 'trophy'),
    ('challenge', u_s3, 'Rohan Singh', NULL,          'Physics',     'threw down an Electricity challenge', b_live, c10a, 'swords'),
    ('badge',     u_s1, 'Arjun Mehta', NULL,          NULL,          'earned First Win badge',         NULL,   c10a, 'award')
  ON CONFLICT DO NOTHING;

  INSERT INTO public.battle_reports (participant_id, battle_id, user_id, display_name, report, expires_at) VALUES
    (bp_done1, b_done, u_s1, 'Arjun Mehta',
     jsonb_build_object(
       'summary', jsonb_build_object('score',20,'correct',2,'answered',2,'rank',1,'won',true),
       'comparison', jsonb_build_object('class_avg_score',15,'class_avg_accuracy',75)
     ),
     now()+interval '20 hours')
  ON CONFLICT (participant_id) DO UPDATE SET report=EXCLUDED.report, expires_at=EXCLUDED.expires_at;

  INSERT INTO public.dpps (id, title, subject, chapter, topic, class_id, created_by, difficulty, instructions, due_at, duration_sec, total_marks, negative_marking, is_published, question_count) VALUES
    (dpp_pub,   'DPP — Quadratic Equations',         'Mathematics', 'Quadratic Equations', 'Nature of Roots', c10a, u_t_math, 'medium', 'No calculator. Show rough work in notebook.', now()+interval '5 days', 1200, 2, 0.25, true,  2),
    (dpp_draft, 'Draft DPP — Light (unpublished)',   'Physics',     'Light',               'Reflection',      c10a, u_t_phys, 'easy',   'For class test revision.',                    now()+interval '7 days',  900, 0, 0,    false, 0)
  ON CONFLICT (id) DO UPDATE SET is_published=EXCLUDED.is_published, title=EXCLUDED.title;

  INSERT INTO public.dpp_questions (id, dpp_id, order_index, kind, question, options, correct, marks, explanation) VALUES
    (dpp_q1, dpp_pub, 0, 'mcq', 'The discriminant of ax² + bx + c = 0 is:', '["b² − 4ac","2a","−b/2a","b² + 4ac"]'::jsonb, '{"indexes":[0]}'::jsonb, 1, 'D = b² − 4ac'),
    (dpp_q2, dpp_pub, 1, 'mcq', 'If roots are equal, discriminant equals:', '["0","1","b²","2ac"]'::jsonb,                  '{"indexes":[0]}'::jsonb, 1, 'Equal roots ⇒ D = 0')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.dpps SET question_count=2, total_marks=2 WHERE id = dpp_pub;

  INSERT INTO public.dpp_attempts (id, dpp_id, user_id, student_id, started_at, submitted_at, score, max_score, correct_count, total_count, time_spent_sec, status) VALUES
    (dpp_att, dpp_pub, u_s1, st1, now()-interval '1 day', now()-interval '23 hours', 2, 2, 2, 2, 420, 'submitted')
  ON CONFLICT (dpp_id, user_id) DO UPDATE SET status=EXCLUDED.status, score=EXCLUDED.score;

  INSERT INTO public.dpp_answers (attempt_id, question_id, response, is_correct, marks_awarded, time_ms) VALUES
    (dpp_att, dpp_q1, '{"indexes":[0]}'::jsonb, true, 1, 180000),
    (dpp_att, dpp_q2, '{"indexes":[0]}'::jsonb, true, 1, 200000)
  ON CONFLICT (attempt_id, question_id) DO NOTHING;

  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count, status)
  VALUES (dpp_pub, u_s2, st2, 2, 2, 'in_progress')
  ON CONFLICT (dpp_id, user_id) DO NOTHING;

  INSERT INTO public.notifications (user_id, type, title, body, icon, link, read) VALUES
    (u_s1,        'invite',   'Battle challenge!',     'Rohan Singh challenged you to a Physics battle.', 'swords',   '/student/battleground/battle/' || b_live::text, false),
    (u_s1,        'notice',   'PTM reminder',          'Class 10-A PTM this Saturday.',                   'bell',     '/student/notices',  false),
    (u_s2,        'homework', 'Homework graded',       'Your Mathematics submission was graded A.',       'book',     '/student/homework', true),
    (u_p1,        'fee',      'Fee reminder',          'June fees pending for Arjun.',                    'wallet',   '/parent/fees',      false),
    (u_t_math,    'leave',    'Leave pending',         'Vikram Joshi requested medical leave.',           'calendar', '/teacher/leaves',   false),
    (u_principal, 'inquiry',  'New admission inquiry', 'Amit Deshmukh — Class 9 interest.',               'inbox',    '/principal/cases',  false)
  ON CONFLICT DO NOTHING;

  INSERT INTO public.class_timetables (class_id, grid, updated_by) VALUES
    (c10a, jsonb_build_object(
      'monday',    jsonb_build_array('Mathematics','Physics','English','Hindi','Chemistry'),
      'tuesday',   jsonb_build_array('Physics','Mathematics','Social Science','English','Games'),
      'wednesday', jsonb_build_array('Chemistry','Mathematics','Physics','Computer','Library'),
      'thursday',  jsonb_build_array('English','Mathematics','Physics','Hindi','Art'),
      'friday',    jsonb_build_array('Mathematics','Chemistry','Physics','Social Science','Assembly'),
      'saturday',  jsonb_build_array('DPP / Revision','Sports','—','—','—')
    ), u_t_math)
  ON CONFLICT (class_id) DO UPDATE SET grid=EXCLUDED.grid, updated_by=EXCLUDED.updated_by;

  INSERT INTO public.app_settings (id, school_name, locale, currency, enable_notices, enable_fees, enable_leaves, updated_by) VALUES
    (true, 'Wisdom Campus Demo School', 'en-IN', 'INR', true, true, true, u_admin)
  ON CONFLICT (id) DO UPDATE SET school_name=EXCLUDED.school_name, enable_notices=EXCLUDED.enable_notices, enable_fees=EXCLUDED.enable_fees, enable_leaves=EXCLUDED.enable_leaves, updated_by=EXCLUDED.updated_by;

  INSERT INTO public.audit_logs (actor_user_id, action, entity, entity_id, metadata) VALUES
    (u_admin,     'demo_seed',    'migration',      NULL, '{"note":"Wisdom Campus demo dataset applied"}'::jsonb),
    (u_principal, 'leave_review', 'leave_requests', 'd9000002-0003-4000-8000-000000000003', '{"status":"rejected"}'::jsonb)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Wisdom Campus demo data applied.';
END $demo$;

DROP FUNCTION IF EXISTS public._demo_upsert_auth_user(uuid, text, text, text);

