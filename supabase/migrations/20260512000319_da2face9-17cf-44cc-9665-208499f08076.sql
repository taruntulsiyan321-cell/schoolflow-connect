
-- Battleground feature schema

CREATE TYPE public.battle_status AS ENUM ('scheduled','live','finished','cancelled');
CREATE TYPE public.battle_type AS ENUM ('mcq','rapid','timed','daily');
CREATE TYPE public.badge_tier AS ENUM ('bronze','silver','gold','platinum');

-- Battles
CREATE TABLE public.battles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class_id uuid REFERENCES public.classes(id) ON DELETE CASCADE,
  creator_user_id uuid NOT NULL,
  title text NOT NULL,
  subject text NOT NULL,
  topic text,
  type public.battle_type NOT NULL DEFAULT 'mcq',
  status public.battle_status NOT NULL DEFAULT 'scheduled',
  starts_at timestamptz NOT NULL DEFAULT now(),
  duration_sec int NOT NULL DEFAULT 300,
  per_question_sec int NOT NULL DEFAULT 20,
  question_count int NOT NULL DEFAULT 5,
  is_public boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.battle_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  order_index int NOT NULL,
  question text NOT NULL,
  options jsonb NOT NULL,
  correct_index int NOT NULL,
  points int NOT NULL DEFAULT 10
);

CREATE TABLE public.battle_participants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id uuid NOT NULL REFERENCES public.battles(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  display_name text NOT NULL DEFAULT '',
  joined_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz,
  score int NOT NULL DEFAULT 0,
  correct_count int NOT NULL DEFAULT 0,
  answered_count int NOT NULL DEFAULT 0,
  total_time_ms int NOT NULL DEFAULT 0,
  rank int,
  UNIQUE(battle_id, user_id)
);

CREATE TABLE public.battle_answers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  participant_id uuid NOT NULL REFERENCES public.battle_participants(id) ON DELETE CASCADE,
  question_id uuid NOT NULL REFERENCES public.battle_questions(id) ON DELETE CASCADE,
  selected_index int NOT NULL,
  is_correct boolean NOT NULL,
  time_ms int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(participant_id, question_id)
);

CREATE TABLE public.student_xp (
  user_id uuid PRIMARY KEY,
  xp int NOT NULL DEFAULT 0,
  level int NOT NULL DEFAULT 1,
  current_streak int NOT NULL DEFAULT 0,
  longest_streak int NOT NULL DEFAULT 0,
  total_battles int NOT NULL DEFAULT 0,
  wins int NOT NULL DEFAULT 0,
  last_battle_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE public.student_badges (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  badge_code text NOT NULL,
  tier public.badge_tier NOT NULL DEFAULT 'bronze',
  earned_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, badge_code)
);

-- Indexes
CREATE INDEX idx_battles_class ON public.battles(class_id, status, starts_at DESC);
CREATE INDEX idx_battle_q_battle ON public.battle_questions(battle_id, order_index);
CREATE INDEX idx_battle_p_battle ON public.battle_participants(battle_id, score DESC);
CREATE INDEX idx_battle_a_part ON public.battle_answers(participant_id);

-- RLS
ALTER TABLE public.battles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_xp ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.student_badges ENABLE ROW LEVEL SECURITY;

-- battles policies: classmates can read public battles in their class; creator manages own; admin all
CREATE POLICY "battles read class" ON public.battles FOR SELECT TO authenticated
USING (
  is_public = true AND (
    public.student_class_id(auth.uid()) = class_id
    OR creator_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR public.teacher_teaches_class(auth.uid(), class_id)
  )
);
CREATE POLICY "battles creator manage" ON public.battles FOR ALL TO authenticated
USING (creator_user_id = auth.uid()) WITH CHECK (creator_user_id = auth.uid());
CREATE POLICY "battles admin all" ON public.battles FOR ALL
USING (public.has_role(auth.uid(), 'admin'::app_role))
WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

-- questions: same readers as battle; creator can insert
CREATE POLICY "bq read" ON public.battle_questions FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.battles b WHERE b.id = battle_id AND (
  b.creator_user_id = auth.uid()
  OR public.student_class_id(auth.uid()) = b.class_id
  OR public.has_role(auth.uid(), 'admin'::app_role)
)));
CREATE POLICY "bq creator manage" ON public.battle_questions FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.battles b WHERE b.id = battle_id AND b.creator_user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.battles b WHERE b.id = battle_id AND b.creator_user_id = auth.uid()));

-- participants: classmates can see scores of accessible battles; self manage own row
CREATE POLICY "bp read class" ON public.battle_participants FOR SELECT TO authenticated
USING (EXISTS (SELECT 1 FROM public.battles b WHERE b.id = battle_id AND (
  b.is_public = true AND (
    public.student_class_id(auth.uid()) = b.class_id
    OR b.creator_user_id = auth.uid()
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'principal'::app_role)
    OR public.teacher_teaches_class(auth.uid(), b.class_id)
  )
)));
CREATE POLICY "bp self insert" ON public.battle_participants FOR INSERT TO authenticated
WITH CHECK (user_id = auth.uid());
CREATE POLICY "bp self update" ON public.battle_participants FOR UPDATE TO authenticated
USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- answers: self only
CREATE POLICY "ba self all" ON public.battle_answers FOR ALL TO authenticated
USING (EXISTS (SELECT 1 FROM public.battle_participants p WHERE p.id = participant_id AND p.user_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.battle_participants p WHERE p.id = participant_id AND p.user_id = auth.uid()));

-- xp & badges: self read, system writes via RPC; admin all
CREATE POLICY "xp self read" ON public.student_xp FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.has_role(auth.uid(),'admin'::app_role));
CREATE POLICY "xp self upsert" ON public.student_xp FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE POLICY "badges read class" ON public.student_badges FOR SELECT TO authenticated USING (true);
CREATE POLICY "badges self insert" ON public.student_badges FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

-- RPC: finish battle and award XP
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid;
  _battle uuid;
  _score int;
  _correct int;
  _new_xp int;
  _won boolean := false;
  _max_score int;
BEGIN
  SELECT user_id, battle_id, score, correct_count INTO _user, _battle, _score, _correct
    FROM public.battle_participants WHERE id = _participant_id;
  IF _user IS NULL OR _user <> auth.uid() THEN
    RAISE EXCEPTION 'Not your participation';
  END IF;

  UPDATE public.battle_participants SET finished_at = COALESCE(finished_at, now()) WHERE id = _participant_id;

  -- Recompute ranks
  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  -- Did they win?
  SELECT MAX(score) INTO _max_score FROM public.battle_participants WHERE battle_id = _battle;
  _won := (_score = _max_score AND _score > 0);

  -- Upsert XP
  INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at)
  VALUES (_user, _score, 1 + (_score / 100), 1, CASE WHEN _won THEN 1 ELSE 0 END, now())
  ON CONFLICT (user_id) DO UPDATE
    SET xp = student_xp.xp + EXCLUDED.xp,
        level = 1 + ((student_xp.xp + EXCLUDED.xp) / 100),
        total_battles = student_xp.total_battles + 1,
        wins = student_xp.wins + CASE WHEN _won THEN 1 ELSE 0 END,
        last_battle_at = now(),
        updated_at = now();

  -- Award basic badges
  IF _won THEN
    INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (_user, 'first_win', 'bronze')
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;
  IF _correct >= 5 THEN
    INSERT INTO public.student_badges(user_id, badge_code, tier) VALUES (_user, 'sharp_shooter', 'silver')
    ON CONFLICT (user_id, badge_code) DO NOTHING;
  END IF;
END;
$$;

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_participants;
ALTER PUBLICATION supabase_realtime ADD TABLE public.battle_answers;
ALTER PUBLICATION supabase_realtime ADD TABLE public.battles;
