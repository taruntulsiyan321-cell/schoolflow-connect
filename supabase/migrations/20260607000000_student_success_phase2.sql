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
