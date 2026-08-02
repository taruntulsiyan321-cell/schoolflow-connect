-- Academic Progression Engine — paste into Supabase SQL Editor, then reply DONE.
-- Companion of supabase/migrations/20260802310000_academic_progression_engine.sql
-- Idempotent. Config-driven XP / levels / leagues / badges / achievements / streaks / reputation.
-- Academic Progression Engine â€” XP, levels, leagues, badges, achievements,
-- study streak, reputation, leaderboards, history. Config-driven; idempotent awards.
-- Companion paste script: docs/APPLY_ACADEMIC_PROGRESSION_ENGINE.sql
-- User applies manually; reply DONE after paste into Supabase SQL editor.

-- ---------------------------------------------------------------------------
-- 1) Config: XP rules
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progression_xp_rules (
  code text PRIMARY KEY,
  label text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('award', 'deduct')),
  amount int NOT NULL CHECK (amount >= 0),
  reputation_delta int NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  category text NOT NULL DEFAULT 'general',
  description text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.progression_xp_rules IS
  'Configurable XP award/deduction amounts. Engine reads these â€” UI never invents XP.';

INSERT INTO public.progression_xp_rules (code, label, direction, amount, reputation_delta, category, description) VALUES
  ('practice.session.complete', 'Practice session complete', 'award', 25, 2, 'practice', 'Finish a practice session'),
  ('practice.correct_answer', 'Correct practice answer', 'award', 5, 0, 'practice', 'Per correct answer (batched at session finish)'),
  ('practice.goal_met', 'Practice goal met', 'award', 40, 3, 'practice', 'Hit daily/session practice goal'),
  ('practice.daily_consistency', 'Daily practice consistency', 'award', 15, 2, 'practice', 'Practiced on consecutive days'),
  ('practice.unfinished_repeat', 'Repeated unfinished practice', 'deduct', 10, -3, 'practice', 'Multiple abandoned sessions'),
  ('homework.submit', 'Homework submitted', 'award', 30, 3, 'homework', 'Submit homework'),
  ('homework.before_deadline', 'Homework before deadline', 'award', 15, 2, 'homework', 'Submit before due date'),
  ('homework.missed', 'Missing homework', 'deduct', 20, -5, 'homework', 'Past due without submission'),
  ('test.attempt', 'Test attempt', 'award', 35, 2, 'test', 'Complete a class test / DPP'),
  ('test.high_accuracy', 'High test accuracy', 'award', 40, 4, 'test', 'â‰¥90% accuracy on a test'),
  ('test.improvement', 'Test improvement', 'award', 25, 3, 'test', 'Score improved vs prior attempt'),
  ('battle.participate', 'Battleground participation', 'award', 20, 1, 'battle', 'Finish a battle'),
  ('battle.win', 'Battleground win', 'award', 50, 4, 'battle', 'Win a battle'),
  ('battle.top_finish', 'Battleground top finish', 'award', 30, 3, 'battle', 'Finish top 3'),
  ('battle.streak', 'Battleground win streak', 'award', 20, 2, 'battle', 'Continue a win streak'),
  ('attendance.present', 'Daily attendance present', 'award', 10, 2, 'attendance', 'Marked present'),
  ('daily.login', 'Daily login', 'award', 5, 1, 'engagement', 'First activity of the day'),
  ('study.goal', 'Study goal complete', 'award', 20, 2, 'engagement', 'Hit daily study goal'),
  ('revision.complete', 'Revision complete', 'award', 15, 2, 'revision', 'Complete a revision item'),
  ('recovery.complete', 'Recovery complete', 'award', 20, 2, 'recovery', 'Complete concept recovery'),
  ('ai.study_session', 'AI study session', 'award', 10, 1, 'ai', 'Complete an AI-assisted study session'),
  ('flashcards.complete', 'Flashcards complete', 'award', 10, 1, 'revision', 'Finish a flashcard set'),
  ('streak.break', 'Study streak broken', 'deduct', 15, -4, 'streak', 'Missed a study day after active streak'),
  ('inactivity.long', 'Long inactivity', 'deduct', 25, -6, 'engagement', 'No academic activity for 14+ days')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 2) Config: level curve (unlimited levels via formula; seed first 50)
-- Formula: xp_to_reach_level(n) = 100 * n * (n - 1) / 2  (triangular)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progression_level_config (
  id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_xp int NOT NULL DEFAULT 100,
  curve text NOT NULL DEFAULT 'triangular',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.progression_level_config (id, base_xp, curve)
VALUES (1, 100, 'triangular')
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 3) Config: academic leagues
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progression_leagues (
  code text PRIMARY KEY,
  label text NOT NULL,
  tier int NOT NULL UNIQUE,
  min_xp int NOT NULL,
  demote_below_xp int,
  color_token text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.progression_leagues (code, label, tier, min_xp, demote_below_xp, color_token) VALUES
  ('bronze', 'Bronze', 1, 0, NULL, 'tier-bronze'),
  ('silver', 'Silver', 2, 300, 200, 'tier-silver'),
  ('gold', 'Gold', 3, 800, 600, 'tier-gold'),
  ('platinum', 'Platinum', 4, 1800, 1400, 'primary'),
  ('diamond', 'Diamond', 5, 3500, 2800, 'accent'),
  ('master', 'Master', 6, 6000, 5000, 'warning'),
  ('champion', 'Champion', 7, 10000, 8500, 'warning'),
  ('legend', 'Legend', 8, 16000, 14000, 'destructive'),
  ('titan', 'Titan', 9, 25000, 22000, 'primary'),
  ('nova', 'Nova', 10, 40000, 36000, 'accent')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 4) Achievement catalog + awards (permanent; never revoke)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progression_achievements (
  code text PRIMARY KEY,
  label text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'milestone',
  threshold int,
  metric text,
  rarity text NOT NULL DEFAULT 'common',
  hidden boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.progression_achievements (code, label, description, category, threshold, metric, rarity) VALUES
  ('first_practice', 'First Practice', 'Complete your first practice session', 'practice', 1, 'practice_sessions', 'common'),
  ('questions_100', 'Century Solver', 'Answer 100 questions', 'practice', 100, 'total_answered', 'common'),
  ('questions_500', 'Knowledge Seeker', 'Answer 500 questions', 'practice', 500, 'total_answered', 'rare'),
  ('streak_30', 'Month of Focus', 'Maintain a 30-day study streak', 'streak', 30, 'study_streak', 'rare'),
  ('homework_100', 'Homework Century', 'Submit 100 homework assignments', 'homework', 100, 'homework_submitted', 'rare'),
  ('battles_50', 'Arena Veteran', 'Play 50 battleground matches', 'battle', 50, 'total_battles', 'rare'),
  ('ai_sessions_100', 'AI Explorer 100', 'Complete 100 AI study sessions', 'ai', 100, 'ai_sessions', 'rare'),
  ('perfect_week', 'Perfect Week', 'Practice every day for 7 days', 'streak', 7, 'study_week_streak', 'common'),
  ('perfect_month', 'Perfect Month', 'Practice every day for 30 days', 'streak', 30, 'study_month_streak', 'epic')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.student_achievements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  achievement_code text NOT NULL REFERENCES public.progression_achievements(code),
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, achievement_code)
);

CREATE INDEX IF NOT EXISTS student_achievements_user_earned
  ON public.student_achievements (user_id, earned_at DESC);

-- ---------------------------------------------------------------------------
-- 5) Badge catalog (metadata; awards still via student_badges / _award_badge)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progression_badge_catalog (
  code text PRIMARY KEY,
  label text NOT NULL,
  description text,
  category text NOT NULL DEFAULT 'general',
  rarity text NOT NULL DEFAULT 'common',
  hidden boolean NOT NULL DEFAULT false,
  tier_default text DEFAULT 'bronze',
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.progression_badge_catalog (code, label, description, category, rarity, tier_default) VALUES
  ('homework_hero', 'Homework Hero', 'Consistently submit homework on time', 'homework', 'common', 'silver'),
  ('practice_champion', 'Practice Champion', 'Complete many practice sessions', 'practice', 'common', 'gold'),
  ('attendance_star', 'Attendance Star', 'Excellent attendance record', 'attendance', 'common', 'silver'),
  ('battleground_winner', 'Battleground Winner', 'Win battleground matches', 'battle', 'common', 'gold'),
  ('ai_explorer', 'AI Explorer', 'Use AI study tools regularly', 'ai', 'common', 'bronze'),
  ('consistency_champion', 'Consistency Champion', 'Maintain long study streaks', 'streak', 'rare', 'gold'),
  ('perfect_week', 'Perfect Week', 'Practice every day for a week', 'streak', 'common', 'silver'),
  ('perfect_month', 'Perfect Month', 'Practice every day for a month', 'streak', 'epic', 'platinum'),
  ('subject_expert', 'Subject Expert', 'High mastery in a subject', 'subject', 'rare', 'gold')
ON CONFLICT (code) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 6) Extend student_xp with progression fields
-- ---------------------------------------------------------------------------
ALTER TABLE public.student_xp
  ADD COLUMN IF NOT EXISTS league_code text REFERENCES public.progression_leagues(code),
  ADD COLUMN IF NOT EXISTS highest_league_code text REFERENCES public.progression_leagues(code),
  ADD COLUMN IF NOT EXISTS reputation int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS study_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS study_longest_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS study_week_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS study_month_streak int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_study_date date,
  ADD COLUMN IF NOT EXISTS last_activity_at timestamptz,
  ADD COLUMN IF NOT EXISTS demotion_warning_at timestamptz,
  ADD COLUMN IF NOT EXISTS streak_protection_tokens int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS featured_badges text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS homework_submitted_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS practice_sessions_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS ai_sessions_count int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS school_id uuid;

UPDATE public.student_xp
SET league_code = COALESCE(league_code, 'bronze'),
    highest_league_code = COALESCE(highest_league_code, league_code, 'bronze')
WHERE league_code IS NULL OR highest_league_code IS NULL;

CREATE INDEX IF NOT EXISTS student_xp_league_xp ON public.student_xp (league_code, xp DESC);
CREATE INDEX IF NOT EXISTS student_xp_school_xp ON public.student_xp (school_id, xp DESC)
  WHERE school_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS student_xp_study_streak ON public.student_xp (study_streak DESC);

-- ---------------------------------------------------------------------------
-- 7) History + league history (audit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.progression_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id uuid,
  rule_code text,
  direction text NOT NULL CHECK (direction IN ('award', 'deduct')),
  xp_delta int NOT NULL,
  reputation_delta int NOT NULL DEFAULT 0,
  xp_before int NOT NULL,
  xp_after int NOT NULL,
  level_before int NOT NULL,
  level_after int NOT NULL,
  league_before text,
  league_after text,
  source_type text,
  source_id text,
  idempotency_key text,
  reason text,
  meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS progression_history_idempotency
  ON public.progression_history (user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS progression_history_user_created
  ON public.progression_history (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.progression_league_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  school_id uuid,
  from_league text,
  to_league text NOT NULL,
  change_type text NOT NULL CHECK (change_type IN ('promotion', 'demotion', 'init', 'warning')),
  xp_at_change int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS progression_league_history_user
  ON public.progression_league_history (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- 8) RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.progression_xp_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_level_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_leagues ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_badge_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_achievements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_history ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.progression_league_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'progression_xp_rules' AND policyname = 'progression_xp_rules_read'
  ) THEN
    CREATE POLICY progression_xp_rules_read ON public.progression_xp_rules
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'progression_level_config' AND policyname = 'progression_level_config_read'
  ) THEN
    CREATE POLICY progression_level_config_read ON public.progression_level_config
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'progression_leagues' AND policyname = 'progression_leagues_read'
  ) THEN
    CREATE POLICY progression_leagues_read ON public.progression_leagues
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'progression_achievements' AND policyname = 'progression_achievements_read'
  ) THEN
    CREATE POLICY progression_achievements_read ON public.progression_achievements
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'progression_badge_catalog' AND policyname = 'progression_badge_catalog_read'
  ) THEN
    CREATE POLICY progression_badge_catalog_read ON public.progression_badge_catalog
      FOR SELECT TO authenticated USING (true);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'student_achievements' AND policyname = 'student_achievements_self_read'
  ) THEN
    CREATE POLICY student_achievements_self_read ON public.student_achievements
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'principal')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'progression_history' AND policyname = 'progression_history_self_read'
  ) THEN
    CREATE POLICY progression_history_self_read ON public.progression_history
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'principal')
      );
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'progression_league_history' AND policyname = 'progression_league_history_self_read'
  ) THEN
    CREATE POLICY progression_league_history_self_read ON public.progression_league_history
      FOR SELECT TO authenticated
      USING (
        user_id = auth.uid()
        OR public.has_role(auth.uid(), 'admin')
        OR public.has_role(auth.uid(), 'principal')
      );
  END IF;
END $$;

-- Parent/teacher read of child/class XP via SECURITY DEFINER RPCs (not table policies).

-- ---------------------------------------------------------------------------
-- 9) Helpers: level + league
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.progression_xp_for_level(_level int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT GREATEST(0, (100 * GREATEST(_level, 1) * (GREATEST(_level, 1) - 1)) / 2);
$$;

CREATE OR REPLACE FUNCTION public.progression_level_for_xp(_xp int)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  -- Inverse of triangular: level = floor((1 + sqrt(1 + 8*xp/100)) / 2)
  SELECT GREATEST(1, floor((1 + sqrt(1 + (8.0 * GREATEST(_xp, 0)) / 100.0)) / 2.0)::int);
$$;

CREATE OR REPLACE FUNCTION public.progression_league_for_xp(_xp int)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _code text;
BEGIN
  SELECT code INTO _code
  FROM public.progression_leagues
  WHERE min_xp <= GREATEST(_xp, 0)
  ORDER BY tier DESC
  LIMIT 1;
  RETURN COALESCE(_code, 'bronze');
END;
$$;

CREATE OR REPLACE FUNCTION public._ensure_student_xp(_uid uuid)
RETURNS public.student_xp
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _row public.student_xp%ROWTYPE;
  _school uuid;
BEGIN
  SELECT * INTO _row FROM public.student_xp WHERE user_id = _uid;
  IF FOUND THEN
    RETURN _row;
  END IF;

  SELECT s.school_id INTO _school
  FROM public.students s
  WHERE s.user_id = _uid
  LIMIT 1;

  INSERT INTO public.student_xp (
    user_id, xp, level, league_code, highest_league_code, school_id, reputation
  ) VALUES (
    _uid, 0, 1, 'bronze', 'bronze', _school, 0
  )
  ON CONFLICT (user_id) DO NOTHING
  RETURNING * INTO _row;

  IF _row.user_id IS NULL THEN
    SELECT * INTO _row FROM public.student_xp WHERE user_id = _uid;
  END IF;
  RETURN _row;
END;
$$;

CREATE OR REPLACE FUNCTION public._award_achievement(_uid uuid, _code text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _inserted uuid;
  _school uuid;
  _student uuid;
BEGIN
  INSERT INTO public.student_achievements (user_id, achievement_code)
  VALUES (_uid, _code)
  ON CONFLICT (user_id, achievement_code) DO NOTHING
  RETURNING id INTO _inserted;

  IF _inserted IS NULL THEN
    RETURN;
  END IF;

  SELECT s.id, s.school_id INTO _student, _school
  FROM public.students s
  WHERE s.user_id = _uid
  LIMIT 1;

  _school := coalesce(_school, public.get_my_school_id(), public.default_school_id());

  IF _school IS NOT NULL THEN
    PERFORM public.emit_academic_event(
      'achievement.earned',
      'student_achievement',
      _inserted,
      _school,
      _student,
      NULL,
      NULL,
      jsonb_build_object('achievement_code', _code, 'user_id', _uid)
    );
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._progression_check_milestones(_uid uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _x public.student_xp%ROWTYPE;
BEGIN
  SELECT * INTO _x FROM public.student_xp WHERE user_id = _uid;
  IF NOT FOUND THEN RETURN; END IF;

  IF COALESCE(_x.practice_sessions_count, 0) >= 1 THEN
    PERFORM public._award_achievement(_uid, 'first_practice');
  END IF;
  IF COALESCE(_x.total_answered, 0) >= 100 THEN
    PERFORM public._award_achievement(_uid, 'questions_100');
  END IF;
  IF COALESCE(_x.total_answered, 0) >= 500 THEN
    PERFORM public._award_achievement(_uid, 'questions_500');
  END IF;
  IF COALESCE(_x.study_streak, 0) >= 30 OR COALESCE(_x.study_longest_streak, 0) >= 30 THEN
    PERFORM public._award_achievement(_uid, 'streak_30');
  END IF;
  IF COALESCE(_x.homework_submitted_count, 0) >= 100 THEN
    PERFORM public._award_achievement(_uid, 'homework_100');
  END IF;
  IF COALESCE(_x.total_battles, 0) >= 50 THEN
    PERFORM public._award_achievement(_uid, 'battles_50');
  END IF;
  IF COALESCE(_x.ai_sessions_count, 0) >= 100 THEN
    PERFORM public._award_achievement(_uid, 'ai_sessions_100');
  END IF;
  IF COALESCE(_x.study_week_streak, 0) >= 7 OR COALESCE(_x.study_streak, 0) >= 7 THEN
    PERFORM public._award_achievement(_uid, 'perfect_week');
    PERFORM public._award_badge(_uid, 'perfect_week', 'silver');
  END IF;
  IF COALESCE(_x.study_month_streak, 0) >= 30 OR COALESCE(_x.study_streak, 0) >= 30 THEN
    PERFORM public._award_achievement(_uid, 'perfect_month');
    PERFORM public._award_badge(_uid, 'perfect_month', 'platinum');
  END IF;

  -- Consistency / practice / attendance badges (threshold-based)
  IF COALESCE(_x.practice_sessions_count, 0) >= 25 THEN
    PERFORM public._award_badge(_uid, 'practice_champion', 'gold');
  END IF;
  IF COALESCE(_x.homework_submitted_count, 0) >= 20 THEN
    PERFORM public._award_badge(_uid, 'homework_hero', 'silver');
  END IF;
  IF COALESCE(_x.study_longest_streak, 0) >= 14 THEN
    PERFORM public._award_badge(_uid, 'consistency_champion', 'gold');
  END IF;
  IF COALESCE(_x.ai_sessions_count, 0) >= 10 THEN
    PERFORM public._award_badge(_uid, 'ai_explorer', 'bronze');
  END IF;
  IF COALESCE(_x.wins, 0) >= 1 THEN
    PERFORM public._award_badge(_uid, 'battleground_winner', 'gold');
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public._progression_bump_study_streak(_uid uuid, _on date DEFAULT CURRENT_DATE)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _x public.student_xp%ROWTYPE;
  _last date;
BEGIN
  _x := public._ensure_student_xp(_uid);
  _last := _x.last_study_date;

  IF _last = _on THEN
    RETURN;
  ELSIF _last = _on - 1 THEN
    UPDATE public.student_xp SET
      study_streak = COALESCE(study_streak, 0) + 1,
      study_longest_streak = GREATEST(COALESCE(study_longest_streak, 0), COALESCE(study_streak, 0) + 1),
      study_week_streak = LEAST(7, COALESCE(study_week_streak, 0) + 1),
      study_month_streak = LEAST(31, COALESCE(study_month_streak, 0) + 1),
      last_study_date = _on,
      last_activity_at = now(),
      updated_at = now()
    WHERE user_id = _uid;
  ELSE
    -- Broken streak (if had one) is handled by callers via streak.break rule when desired.
    UPDATE public.student_xp SET
      study_streak = 1,
      study_week_streak = 1,
      study_month_streak = 1,
      study_longest_streak = GREATEST(COALESCE(study_longest_streak, 0), 1),
      last_study_date = _on,
      last_activity_at = now(),
      updated_at = now()
    WHERE user_id = _uid;
  END IF;
END;
$$;

-- ---------------------------------------------------------------------------
-- 10) Core: apply progression (idempotent)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_apply_progression(
  _rule_code text,
  _source_type text DEFAULT NULL,
  _source_id text DEFAULT NULL,
  _idempotency_key text DEFAULT NULL,
  _amount_override int DEFAULT NULL,
  _meta jsonb DEFAULT '{}'::jsonb,
  _target_user_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := COALESCE(_target_user_id, auth.uid());
  _rule public.progression_xp_rules%ROWTYPE;
  _x public.student_xp%ROWTYPE;
  _delta int;
  _rep int;
  _xp_before int;
  _xp_after int;
  _lvl_before int;
  _lvl_after int;
  _league_before text;
  _league_after text;
  _school uuid;
  _student uuid;
  _hist uuid;
  _dir text;
  _highest text;
  _warn boolean := false;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Idempotency short-circuit
  IF _idempotency_key IS NOT NULL THEN
    SELECT id INTO _hist
    FROM public.progression_history
    WHERE user_id = _uid AND idempotency_key = _idempotency_key
    LIMIT 1;
    IF _hist IS NOT NULL THEN
      SELECT * INTO _x FROM public.student_xp WHERE user_id = _uid;
      RETURN jsonb_build_object(
        'applied', false,
        'duplicate', true,
        'xp', COALESCE(_x.xp, 0),
        'level', COALESCE(_x.level, 1),
        'league', COALESCE(_x.league_code, 'bronze'),
        'reputation', COALESCE(_x.reputation, 0)
      );
    END IF;
  END IF;

  SELECT * INTO _rule FROM public.progression_xp_rules WHERE code = _rule_code AND enabled;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Unknown or disabled progression rule: %', _rule_code;
  END IF;

  -- Safety: never award for wrong answers / Nova questions (no such rules seeded).
  -- Controlled deductions only via direction = deduct rules.

  _dir := _rule.direction;
  _delta := COALESCE(_amount_override, _rule.amount);
  IF _dir = 'deduct' THEN
    _delta := -ABS(_delta);
  ELSE
    _delta := ABS(_delta);
  END IF;
  _rep := COALESCE(_rule.reputation_delta, 0);

  _x := public._ensure_student_xp(_uid);
  _xp_before := COALESCE(_x.xp, 0);
  _lvl_before := COALESCE(_x.level, 1);
  _league_before := COALESCE(_x.league_code, 'bronze');
  _xp_after := GREATEST(0, _xp_before + _delta);
  _lvl_after := public.progression_level_for_xp(_xp_after);
  _league_after := public.progression_league_for_xp(_xp_after);

  SELECT s.id, s.school_id INTO _student, _school
  FROM public.students s
  WHERE s.user_id = _uid
  LIMIT 1;
  _school := coalesce(_school, _x.school_id, public.get_my_school_id(), public.default_school_id());

  _highest := COALESCE(_x.highest_league_code, _league_before, 'bronze');
  IF (
    SELECT tier FROM public.progression_leagues WHERE code = _league_after
  ) > (
    SELECT tier FROM public.progression_leagues WHERE code = _highest
  ) THEN
    _highest := _league_after;
  END IF;

  UPDATE public.student_xp SET
    xp = _xp_after,
    level = _lvl_after,
    league_code = _league_after,
    highest_league_code = _highest,
    reputation = GREATEST(0, COALESCE(reputation, 0) + _rep),
    school_id = COALESCE(school_id, _school),
    last_activity_at = now(),
    demotion_warning_at = CASE
      WHEN EXISTS (
        SELECT 1 FROM public.progression_leagues l
        WHERE l.code = _league_after
          AND l.demote_below_xp IS NOT NULL
          AND _xp_after <= l.demote_below_xp + GREATEST(50, (l.min_xp - COALESCE(l.demote_below_xp, 0)) / 5)
          AND _xp_after >= COALESCE(l.demote_below_xp, 0)
      ) THEN now()
      ELSE NULL
    END,
    updated_at = now()
  WHERE user_id = _uid;

  INSERT INTO public.progression_history (
    user_id, school_id, rule_code, direction, xp_delta, reputation_delta,
    xp_before, xp_after, level_before, level_after, league_before, league_after,
    source_type, source_id, idempotency_key, reason, meta
  ) VALUES (
    _uid, _school, _rule_code, _dir, _delta, _rep,
    _xp_before, _xp_after, _lvl_before, _lvl_after, _league_before, _league_after,
    _source_type, _source_id, _idempotency_key, _rule.label, COALESCE(_meta, '{}'::jsonb)
  )
  RETURNING id INTO _hist;

  IF _league_after IS DISTINCT FROM _league_before THEN
    INSERT INTO public.progression_league_history (
      user_id, school_id, from_league, to_league, change_type, xp_at_change
    ) VALUES (
      _uid, _school, _league_before, _league_after,
      CASE
        WHEN (SELECT tier FROM public.progression_leagues WHERE code = _league_after)
           > (SELECT tier FROM public.progression_leagues WHERE code = _league_before)
        THEN 'promotion' ELSE 'demotion'
      END,
      _xp_after
    );

    IF _school IS NOT NULL THEN
      PERFORM public.emit_academic_event(
        CASE
          WHEN (SELECT tier FROM public.progression_leagues WHERE code = _league_after)
             > (SELECT tier FROM public.progression_leagues WHERE code = _league_before)
          THEN 'league.promoted' ELSE 'league.demoted'
        END,
        'student_xp',
        NULL,
        _school,
        _student,
        NULL,
        NULL,
        jsonb_build_object(
          'from', _league_before, 'to', _league_after,
          'xp', _xp_after, 'user_id', _uid
        )
      );
    END IF;
  END IF;

  PERFORM public._progression_check_milestones(_uid);

  IF _school IS NOT NULL THEN
    PERFORM public.emit_academic_event(
      'xp.updated',
      'student_xp',
      NULL,
      _school,
      _student,
      NULL,
      NULL,
      jsonb_build_object(
        'user_id', _uid,
        'rule_code', _rule_code,
        'xp_delta', _delta,
        'xp_after', _xp_after,
        'level_after', _lvl_after,
        'league_after', _league_after,
        'history_id', _hist
      )
    );
  END IF;

  SELECT * INTO _x FROM public.student_xp WHERE user_id = _uid;

  RETURN jsonb_build_object(
    'applied', true,
    'duplicate', false,
    'history_id', _hist,
    'xp_delta', _delta,
    'xp', _x.xp,
    'level', _x.level,
    'league', _x.league_code,
    'reputation', _x.reputation,
    'xp_to_next_level', public.progression_xp_for_level(_x.level + 1) - _x.xp,
    'progress_pct', CASE
      WHEN public.progression_xp_for_level(_x.level + 1) = public.progression_xp_for_level(_x.level) THEN 100
      ELSE ROUND(
        100.0 * (_x.xp - public.progression_xp_for_level(_x.level))
        / NULLIF(public.progression_xp_for_level(_x.level + 1) - public.progression_xp_for_level(_x.level), 0)
      )::int
    END
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_apply_progression(text, text, text, text, int, jsonb, uuid) TO authenticated;

-- ---------------------------------------------------------------------------
-- 11) Snapshot + parent/teacher reads
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_get_student_progression(_user_id uuid DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := COALESCE(_user_id, auth.uid());
  _x public.student_xp%ROWTYPE;
  _caller uuid := auth.uid();
  _ok boolean := false;
  _student uuid;
  _school uuid;
  _badges jsonb;
  _achievements jsonb;
  _league jsonb;
  _next_league jsonb;
  _xp_next int;
  _xp_cur int;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  IF _uid = _caller
     OR public.has_role(_caller, 'admin')
     OR public.has_role(_caller, 'principal') THEN
    _ok := true;
  END IF;

  -- Parent of student
  IF NOT _ok THEN
    SELECT s.id, s.school_id INTO _student, _school
    FROM public.students s
    WHERE s.user_id = _uid
    LIMIT 1;
    IF _student IS NOT NULL AND (
      EXISTS (SELECT 1 FROM public.students s2 WHERE s2.id = _student AND s2.parent_user_id = _caller)
      OR EXISTS (
        SELECT 1
        FROM public.parents p
        JOIN public.parent_students ps ON ps.parent_id = p.id
        WHERE p.user_id = _caller AND ps.student_id = _student
      )
    ) THEN
      _ok := true;
    END IF;
  END IF;

  -- Teacher of student's class
  IF NOT _ok THEN
    IF public.has_role(_caller, 'teacher') AND EXISTS (
      SELECT 1 FROM public.teacher_classes tc
      JOIN public.teachers t ON t.id = tc.teacher_id
      JOIN public.students s ON s.class_id = tc.class_id
      WHERE t.user_id = _caller AND s.user_id = _uid
    ) THEN
      _ok := true;
    END IF;
  END IF;

  IF NOT _ok THEN
    RAISE EXCEPTION 'Not authorized to view progression';
  END IF;

  _x := public._ensure_student_xp(_uid);
  _xp_cur := public.progression_xp_for_level(COALESCE(_x.level, 1));
  _xp_next := public.progression_xp_for_level(COALESCE(_x.level, 1) + 1);

  SELECT jsonb_build_object(
    'code', l.code, 'label', l.label, 'tier', l.tier, 'min_xp', l.min_xp,
    'demote_below_xp', l.demote_below_xp, 'color_token', l.color_token
  ) INTO _league
  FROM public.progression_leagues l
  WHERE l.code = COALESCE(_x.league_code, 'bronze');

  SELECT jsonb_build_object(
    'code', l.code, 'label', l.label, 'tier', l.tier, 'min_xp', l.min_xp, 'remaining', GREATEST(0, l.min_xp - _x.xp)
  ) INTO _next_league
  FROM public.progression_leagues l
  WHERE l.tier = (SELECT tier + 1 FROM public.progression_leagues WHERE code = COALESCE(_x.league_code, 'bronze'))
  LIMIT 1;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'badge_code', b.badge_code, 'tier', b.tier, 'earned_at', b.earned_at
  ) ORDER BY b.earned_at DESC), '[]'::jsonb)
  INTO _badges
  FROM public.student_badges b
  WHERE b.user_id = _uid;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'code', a.achievement_code, 'earned_at', a.earned_at,
    'label', c.label, 'description', c.description, 'rarity', c.rarity
  ) ORDER BY a.earned_at DESC), '[]'::jsonb)
  INTO _achievements
  FROM public.student_achievements a
  JOIN public.progression_achievements c ON c.code = a.achievement_code
  WHERE a.user_id = _uid;

  RETURN jsonb_build_object(
    'user_id', _uid,
    'xp', COALESCE(_x.xp, 0),
    'level', COALESCE(_x.level, 1),
    'xp_into_level', GREATEST(0, COALESCE(_x.xp, 0) - _xp_cur),
    'xp_to_next_level', GREATEST(0, _xp_next - COALESCE(_x.xp, 0)),
    'level_progress_pct', CASE
      WHEN _xp_next <= _xp_cur THEN 100
      ELSE LEAST(100, ROUND(100.0 * (COALESCE(_x.xp, 0) - _xp_cur) / NULLIF(_xp_next - _xp_cur, 0))::int)
    END,
    'league', _league,
    'next_league', _next_league,
    'highest_league', COALESCE(_x.highest_league_code, 'bronze'),
    'demotion_warning_at', _x.demotion_warning_at,
    'reputation', COALESCE(_x.reputation, 0),
    'study_streak', COALESCE(_x.study_streak, 0),
    'study_longest_streak', COALESCE(_x.study_longest_streak, 0),
    'study_week_streak', COALESCE(_x.study_week_streak, 0),
    'study_month_streak', COALESCE(_x.study_month_streak, 0),
    'streak_protection_tokens', COALESCE(_x.streak_protection_tokens, 0),
    'featured_badges', COALESCE(to_jsonb(_x.featured_badges), '[]'::jsonb),
    'equipped_badge', _x.equipped_badge,
    'badges', _badges,
    'achievements', _achievements,
    'battleground', jsonb_build_object(
      'total_battles', COALESCE(_x.total_battles, 0),
      'wins', COALESCE(_x.wins, 0),
      'win_streak', COALESCE(_x.win_streak, 0),
      'best_win_streak', COALESCE(_x.best_win_streak, 0),
      'best_score', COALESCE(_x.best_score, 0),
      'total_correct', COALESCE(_x.total_correct, 0),
      'total_answered', COALESCE(_x.total_answered, 0)
    ),
    'counts', jsonb_build_object(
      'practice_sessions', COALESCE(_x.practice_sessions_count, 0),
      'homework_submitted', COALESCE(_x.homework_submitted_count, 0),
      'ai_sessions', COALESCE(_x.ai_sessions_count, 0)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_get_student_progression(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_set_featured_badges(_badges text[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _code text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF _badges IS NULL OR array_length(_badges, 1) IS NULL THEN
    UPDATE public.student_xp SET featured_badges = '{}', updated_at = now() WHERE user_id = _uid;
    RETURN;
  END IF;
  IF array_length(_badges, 1) > 5 THEN
    RAISE EXCEPTION 'At most 5 featured badges';
  END IF;
  FOREACH _code IN ARRAY _badges LOOP
    IF NOT EXISTS (
      SELECT 1 FROM public.student_badges WHERE user_id = _uid AND badge_code = _code
    ) THEN
      RAISE EXCEPTION 'Badge not earned: %', _code;
    END IF;
  END LOOP;
  PERFORM public._ensure_student_xp(_uid);
  UPDATE public.student_xp SET featured_badges = _badges, updated_at = now() WHERE user_id = _uid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_set_featured_badges(text[]) TO authenticated;

-- Teacher class progression insights (no gamification admin â€” insight lists only)
CREATE OR REPLACE FUNCTION public.rpc_teacher_class_progression_insights(_class_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _caller uuid := auth.uid();
  _ok boolean := false;
BEGIN
  IF _caller IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  IF public.has_role(_caller, 'admin') OR public.has_role(_caller, 'principal') THEN
    _ok := true;
  ELSIF public.has_role(_caller, 'teacher') THEN
    _ok := EXISTS (
      SELECT 1 FROM public.teacher_classes tc
      JOIN public.teachers t ON t.id = tc.teacher_id
      WHERE t.user_id = _caller AND tc.class_id = _class_id
    );
  END IF;
  IF NOT _ok THEN RAISE EXCEPTION 'Not authorized for class insights'; END IF;

  RETURN jsonb_build_object(
    'top_xp', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name, COALESCE(x.xp, 0) AS xp,
               COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
        FROM public.students s
        LEFT JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
        ORDER BY COALESCE(x.xp, 0) DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'improvers', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name,
               COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) AS xp_gained_7d
        FROM public.students s
        LEFT JOIN public.progression_history h
          ON h.user_id = s.user_id AND h.created_at >= now() - interval '7 days'
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
        GROUP BY s.id, s.full_name
        HAVING COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) > 0
        ORDER BY xp_gained_7d DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'inactive', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name, x.last_activity_at
        FROM public.students s
        LEFT JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
          AND (x.last_activity_at IS NULL OR x.last_activity_at < now() - interval '7 days')
        ORDER BY x.last_activity_at NULLS FIRST
        LIMIT 15
      ) t
    ), '[]'::jsonb),
    'consistent_practicers', COALESCE((
      SELECT jsonb_agg(row_to_json(t))
      FROM (
        SELECT s.id AS student_id, s.full_name,
               COALESCE(x.study_streak, 0) AS study_streak,
               COALESCE(x.practice_sessions_count, 0) AS practice_sessions
        FROM public.students s
        JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _class_id
          AND (COALESCE(x.study_streak, 0) >= 3 OR COALESCE(x.practice_sessions_count, 0) >= 5)
        ORDER BY x.study_streak DESC, x.practice_sessions_count DESC
        LIMIT 10
      ) t
    ), '[]'::jsonb),
    'class_engagement', (
      SELECT jsonb_build_object(
        'students', COUNT(*),
        'with_xp', COUNT(x.user_id),
        'avg_xp', COALESCE(ROUND(AVG(COALESCE(x.xp, 0))), 0),
        'avg_streak', COALESCE(ROUND(AVG(COALESCE(x.study_streak, 0))), 0),
        'avg_reputation', COALESCE(ROUND(AVG(COALESCE(x.reputation, 0))), 0),
        'practice_rate', CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(x.practice_sessions_count, 0) > 0) / COUNT(*)) END,
        'homework_rate', CASE WHEN COUNT(*) = 0 THEN 0
          ELSE ROUND(100.0 * COUNT(*) FILTER (WHERE COALESCE(x.homework_submitted_count, 0) > 0) / COUNT(*)) END
      )
      FROM public.students s
      LEFT JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_teacher_class_progression_insights(uuid) TO authenticated;

-- Leaderboard: period Ã— scope Ã— metric
CREATE OR REPLACE FUNCTION public.rpc_progression_leaderboard(
  _scope text DEFAULT 'class',
  _period text DEFAULT 'weekly',
  _metric text DEFAULT 'xp',
  _subject text DEFAULT NULL,
  _limit int DEFAULT 50
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _student record;
  _since timestamptz;
  _lim int := LEAST(GREATEST(COALESCE(_limit, 50), 1), 200);
  _rows jsonb := '[]'::jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;

  _since := CASE lower(_period)
    WHEN 'daily' THEN date_trunc('day', now())
    WHEN 'monthly' THEN date_trunc('month', now())
    ELSE date_trunc('week', now())
  END;

  SELECT s.id, s.class_id, s.school_id, s.user_id
  INTO _student
  FROM public.students s
  WHERE s.user_id = _uid
  LIMIT 1;

  IF lower(_metric) = 'xp' AND lower(_period) IN ('all', 'lifetime') THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO _rows
    FROM (
      SELECT s.user_id, s.full_name AS name, COALESCE(x.xp, 0) AS value,
             COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
      FROM public.students s
      JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE (
        (lower(_scope) = 'class' AND _student.class_id IS NOT NULL AND s.class_id = _student.class_id)
        OR (lower(_scope) = 'school' AND _student.school_id IS NOT NULL AND s.school_id = _student.school_id)
        OR (lower(_scope) = 'section' AND _student.class_id IS NOT NULL AND s.class_id = _student.class_id)
      )
      ORDER BY x.xp DESC
      LIMIT _lim
    ) t;
  ELSIF lower(_metric) = 'streak' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO _rows
    FROM (
      SELECT s.user_id, s.full_name AS name, COALESCE(x.study_streak, 0) AS value,
             COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
      FROM public.students s
      JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE (
        (lower(_scope) IN ('class', 'section') AND _student.class_id IS NOT NULL AND s.class_id = _student.class_id)
        OR (lower(_scope) = 'school' AND _student.school_id IS NOT NULL AND s.school_id = _student.school_id)
      )
      ORDER BY x.study_streak DESC, x.xp DESC
      LIMIT _lim
    ) t;
  ELSIF lower(_metric) = 'improvement' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO _rows
    FROM (
      SELECT s.user_id, s.full_name AS name,
             COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) AS value,
             COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
      FROM public.students s
      LEFT JOIN public.student_xp x ON x.user_id = s.user_id
      LEFT JOIN public.progression_history h
        ON h.user_id = s.user_id AND h.created_at >= _since
      WHERE (
        (lower(_scope) IN ('class', 'section') AND _student.class_id IS NOT NULL AND s.class_id = _student.class_id)
        OR (lower(_scope) = 'school' AND _student.school_id IS NOT NULL AND s.school_id = _student.school_id)
      )
      GROUP BY s.user_id, s.full_name, x.level, x.league_code
      ORDER BY value DESC
      LIMIT _lim
    ) t;
  ELSIF lower(_metric) = 'battleground' THEN
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO _rows
    FROM (
      SELECT s.user_id, s.full_name AS name, COALESCE(x.wins, 0) AS value,
             COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
      FROM public.students s
      JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE (
        (lower(_scope) IN ('class', 'section') AND _student.class_id IS NOT NULL AND s.class_id = _student.class_id)
        OR (lower(_scope) = 'school' AND _student.school_id IS NOT NULL AND s.school_id = _student.school_id)
      )
      ORDER BY x.wins DESC, x.xp DESC
      LIMIT _lim
    ) t;
  ELSE
    -- Period XP from history
    SELECT COALESCE(jsonb_agg(row_to_json(t)), '[]'::jsonb) INTO _rows
    FROM (
      SELECT s.user_id, s.full_name AS name,
             COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) AS value,
             COALESCE(x.level, 1) AS level, COALESCE(x.league_code, 'bronze') AS league
      FROM public.students s
      LEFT JOIN public.student_xp x ON x.user_id = s.user_id
      LEFT JOIN public.progression_history h
        ON h.user_id = s.user_id AND h.created_at >= _since
      WHERE (
        (lower(_scope) IN ('class', 'section') AND _student.class_id IS NOT NULL AND s.class_id = _student.class_id)
        OR (lower(_scope) = 'school' AND _student.school_id IS NOT NULL AND s.school_id = _student.school_id)
        OR (lower(_scope) = 'subject' AND _student.class_id IS NOT NULL AND s.class_id = _student.class_id)
      )
      GROUP BY s.user_id, s.full_name, x.level, x.league_code
      HAVING COALESCE(SUM(CASE WHEN h.xp_delta > 0 THEN h.xp_delta ELSE 0 END), 0) > 0
      ORDER BY value DESC
      LIMIT _lim
    ) t;
  END IF;

  RETURN jsonb_build_object(
    'scope', _scope,
    'period', _period,
    'metric', _metric,
    'subject', _subject,
    'rows', COALESCE(_rows, '[]'::jsonb)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_progression_leaderboard(text, text, text, text, int) TO authenticated;

-- ---------------------------------------------------------------------------
-- 12) Wire practice finish â†’ progression (unify xp_earned into student_xp)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(
  _session_id uuid,
  _attempts jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _s record;
  _mins int;
  _att jsonb;
  _bank_id uuid;
  _total int;
  _correct int;
  _skipped int;
  _wrong int;
  _time_ms int;
  _xp int;
  _prog jsonb := NULL;
  _already boolean := false;
BEGIN
  SELECT * INTO _s
  FROM public.practice_sessions
  WHERE id = _session_id AND user_id = auth.uid();

  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  _already := _s.finished_at IS NOT NULL;

  IF _attempts IS NOT NULL
     AND jsonb_typeof(_attempts) = 'array'
     AND jsonb_array_length(_attempts) > 0 THEN
    FOR _att IN SELECT value FROM jsonb_array_elements(_attempts) AS value
    LOOP
      _bank_id := COALESCE(
        NULLIF(_att->>'bank_question_id', '')::uuid,
        NULLIF(_att->'generated_question'->>'bank_question_id', '')::uuid
      );
      PERFORM public.rpc_record_question_attempt(
        COALESCE(_att->'correct_answer', '{}'::jsonb),
        COALESCE(_att->'generated_question', '{}'::jsonb),
        COALESCE((_att->>'is_correct')::boolean, false),
        COALESCE(_att->'selected_answer', '{}'::jsonb),
        _session_id,
        COALESCE((_att->>'score')::numeric, 0),
        COALESCE((_att->>'skipped')::boolean, false),
        NULLIF(_att->>'template_id', '')::uuid,
        NULLIF(_att->>'time_taken_ms', '')::int,
        _bank_id,
        COALESCE((_att->>'hint_used')::boolean, false),
        COALESCE(NULLIF(_att->>'source', ''), 'practice'),
        COALESCE(_att->'meta', '{}'::jsonb)
          || jsonb_build_object(
            'solution_viewed', COALESCE((_att->>'solution_viewed')::boolean, false),
            'confidence', _att->'confidence',
            'attempt_number', _att->'attempt_number',
            'timed_out', COALESCE((_att->>'timed_out')::boolean, false),
            'practice_mode', COALESCE(_att->>'practice_mode', _s.practice_mode),
            'source_id', COALESCE(_att->>'source_id', _session_id::text),
            'class_level', COALESCE(_att->>'class_level', _s.class_level::text),
            'board', COALESCE(_att->>'board', _s.board),
            'stream', COALESCE(_att->>'stream', _s.stream),
            'topic', _att->>'topic',
            'difficulty', _att->>'difficulty',
            'school_id', COALESCE(_att->>'school_id', _s.school_id::text),
            'answered_at', _att->>'answered_at'
          )
      );
    END LOOP;
  END IF;

  SELECT
    count(*)::int,
    count(*) FILTER (WHERE is_correct AND NOT COALESCE(skipped, false))::int,
    count(*) FILTER (WHERE COALESCE(skipped, false))::int,
    count(*) FILTER (WHERE NOT is_correct AND NOT COALESCE(skipped, false))::int,
    COALESCE(sum(time_taken_ms), 0)::int
  INTO _total, _correct, _skipped, _wrong, _time_ms
  FROM public.question_attempts
  WHERE session_id = _session_id AND user_id = auth.uid();

  -- Display XP = correct Ã— 5 (rule) + session complete bonus (25) when first finished
  _xp := GREATEST(_correct, 0) * 5 + CASE WHEN NOT _already THEN 25 ELSE 0 END;

  UPDATE public.practice_sessions ps
  SET
    correct_count = _correct,
    score = _correct,
    skipped_count = _skipped,
    wrong_count = _wrong,
    total_time_ms = NULLIF(_time_ms, 0),
    accuracy = CASE WHEN _total > 0 THEN round((_correct::numeric / _total) * 100, 2) ELSE 0 END,
    question_count = CASE WHEN _total > 0 THEN _total ELSE ps.question_count END,
    xp_earned = CASE WHEN ps.finished_at IS NULL THEN _xp ELSE COALESCE(ps.xp_earned, _xp) END,
    finished_at = COALESCE(ps.finished_at, now())
  WHERE ps.id = _session_id AND ps.user_id = auth.uid()
  RETURNING ps.* INTO _s;

  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  IF NOT _already THEN
    PERFORM public._ensure_student_xp(auth.uid());
    UPDATE public.student_xp SET
      practice_sessions_count = COALESCE(practice_sessions_count, 0) + 1,
      total_correct = COALESCE(total_correct, 0) + _correct,
      total_answered = COALESCE(total_answered, 0) + GREATEST(_total - _skipped, 0),
      updated_at = now()
    WHERE user_id = auth.uid();

    PERFORM public._progression_bump_study_streak(auth.uid());

    _prog := public.rpc_apply_progression(
      'practice.session.complete',
      'practice_session',
      _session_id::text,
      'practice.session:' || _session_id::text,
      NULL,
      jsonb_build_object('correct', _correct, 'total', _total),
      auth.uid()
    );

    IF _correct > 0 THEN
      PERFORM public.rpc_apply_progression(
        'practice.correct_answer',
        'practice_session',
        _session_id::text,
        'practice.correct:' || _session_id::text,
        _correct * 5,
        jsonb_build_object('correct', _correct),
        auth.uid()
      );
    END IF;
  END IF;

  BEGIN
    PERFORM public.rpc_refresh_academic_brain();
  EXCEPTION WHEN others THEN
    NULL;
  END;

  RETURN jsonb_build_object(
    'session_id', _session_id,
    'correct_count', _correct,
    'wrong_count', _wrong,
    'skipped_count', _skipped,
    'total', _total,
    'xp_earned', COALESCE(_s.xp_earned, _xp),
    'accuracy', _s.accuracy,
    'finished_at', _s.finished_at,
    'already_finished', _already,
    'progression', _prog
  );
END;
$$;

-- ---------------------------------------------------------------------------
-- 13) Realtime for progression tables
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.progression_history;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
  BEGIN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.student_achievements;
  EXCEPTION WHEN duplicate_object THEN NULL;
  END;
END $$;

