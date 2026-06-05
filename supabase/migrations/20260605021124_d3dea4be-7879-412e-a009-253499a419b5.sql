CREATE TABLE IF NOT EXISTS public.battle_reports (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id  uuid NOT NULL UNIQUE REFERENCES public.battle_participants(id) ON DELETE CASCADE,
  battle_id       uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL,
  display_name    text NOT NULL DEFAULT '',
  report          jsonb NOT NULL,
  ai_insights     jsonb,
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, UPDATE ON public.battle_reports TO authenticated;
GRANT ALL ON public.battle_reports TO service_role;
CREATE INDEX IF NOT EXISTS idx_battle_reports_battle ON public.battle_reports(battle_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_reports_user   ON public.battle_reports(user_id, expires_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_reports_exp    ON public.battle_reports(expires_at);

ALTER TABLE public.battle_reports ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "br self read" ON public.battle_reports;
CREATE POLICY "br self read" ON public.battle_reports FOR SELECT TO authenticated
  USING (user_id = auth.uid());

DROP POLICY IF EXISTS "br teacher read" ON public.battle_reports;
CREATE POLICY "br teacher read" ON public.battle_reports FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.battles b
    WHERE b.id = battle_id
      AND (b.creator_user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.has_role(auth.uid(), 'principal'::app_role)
        OR (b.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), b.class_id)))
  ));

DROP POLICY IF EXISTS "br ai update self" ON public.battle_reports;
CREATE POLICY "br ai update self" ON public.battle_reports FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR EXISTS (
    SELECT 1 FROM public.battles b WHERE b.id = battle_id
      AND (b.creator_user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin'::app_role)
        OR public.teacher_teaches_class(auth.uid(), b.class_id))
  ))
  WITH CHECK (true);

CREATE OR REPLACE FUNCTION public._snapshot_battle_report(_participant_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p record; _report jsonb; _rid uuid;
  _total int; _won boolean; _max_score int;
  _class_avg_acc numeric; _class_avg_score numeric;
BEGIN
  SELECT p.*, b.title, b.subject, b.chapter, b.topic, b.difficulty, b.question_count, b.per_question_sec
    INTO _p
    FROM public.battle_participants p
    JOIN public.battles b ON b.id = p.battle_id
    WHERE p.id = _participant_id;
  IF _p IS NULL THEN RETURN NULL; END IF;

  SELECT count(*), max(score) INTO _total, _max_score
    FROM public.battle_participants WHERE battle_id = _p.battle_id AND finished_at IS NOT NULL;
  _won := (_p.score = _max_score AND _p.score > 0);

  SELECT
    round(avg(CASE WHEN answered_count > 0 THEN 100.0 * correct_count / answered_count END)),
    round(avg(score))
  INTO _class_avg_acc, _class_avg_score
  FROM public.battle_participants
  WHERE battle_id = _p.battle_id AND finished_at IS NOT NULL;

  _report := jsonb_build_object(
    'participant_id', _participant_id,
    'battle', jsonb_build_object(
      'id', _p.battle_id, 'title', _p.title, 'subject', _p.subject,
      'chapter', _p.chapter, 'topic', _p.topic, 'difficulty', _p.difficulty,
      'question_count', _p.question_count, 'per_question_sec', _p.per_question_sec
    ),
    'summary', jsonb_build_object(
      'score', _p.score, 'rank', _p.rank, 'total_participants', _total, 'won', _won,
      'correct_count', _p.correct_count, 'answered_count', _p.answered_count,
      'skipped_count', GREATEST(0, _p.question_count - _p.answered_count),
      'accuracy_pct', CASE WHEN _p.answered_count > 0
        THEN round(100.0 * _p.correct_count / _p.answered_count) ELSE 0 END,
      'avg_time_ms', CASE WHEN _p.answered_count > 0
        THEN round(_p.total_time_ms::numeric / _p.answered_count) ELSE 0 END,
      'total_time_sec', round(_p.total_time_ms::numeric / 1000)
    ),
    'topics', jsonb_build_object(
      'strong', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'label', sub.lbl, 'chapter', sub.chapter, 'topic', sub.topic,
          'correct', sub.correct, 'total', sub.total,
          'accuracy', round(100.0 * sub.correct / sub.total)
        ) ORDER BY sub.correct DESC)
        FROM (
          SELECT COALESCE(qb2.chapter, qb2.topic, 'General') AS lbl,
                 max(qb2.chapter) AS chapter, max(qb2.topic) AS topic,
                 count(*) FILTER (WHERE ba.is_correct) AS correct,
                 count(*) AS total
          FROM public.battle_answers ba
          JOIN public.battle_questions bq ON bq.id = ba.question_id
          LEFT JOIN public.question_bank qb2 ON qb2.id = bq.bank_question_id
          WHERE ba.participant_id = _participant_id
          GROUP BY COALESCE(qb2.chapter, qb2.topic, 'General')
          HAVING count(*) FILTER (WHERE ba.is_correct) = count(*) AND count(*) > 0
        ) sub
        LIMIT 5
      ), '[]'::jsonb),
      'weak', COALESCE((
        SELECT jsonb_agg(jsonb_build_object(
          'label', sub.lbl, 'chapter', sub.chapter, 'topic', sub.topic,
          'correct', sub.correct, 'total', sub.total,
          'accuracy', round(100.0 * sub.correct / NULLIF(sub.total, 0))
        ) ORDER BY sub.correct ASC)
        FROM (
          SELECT COALESCE(qb2.chapter, qb2.topic, 'General') AS lbl,
                 max(qb2.chapter) AS chapter, max(qb2.topic) AS topic,
                 count(*) FILTER (WHERE ba.is_correct) AS correct,
                 count(*) AS total
          FROM public.battle_answers ba
          JOIN public.battle_questions bq ON bq.id = ba.question_id
          LEFT JOIN public.question_bank qb2 ON qb2.id = bq.bank_question_id
          WHERE ba.participant_id = _participant_id
          GROUP BY COALESCE(qb2.chapter, qb2.topic, 'General')
          HAVING count(*) FILTER (WHERE ba.is_correct) < count(*)
        ) sub
        LIMIT 5
      ), '[]'::jsonb)
    ),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_index', bq.order_index, 'question_id', bq.id,
        'question', bq.question, 'options', bq.options,
        'correct_index', bq.correct_index, 'selected_index', ba.selected_index,
        'is_correct', COALESCE(ba.is_correct, false),
        'time_ms', COALESCE(ba.time_ms, 0),
        'skipped', (ba.id IS NULL),
        'chapter', qb.chapter, 'topic', qb.topic, 'explanation', qb.explanation
      ) ORDER BY bq.order_index)
      FROM public.battle_questions bq
      LEFT JOIN public.battle_answers ba
        ON ba.question_id = bq.id AND ba.participant_id = _participant_id
      LEFT JOIN public.question_bank qb ON qb.id = bq.bank_question_id
      WHERE bq.battle_id = _p.battle_id
    ), '[]'::jsonb),
    'speed', (
      SELECT jsonb_build_object(
        'fastest_ms', min(ba.time_ms),
        'slowest_ms', max(ba.time_ms),
        'under_pressure_accuracy', (
          SELECT round(100.0 * count(*) FILTER (WHERE ba2.is_correct) / NULLIF(count(*),0))
          FROM public.battle_answers ba2
          WHERE ba2.participant_id = _participant_id
            AND ba2.time_ms >= (_p.per_question_sec * 1000 * 0.75)
        ),
        'comfort_zone_accuracy', (
          SELECT round(100.0 * count(*) FILTER (WHERE ba3.is_correct) / NULLIF(count(*),0))
          FROM public.battle_answers ba3
          WHERE ba3.participant_id = _participant_id
            AND ba3.time_ms < (_p.per_question_sec * 1000 * 0.75)
        )
      )
      FROM public.battle_answers ba WHERE ba.participant_id = _participant_id
    ),
    'comparison', jsonb_build_object(
      'class_avg_accuracy', _class_avg_acc,
      'class_avg_score', _class_avg_score,
      'vs_avg_accuracy', CASE WHEN _p.answered_count > 0 AND _class_avg_acc IS NOT NULL
        THEN round(100.0 * _p.correct_count / _p.answered_count) - _class_avg_acc ELSE NULL END
    )
  );

  INSERT INTO public.battle_reports
    (participant_id, battle_id, user_id, display_name, report, expires_at)
  VALUES
    (_participant_id, _p.battle_id, _p.user_id, _p.display_name, _report, now() + interval '24 hours')
  ON CONFLICT (participant_id) DO UPDATE SET
    report = EXCLUDED.report,
    expires_at = EXCLUDED.expires_at,
    display_name = EXCLUDED.display_name
  RETURNING id INTO _rid;

  RETURN _rid;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_get_battle_report(_participant_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _r record; _allowed boolean;
BEGIN
  SELECT br.*, b.creator_user_id, b.class_id
    INTO _r
    FROM public.battle_reports br
    JOIN public.battles b ON b.id = br.battle_id
    WHERE br.participant_id = _participant_id;

  IF _r IS NULL THEN RETURN NULL; END IF;
  IF _r.expires_at < now() THEN
    RETURN jsonb_build_object('expired', true, 'expires_at', _r.expires_at);
  END IF;

  _allowed := _r.user_id = auth.uid()
    OR _r.creator_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR (_r.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), _r.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN jsonb_build_object(
    'id', _r.id, 'participant_id', _r.participant_id, 'battle_id', _r.battle_id,
    'user_id', _r.user_id, 'display_name', _r.display_name,
    'report', _r.report, 'ai_insights', _r.ai_insights,
    'expires_at', _r.expires_at, 'created_at', _r.created_at, 'expired', false
  );
END $$;

CREATE OR REPLACE FUNCTION public.rpc_teacher_battle_reports(_battle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE _b record; _allowed boolean;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;

  _allowed := _b.creator_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR (_b.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), _b.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized'; END IF;

  RETURN COALESCE((
    SELECT jsonb_agg(jsonb_build_object(
      'participant_id', br.participant_id,
      'user_id', br.user_id,
      'display_name', br.display_name,
      'expires_at', br.expires_at,
      'expired', (br.expires_at < now()),
      'summary', br.report->'summary',
      'has_ai', (br.ai_insights IS NOT NULL)
    ) ORDER BY (br.report->'summary'->>'rank')::int NULLS LAST, br.display_name)
    FROM public.battle_reports br
    WHERE br.battle_id = _battle_id
  ), '[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _battle uuid; _score int; _correct int; _answered int; _time int;
  _won boolean := false; _max_score int; _xp record; _avg_ms numeric; _hour int;
  _subject text; _class uuid; _name text; _opp text; _participants int;
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
    xp = student_xp.xp + EXCLUDED.xp,
    level = 1 + ((student_xp.xp + EXCLUDED.xp)/100),
    total_battles = student_xp.total_battles + 1,
    wins = student_xp.wins + CASE WHEN _won THEN 1 ELSE 0 END,
    last_battle_at = now(),
    best_score = GREATEST(student_xp.best_score, _score),
    total_correct = student_xp.total_correct + _correct,
    total_answered = student_xp.total_answered + _answered,
    win_streak = CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END,
    best_win_streak = GREATEST(student_xp.best_win_streak,
      CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END),
    updated_at = now();

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

  PERFORM public._snapshot_battle_report(_participant_id);
END $$;