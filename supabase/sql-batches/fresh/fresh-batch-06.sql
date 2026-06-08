-- FRESH DATABASE batch 6/12
-- For NEW empty Supabase project (paste in SQL Editor → Run)
-- Project: imrsjhftejghcrhzdjrl

-- ── 20260509064250_0d3a48e5-93b0-4835-8c62-e3e252a5dbd6.sql


-- Attendance locks
CREATE TABLE IF NOT EXISTS public.attendance_locks (
  class_id uuid NOT NULL,
  date date NOT NULL,
  locked_by uuid,
  locked_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (class_id, date)
);
ALTER TABLE public.attendance_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "locks read auth" ON public.attendance_locks
  FOR SELECT TO authenticated USING (true);

CREATE POLICY "locks teacher insert"  ON public.attendance_locks
  FOR INSERT TO authenticated
  WITH CHECK (public.teacher_teaches_class(auth.uid(), class_id) OR public.is_principal_or_admin(auth.uid()));

CREATE POLICY "locks admin delete" ON public.attendance_locks
  FOR DELETE TO authenticated
  USING (public.is_principal_or_admin(auth.uid()));

-- Audit history for attendance changes
CREATE TABLE IF NOT EXISTS public.attendance_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id uuid,
  student_id uuid,
  class_id uuid,
  date date,
  prev_status text,
  new_status text,
  edited_by uuid,
  edited_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.attendance_audit ENABLE ROW LEVEL SECURITY;

CREATE POLICY "audit principal admin read" ON public.attendance_audit
  FOR SELECT USING (public.is_principal_or_admin(auth.uid()));

CREATE POLICY "audit any authenticated insert" ON public.attendance_audit
  FOR INSERT TO authenticated WITH CHECK (true);

-- Trigger function to log changes
CREATE OR REPLACE FUNCTION public.tg_log_attendance_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.attendance_audit (attendance_id, student_id, class_id, date, prev_status, new_status, edited_by)
    VALUES (NEW.id, NEW.student_id, NEW.class_id, NEW.date, OLD.status::text, NEW.status::text, auth.uid());
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS attendance_audit_trg ON public.attendance;
CREATE TRIGGER attendance_audit_trg
AFTER UPDATE ON public.attendance
FOR EACH ROW EXECUTE FUNCTION public.tg_log_attendance_change();



-- ── 20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql


-- 1. Block admins from self-assigning principal/admin via the generic RPC
CREATE OR REPLACE FUNCTION public.admin_assign_role(_identifier text, _role app_role)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _id text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can assign roles';
  END IF;
  IF _role IN ('principal'::app_role, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Principal and Admin roles are managed by the platform owner only';
  END IF;
  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN
    RAISE EXCEPTION 'Email or phone required';
  END IF;
  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
     WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
     LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No user found with %. Ask them to sign in once first.', _id;
  END IF;
  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, _role)
  ON CONFLICT (user_id, role) DO NOTHING;
  RETURN _uid;
END; $function$;

-- 2. Also block principal/admin removal by admins
CREATE OR REPLACE FUNCTION public.admin_remove_role(_user_id uuid, _role app_role)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can remove roles';
  END IF;
  IF _role IN ('principal'::app_role, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Principal and Admin roles are managed by the platform owner only';
  END IF;
  DELETE FROM public.user_roles WHERE user_id = _user_id AND role = _role;
END; $function$;

-- 3. Student access: connect a student record to a signed-in account (Google email or phone)
CREATE OR REPLACE FUNCTION public.admin_connect_student_account(_student_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _id text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can connect student accounts';
  END IF;
  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
      WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
      LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No account found for %. Ask the student to sign in with Google once first.', _id;
  END IF;

  UPDATE public.students SET user_id = _uid WHERE id = _student_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _uid;
END; $function$;

-- 4. Revoke student account access
CREATE OR REPLACE FUNCTION public.admin_revoke_student_account(_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can revoke student accounts';
  END IF;
  SELECT user_id INTO _uid FROM public.students WHERE id = _student_id;
  UPDATE public.students SET user_id = NULL WHERE id = _student_id;
  IF _uid IS NOT NULL THEN
    -- only remove student role if user is not also linked elsewhere (rare for students)
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'student'::app_role;
  END IF;
END; $function$;

-- 5. Teacher access: connect Google account to teacher row + grant teacher role + activate
CREATE OR REPLACE FUNCTION public.admin_connect_teacher_account(_teacher_id uuid, _identifier text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid; _id text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can connect teacher accounts';
  END IF;
  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN RAISE EXCEPTION 'Email or phone required'; END IF;

  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
  ELSE
    SELECT id INTO _uid FROM auth.users
      WHERE regexp_replace(coalesce(phone,''), '\D', '', 'g') = regexp_replace(_id, '\D', '', 'g')
      LIMIT 1;
  END IF;
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'No account found for %. Ask the teacher to sign in with Google once first.', _id;
  END IF;

  UPDATE public.teachers SET user_id = _uid, status = 'active' WHERE id = _teacher_id;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher'::app_role)
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _uid;
END; $function$;

-- 6. Set teacher access status (activate / deactivate)
CREATE OR REPLACE FUNCTION public.admin_set_teacher_access(_teacher_id uuid, _active boolean)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can change teacher access';
  END IF;
  UPDATE public.teachers SET status = CASE WHEN _active THEN 'active' ELSE 'inactive' END
    WHERE id = _teacher_id RETURNING user_id INTO _uid;
  IF _uid IS NOT NULL THEN
    IF _active THEN
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher'::app_role)
      ON CONFLICT (user_id, role) DO NOTHING;
    ELSE
      DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'teacher'::app_role;
    END IF;
  END IF;
END; $function$;

-- 7. Disconnect teacher account entirely
CREATE OR REPLACE FUNCTION public.admin_revoke_teacher_account(_teacher_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can revoke teacher accounts';
  END IF;
  SELECT user_id INTO _uid FROM public.teachers WHERE id = _teacher_id;
  UPDATE public.teachers SET user_id = NULL, status = 'inactive' WHERE id = _teacher_id;
  IF _uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'teacher'::app_role;
  END IF;
END; $function$;



-- ── 20260511074536_bba86536-9f1a-46b1-9147-7aff23c554a7.sql

ALTER TABLE public.classes
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'class',
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS category text;

ALTER TABLE public.classes ALTER COLUMN name DROP NOT NULL;
ALTER TABLE public.classes ALTER COLUMN section DROP NOT NULL;

ALTER TABLE public.classes
  ADD CONSTRAINT classes_kind_check CHECK (kind IN ('class','batch'));


-- ── 20260512000319_da2face9-17cf-44cc-9665-208499f08076.sql


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


