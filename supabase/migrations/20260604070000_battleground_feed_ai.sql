-- =========================================================
-- Battleground v2 — Live Activity Feed + AI explanation cache
--   * battle_events: a competitive, social activity timeline
--   * rpc_battle_feed: class-scoped feed reader (SECURITY DEFINER)
--   * _battle_event: SECURITY DEFINER emitter used by battle RPCs
--   * ai_explanations: cache for AI "why was this wrong" answers
--   * finish/challenge RPCs now emit feed events
-- Idempotent where practical so it is safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Activity feed table
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.battle_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL,                       -- win | flawless | streak | challenge | rank | badge | join
  actor_user_id uuid NOT NULL,
  actor_name    text NOT NULL DEFAULT 'A student',
  opponent_name text,
  subject       text,
  detail        text NOT NULL,                        -- prerendered phrase: "defeated Rohan in Physics"
  icon          text,                                 -- lucide hint for the UI
  battle_id     uuid REFERENCES public.battles(id) ON DELETE SET NULL,
  class_id      uuid,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_battle_events_class   ON public.battle_events(class_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_battle_events_created ON public.battle_events(created_at DESC);

ALTER TABLE public.battle_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "be read" ON public.battle_events;
CREATE POLICY "be read" ON public.battle_events FOR SELECT TO authenticated USING (
  actor_user_id = auth.uid()
  OR (class_id IS NOT NULL AND public.student_class_id(auth.uid()) = class_id)
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
  OR (class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), class_id))
);
-- writes happen only via the SECURITY DEFINER helper below

-- ---------------------------------------------------------
-- 2) Feed emitter (called from inside battle RPCs)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._battle_event(
  _kind text, _uid uuid, _name text, _detail text,
  _subject text DEFAULT NULL, _opponent text DEFAULT NULL,
  _battle uuid DEFAULT NULL, _class uuid DEFAULT NULL, _icon text DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.battle_events
    (kind, actor_user_id, actor_name, opponent_name, subject, detail, battle_id, class_id, icon)
  VALUES
    (_kind, _uid, COALESCE(NULLIF(_name, ''), 'A student'), _opponent, _subject, _detail, _battle, _class, _icon);
$$;

-- ---------------------------------------------------------
-- 3) Feed reader — class-scoped, newest first
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_battle_feed(_limit int DEFAULT 30)
RETURNS SETOF public.battle_events LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT e.* FROM public.battle_events e
  WHERE e.actor_user_id = auth.uid()
     OR (e.class_id IS NOT NULL AND e.class_id = public.student_class_id(auth.uid()))
     OR public.has_role(auth.uid(), 'admin'::app_role)
     OR public.has_role(auth.uid(), 'principal'::app_role)
     OR (e.class_id IS NOT NULL AND public.teacher_teaches_class(auth.uid(), e.class_id))
  ORDER BY e.created_at DESC
  LIMIT GREATEST(1, LEAST(100, _limit));
$$;

-- ---------------------------------------------------------
-- 4) AI explanation cache
--    The edge function is pure compute; the client caches the
--    result here keyed by a stable hash of the question.
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.ai_explanations (
  cache_key  text PRIMARY KEY,
  subject    text,
  topic      text,
  payload    jsonb NOT NULL,                          -- { summary, why_wrong, concept, how_to_improve }
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_explanations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ai_expl read" ON public.ai_explanations;
CREATE POLICY "ai_expl read" ON public.ai_explanations
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "ai_expl insert" ON public.ai_explanations;
CREATE POLICY "ai_expl insert" ON public.ai_explanations
  FOR INSERT TO authenticated WITH CHECK (true);

-- ---------------------------------------------------------
-- 5) Finish battle — same engine as before + feed events
-- ---------------------------------------------------------
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

  -- recompute ranks for this battle
  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  SELECT MAX(score), count(*) INTO _max_score, _participants
    FROM public.battle_participants WHERE battle_id = _battle;
  _won := (_score = _max_score AND _score > 0);

  -- anti-repetition: remember which bank questions this user just saw
  INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at)
  SELECT _user, bq.bank_question_id, 1, now()
  FROM public.battle_answers ba
  JOIN public.battle_questions bq ON bq.id = ba.question_id
  WHERE ba.participant_id = _participant_id AND bq.bank_question_id IS NOT NULL
  ON CONFLICT (user_id, question_id) DO UPDATE
    SET times_seen = student_question_history.times_seen + 1, last_seen_at = now();

  -- upsert XP + aggregate stats + win streak
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
    updated_at      = now();

  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _user;
  _avg_ms := CASE WHEN _answered > 0 THEN _time::numeric / _answered ELSE NULL END;
  _hour   := EXTRACT(HOUR FROM now());

  -- ===== Badge awarding =====
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

  -- ===== Activity feed events =====
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
END $$;

-- ---------------------------------------------------------
-- 6) Challenge a classmate — same as before + feed event
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(auth.uid());
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.battles (title, subject, chapter, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (_name || ' challenges you · ' || _subject, _subject, _chapter, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now())
  RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
  VALUES (_bid, _opponent_user_id, auth.uid())
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  PERFORM public._battle_event('challenge', auth.uid(), _name,
    'threw down a ' || _subject || ' challenge',
    _subject, NULL, _bid, _cid, 'swords');

  RETURN _bid;
END $$;

-- ---------------------------------------------------------
-- 7) Realtime
-- ---------------------------------------------------------
DO $rt$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'battle_events'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_events;
  END IF;
END $rt$;
