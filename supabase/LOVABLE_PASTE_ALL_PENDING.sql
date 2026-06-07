-- PASTE IN LOVABLE -> Supabase -> SQL Editor -> Run once\n-- Pending migrations + demo data for SchoolFlow Connect\n\n\n-- ========== 20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql ==========\n\n
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
\n\n-- ========== 20260516000000_inquiries_complaints.sql ==========\n\n-- Inquiry & complaint workflows for admin / principal

DO $$ BEGIN
  CREATE TYPE public.case_status AS ENUM ('open', 'in_progress', 'resolved', 'closed');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.school_inquiries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contact_name text NOT NULL,
  contact_phone text,
  contact_email text,
  grade_interest text,
  message text NOT NULL,
  status public.case_status NOT NULL DEFAULT 'open',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.school_complaints (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  submitted_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  complainant_name text NOT NULL DEFAULT '',
  subject text NOT NULL,
  body text NOT NULL,
  category text NOT NULL DEFAULT 'general',
  status public.case_status NOT NULL DEFAULT 'open',
  resolution_notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inquiries_status ON public.school_inquiries(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_complaints_status ON public.school_complaints(status, created_at DESC);

ALTER TABLE public.school_inquiries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.school_complaints ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "inquiries staff all" ON public.school_inquiries;
CREATE POLICY "inquiries staff all" ON public.school_inquiries FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
);

DROP POLICY IF EXISTS "inquiries anyone insert" ON public.school_inquiries;
CREATE POLICY "inquiries anyone insert" ON public.school_inquiries FOR INSERT TO authenticated
WITH CHECK (true);

DROP POLICY IF EXISTS "complaints staff all" ON public.school_complaints;
CREATE POLICY "complaints staff all" ON public.school_complaints FOR ALL TO authenticated
USING (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
)
WITH CHECK (
  public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
);

DROP POLICY IF EXISTS "complaints submit" ON public.school_complaints;
CREATE POLICY "complaints submit" ON public.school_complaints FOR INSERT TO authenticated
WITH CHECK (submitted_by = auth.uid() OR submitted_by IS NULL);

DROP POLICY IF EXISTS "complaints read own" ON public.school_complaints;
CREATE POLICY "complaints read own" ON public.school_complaints FOR SELECT TO authenticated
USING (
  submitted_by = auth.uid()
  OR public.has_role(auth.uid(), 'admin'::app_role)
  OR public.has_role(auth.uid(), 'principal'::app_role)
);
\n\n-- ========== 20260604000000_wisdom_student_engine.sql ==========\n\n-- =========================================================
-- Wisdom Campus — Student panel engine upgrade (Phase 1)
--   * Anti-repetition question engine
--   * 1-tap "challenge a classmate" RPC
--   * Richer badge awarding + XP aggregate stats
--   * Curated starter question-bank seed (classes 9-12)
-- Idempotent where practical so it is safe to re-run.
-- =========================================================

-- ---------------------------------------------------------
-- 1) Link generated battle questions back to the bank
--    (needed for anti-repetition + future analytics)
-- ---------------------------------------------------------
ALTER TABLE public.battle_questions
  ADD COLUMN IF NOT EXISTS bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL;

-- ---------------------------------------------------------
-- 2) Per-student question history (anti-repetition memory)
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.student_question_history (
  user_id      uuid NOT NULL,
  question_id  uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  times_seen   int  NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_sqh_user ON public.student_question_history(user_id, last_seen_at DESC);

ALTER TABLE public.student_question_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sqh self read" ON public.student_question_history;
CREATE POLICY "sqh self read" ON public.student_question_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- writes occur only through SECURITY DEFINER RPCs (which bypass RLS)

-- ---------------------------------------------------------
-- 3) Extra aggregate stats on student_xp
-- ---------------------------------------------------------
ALTER TABLE public.student_xp
  ADD COLUMN IF NOT EXISTS best_score      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_correct   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_answered  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS win_streak      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_win_streak int NOT NULL DEFAULT 0;

-- ---------------------------------------------------------
-- 4) Badge award helper
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._award_badge(_uid uuid, _code text, _tier public.badge_tier DEFAULT 'bronze')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.student_badges(user_id, badge_code, tier)
  VALUES (_uid, _code, _tier)
  ON CONFLICT (user_id, badge_code) DO NOTHING;
$$;

-- ---------------------------------------------------------
-- 5) Anti-repetition aware battle generator
--    Difficulty becomes a *preference* (not a hard filter) so a
--    modest bank still always produces a battle. Unseen questions
--    are strongly preferred; seen ones fall back least-recent-first.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count int DEFAULT 5)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher') THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0)                     AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      seen ASC,                                              -- fresh first
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC, -- then preferred difficulty
      last_seen ASC,                                         -- then least-recently seen
      random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET source = 'bank', question_count = _inserted, duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $$;

-- ---------------------------------------------------------
-- 6) Finish battle: record history, aggregate stats, award badges
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _battle uuid; _score int; _correct int; _answered int; _time int;
  _won boolean := false; _max_score int; _xp record; _avg_ms numeric; _hour int;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms
    INTO _user, _battle, _score, _correct, _answered, _time
    FROM public.battle_participants WHERE id = _participant_id;
  IF _user IS NULL OR _user <> auth.uid() THEN RAISE EXCEPTION 'Not your participation'; END IF;

  UPDATE public.battle_participants SET finished_at = COALESCE(finished_at, now()) WHERE id = _participant_id;

  -- recompute ranks for this battle
  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  SELECT MAX(score) INTO _max_score FROM public.battle_participants WHERE battle_id = _battle;
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
END $$;

-- ---------------------------------------------------------
-- 7) 1-tap challenge a specific classmate
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

  RETURN _bid;
END $$;

-- ---------------------------------------------------------
-- 8) Curated starter question bank seed
--    Correct, NCERT-aligned basics so battles work immediately.
--    Scale to thousands later via the AI "generate into bank" tool.
--    Guard: only seed when the bank is (near) empty.
-- ---------------------------------------------------------
DO $seed$
BEGIN
IF (SELECT count(*) FROM public.question_bank) < 20 THEN
  INSERT INTO public.question_bank (class_level, subject, chapter, difficulty, question, options, correct_index, explanation, source) VALUES
  -- Mathematics
  (9,  'Mathematics', 'Number Systems', 'easy',   'Which of the following is a rational number?',                 '["0.75","\u221a2","\u03c0","\u221a3"]'::jsonb, 0, '0.75 = 3/4, a ratio of integers.', 'seed'),
  (9,  'Mathematics', 'Triangles', 'easy',         'The sum of the interior angles of a triangle is:',            '["90\u00b0","180\u00b0","270\u00b0","360\u00b0"]'::jsonb, 1, 'Angle sum property of a triangle.', 'seed'),
  (9,  'Mathematics', 'Mensuration', 'medium',     'The area of a circle of radius r is:',                         '["2\u03c0r","\u03c0r\u00b2","\u03c0d","2\u03c0r\u00b2"]'::jsonb, 1, 'Area = \u03c0r\u00b2.', 'seed'),
  (10, 'Mathematics', 'Quadratic Equations', 'medium', 'The discriminant of ax\u00b2 + bx + c = 0 is:',            '["b\u00b2 \u2212 4ac","2a","\u2212b/2a","b\u00b2 + 4ac"]'::jsonb, 0, 'Discriminant D = b\u00b2 \u2212 4ac.', 'seed'),
  (10, 'Mathematics', 'Real Numbers', 'easy',      'The HCF of 12 and 18 is:',                                     '["6","12","3","9"]'::jsonb, 0, '12 = 2\u00b2\u00d73, 18 = 2\u00d73\u00b2, HCF = 2\u00d73 = 6.', 'seed'),
  (10, 'Mathematics', 'Trigonometry', 'medium',    'The value of sin 30\u00b0 is:',                                '["1/2","\u221a3/2","1","0"]'::jsonb, 0, 'sin 30\u00b0 = 1/2.', 'seed'),
  (11, 'Mathematics', 'Calculus', 'medium',        'The derivative of x\u00b2 with respect to x is:',              '["2x","x","x\u00b2/2","2"]'::jsonb, 0, 'd/dx(x\u00b2) = 2x.', 'seed'),
  (11, 'Mathematics', 'Logarithms', 'easy',        'The value of log\u2081\u2080(1) is:',                          '["1","0","10","Undefined"]'::jsonb, 1, 'log of 1 to any base is 0.', 'seed'),
  (12, 'Mathematics', 'Integration', 'medium',     'The value of \u222b 1 dx is:',                                 '["x + C","1","0","x\u00b2"]'::jsonb, 0, 'Integral of 1 is x + C.', 'seed'),
  (12, 'Mathematics', 'Exponentials', 'easy',      'The value of e\u2070 is:',                                     '["0","1","e","\u221e"]'::jsonb, 1, 'Any non-zero number to the power 0 is 1.', 'seed'),
  -- Physics
  (9,  'Physics', 'Force and Laws of Motion', 'easy', 'The SI unit of force is:',                                  '["Newton","Joule","Watt","Pascal"]'::jsonb, 0, 'Force is measured in newtons (N).', 'seed'),
  (9,  'Physics', 'Gravitation', 'easy',           'The acceleration due to gravity on Earth is approximately:',   '["9.8 m/s\u00b2","8.9 m/s\u00b2","10.8 m/s\u00b2","6.7 m/s\u00b2"]'::jsonb, 0, 'g \u2248 9.8 m/s\u00b2.', 'seed'),
  (10, 'Physics', 'Electricity', 'medium',         'Ohm''s law is expressed as:',                                  '["V = IR","V = I/R","V = R/I","V = I + R"]'::jsonb, 0, 'Voltage = Current \u00d7 Resistance.', 'seed'),
  (10, 'Physics', 'Electricity', 'easy',           'The SI unit of electric current is:',                          '["Ampere","Volt","Ohm","Watt"]'::jsonb, 0, 'Current is measured in amperes (A).', 'seed'),
  (11, 'Physics', 'Units and Measurement', 'medium','Which of the following is a vector quantity?',                '["Speed","Mass","Velocity","Time"]'::jsonb, 2, 'Velocity has both magnitude and direction.', 'seed'),
  (11, 'Physics', 'Work, Energy and Power', 'easy', 'The SI unit of work is:',                                     '["Joule","Newton","Watt","Pascal"]'::jsonb, 0, 'Work is measured in joules (J).', 'seed'),
  (12, 'Physics', 'Electrostatics', 'medium',      'The SI unit of capacitance is:',                               '["Farad","Henry","Tesla","Weber"]'::jsonb, 0, 'Capacitance is measured in farads (F).', 'seed'),
  -- Chemistry
  (9,  'Chemistry', 'Atoms and Molecules', 'easy', 'The chemical symbol for sodium is:',                           '["Na","S","So","Sd"]'::jsonb, 0, 'Sodium = Na (from Latin natrium).', 'seed'),
  (9,  'Chemistry', 'Matter', 'easy',              'Water is made up of hydrogen and:',                            '["Oxygen","Nitrogen","Carbon","Helium"]'::jsonb, 0, 'Water is H\u2082O.', 'seed'),
  (10, 'Chemistry', 'Acids, Bases and Salts', 'easy', 'The pH of a neutral solution is:',                         '["7","0","14","1"]'::jsonb, 0, 'Neutral pH = 7.', 'seed'),
  (10, 'Chemistry', 'Acids, Bases and Salts', 'easy', 'The chemical formula of common salt is:',                  '["NaCl","KCl","HCl","NaOH"]'::jsonb, 0, 'Common salt is sodium chloride, NaCl.', 'seed'),
  (11, 'Chemistry', 'Structure of Atom', 'easy',   'The atomic number of carbon is:',                              '["6","12","8","14"]'::jsonb, 0, 'Carbon has 6 protons.', 'seed'),
  (11, 'Chemistry', 'Periodic Table', 'medium',    'The most electronegative element is:',                         '["Fluorine","Oxygen","Chlorine","Nitrogen"]'::jsonb, 0, 'Fluorine is the most electronegative.', 'seed'),
  (12, 'Chemistry', 'p-Block Elements', 'medium',  'Which gas is commonly known as laughing gas?',                 '["Nitrous oxide (N\u2082O)","Carbon dioxide","Oxygen","Nitrogen dioxide"]'::jsonb, 0, 'N\u2082O is laughing gas.', 'seed'),
  -- Biology
  (9,  'Biology', 'The Fundamental Unit of Life', 'easy', 'The basic structural unit of life is the:',             '["Cell","Atom","Tissue","Organ"]'::jsonb, 0, 'The cell is the basic unit of life.', 'seed'),
  (9,  'Biology', 'The Fundamental Unit of Life', 'easy', 'The "powerhouse of the cell" is the:',                  '["Mitochondria","Nucleus","Ribosome","Golgi body"]'::jsonb, 0, 'Mitochondria produce ATP.', 'seed'),
  (10, 'Biology', 'Life Processes', 'easy',        'Which organ pumps blood throughout the body?',                 '["Heart","Liver","Lungs","Kidney"]'::jsonb, 0, 'The heart pumps blood.', 'seed'),
  (10, 'Biology', 'Life Processes', 'easy',        'The green pigment in plants responsible for photosynthesis is:', '["Chlorophyll","Hemoglobin","Carotene","Melanin"]'::jsonb, 0, 'Chlorophyll captures light energy.', 'seed'),
  (11, 'Biology', 'Human Physiology', 'easy',      'How many chambers does the human heart have?',                 '["4","2","3","1"]'::jsonb, 0, 'Two atria and two ventricles.', 'seed'),
  (12, 'Biology', 'Molecular Basis of Inheritance', 'medium', 'DNA stands for:',                                   '["Deoxyribonucleic acid","Dinucleic acid","Deoxyribose acid","Diribonucleic acid"]'::jsonb, 0, 'DNA = Deoxyribonucleic acid.', 'seed'),
  -- English
  (NULL, 'English', 'Vocabulary', 'easy',          'Choose the correct synonym of "happy".',                       '["Joyful","Sad","Angry","Tired"]'::jsonb, 0, 'Joyful means happy.', 'seed'),
  (NULL, 'English', 'Grammar', 'easy',             'The plural of "child" is:',                                    '["Children","Childs","Childes","Child"]'::jsonb, 0, 'Irregular plural: children.', 'seed'),
  (NULL, 'English', 'Grammar', 'easy',             'Which word is a noun?',                                         '["Run","Beautiful","Dog","Quickly"]'::jsonb, 2, 'A dog is a person, place or thing \u2014 a noun.', 'seed'),
  (NULL, 'English', 'Vocabulary', 'medium',        'Choose the antonym of "ancient".',                             '["Modern","Old","Antique","Historic"]'::jsonb, 0, 'Modern is the opposite of ancient.', 'seed'),
  (NULL, 'English', 'Grammar', 'medium',           'Identify the verb: "She sings beautifully."',                  '["sings","She","beautifully","none"]'::jsonb, 0, '"Sings" is the action word.', 'seed'),
  -- Computer Science
  (NULL, 'Computer Science', 'Fundamentals', 'easy', 'What does CPU stand for?',                                   '["Central Processing Unit","Central Print Unit","Computer Personal Unit","Control Process Unit"]'::jsonb, 0, 'CPU = Central Processing Unit.', 'seed'),
  (NULL, 'Computer Science', 'Fundamentals', 'easy', 'Which of these is an input device?',                         '["Keyboard","Monitor","Printer","Speaker"]'::jsonb, 0, 'A keyboard inputs data.', 'seed'),
  (NULL, 'Computer Science', 'Number Systems', 'easy', 'The binary number system uses the digits:',               '["0 and 1","0 to 9","1 and 2","0 to 7"]'::jsonb, 0, 'Binary is base-2: 0 and 1.', 'seed'),
  (NULL, 'Computer Science', 'Web', 'medium',      'HTML is primarily used to:',                                   '["Structure web pages","Style web pages","Manage databases","Run an operating system"]'::jsonb, 0, 'HTML structures content; CSS styles it.', 'seed'),
  -- Social Studies / General Knowledge
  (NULL, 'Social Studies', 'Civics', 'easy',       'What is the capital of India?',                                '["New Delhi","Mumbai","Kolkata","Chennai"]'::jsonb, 0, 'New Delhi is the capital of India.', 'seed'),
  (NULL, 'Social Studies', 'History', 'easy',      'Who was the first Prime Minister of India?',                   '["Jawaharlal Nehru","Mahatma Gandhi","Sardar Patel","Subhas Chandra Bose"]'::jsonb, 0, 'Nehru was independent India''s first PM.', 'seed'),
  (NULL, 'Social Studies', 'Geography', 'easy',    'How many continents are there on Earth?',                      '["7","5","6","8"]'::jsonb, 0, 'There are 7 continents.', 'seed'),
  (NULL, 'General Knowledge', 'Science', 'easy',   'Which is the largest planet in our solar system?',             '["Jupiter","Saturn","Earth","Mars"]'::jsonb, 0, 'Jupiter is the largest planet.', 'seed'),
  (NULL, 'General Knowledge', 'Geography', 'medium','The Great Barrier Reef is located off the coast of:',         '["Australia","India","USA","Brazil"]'::jsonb, 0, 'It lies off Queensland, Australia.', 'seed'),
  -- Commerce stream
  (12, 'Economics', 'Macroeconomics', 'medium',    'GDP stands for:',                                              '["Gross Domestic Product","Gross Demand Product","General Domestic Price","Gross Domestic Price"]'::jsonb, 0, 'GDP = Gross Domestic Product.', 'seed'),
  (11, 'Accountancy', 'Fundamentals', 'medium',    'The accounting equation is: Assets = Liabilities + ___',       '["Capital","Revenue","Expenses","Drawings"]'::jsonb, 0, 'Assets = Liabilities + Capital (Owner''s equity).', 'seed'),
  (11, 'Accountancy', 'Fundamentals', 'easy',      'Which of the following is a current asset?',                   '["Cash","Building","Machinery","Land"]'::jsonb, 0, 'Cash is a current asset.', 'seed'),
  (11, 'Business Studies', 'Nature of Business', 'easy', 'The primary objective of any business is to earn:',       '["Profit","Loss","Goodwill only","Taxes"]'::jsonb, 0, 'Earning profit is a core business objective.', 'seed'),
  -- Science (combined, for class 9/10 generic battles)
  (9,  'Science', 'Mixtures', 'easy',              'Which of the following is a mixture?',                          '["Air","Water","Oxygen","Gold"]'::jsonb, 0, 'Air is a mixture of gases.', 'seed'),
  (10, 'Science', 'Periodic Classification', 'easy','The most abundant gas in Earth''s atmosphere is:',            '["Nitrogen","Oxygen","Carbon dioxide","Hydrogen"]'::jsonb, 0, 'Nitrogen is ~78% of the atmosphere.', 'seed');
END IF;
END $seed$;
\n\n-- ========== 20260604010000_leaderboard_rpc.sql ==========\n\n-- =========================================================
-- Wisdom Campus — Phase 2: Leaderboard ecosystem RPC
-- A single SECURITY DEFINER reader so students can see
-- class- and school-wide competitive rankings (XP, wins,
-- streaks, weekly/monthly battle score, subject boards)
-- without exposing anything beyond names + scores.
-- =========================================================

CREATE OR REPLACE FUNCTION public.rpc_leaderboard(
  _scope    text DEFAULT 'class',     -- 'class' | 'school'
  _category text DEFAULT 'xp',        -- 'xp'|'wins'|'streak'|'weekly'|'monthly'|'subject'
  _subject  text DEFAULT NULL,
  _limit    int  DEFAULT 50
)
RETURNS TABLE (
  user_id        uuid,
  full_name      text,
  roll_number    text,
  class_label    text,
  score          numeric,
  detail         text,
  equipped_badge text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cls uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cls := public.student_class_id(auth.uid());

  RETURN QUERY
  WITH base AS (
    SELECT s.user_id AS uid, s.full_name, s.roll_number,
           COALESCE(c.name || '-' || c.section, 'Unassigned') AS class_label
    FROM public.students s
    LEFT JOIN public.classes c ON c.id = s.class_id
    WHERE s.user_id IS NOT NULL
      AND (_scope = 'school' OR s.class_id = _cls)
  ),
  scored AS (
    SELECT
      b.uid, b.full_name, b.roll_number, b.class_label,
      CASE _category
        WHEN 'xp'      THEN COALESCE(x.xp, 0)::numeric
        WHEN 'wins'    THEN COALESCE(x.wins, 0)::numeric
        WHEN 'streak'  THEN COALESCE(x.current_streak, 0)::numeric
        WHEN 'weekly'  THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('week', now())), 0)::numeric
        WHEN 'monthly' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('month', now())), 0)::numeric
        WHEN 'subject' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       JOIN public.battles bt ON bt.id = bp.battle_id
                                       WHERE bp.user_id = b.uid AND _subject IS NOT NULL
                                         AND lower(bt.subject) = lower(_subject)), 0)::numeric
        ELSE COALESCE(x.xp, 0)::numeric
      END AS score,
      CASE _category
        WHEN 'xp'     THEN 'Lvl ' || COALESCE(x.level,1) || ' · ' || COALESCE(x.wins,0) || ' wins'
        WHEN 'wins'   THEN COALESCE(x.total_battles,0) || ' battles'
        WHEN 'streak' THEN COALESCE(x.current_streak,0) || '-day streak'
        ELSE NULL
      END AS detail,
      x.equipped_badge AS equipped_badge
    FROM base b
    LEFT JOIN public.student_xp x ON x.user_id = b.uid
  )
  SELECT s.uid, s.full_name, s.roll_number, s.class_label, s.score, s.detail, s.equipped_badge
  FROM scored s
  ORDER BY s.score DESC, s.full_name ASC
  LIMIT GREATEST(_limit, 1);
END $$;
\n\n-- ========== 20260604030000_student_panel_fixes.sql ==========\n\n-- =========================================================
-- Wisdom Campus — Student panel completeness fixes
--   * rpc_classmates(): safe peer list (RLS blocks direct reads)
--   * rpc_leaderboard(): add academic categories (marks/
--     attendance/homework/dpp) so class boards work for all
--   * class_timetables: shared DB timetable (was localStorage)
-- =========================================================

-- ---------------------------------------------------------
-- 1) Classmates reader (SECURITY DEFINER)
--    Students cannot read peers' `students` / `student_xp`
--    rows directly. This returns only public, leaderboard-
--    style fields for classmates of the caller.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_classmates()
RETURNS TABLE (
  user_id        uuid,
  student_id     uuid,
  full_name      text,
  roll_number    text,
  equipped_badge text,
  xp             int,
  level          int,
  wins           int,
  current_streak int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.user_id, s.id, s.full_name, s.roll_number, x.equipped_badge,
         COALESCE(x.xp, 0), COALESCE(x.level, 1), COALESCE(x.wins, 0), COALESCE(x.current_streak, 0)
  FROM public.students s
  LEFT JOIN public.student_xp x ON x.user_id = s.user_id
  WHERE s.class_id = public.student_class_id(auth.uid())
    AND s.user_id IS NOT NULL
    AND s.user_id <> auth.uid()
  ORDER BY s.full_name;
$$;

-- ---------------------------------------------------------
-- 2) Leaderboard RPC — now also covers academic categories.
--    (marks/attendance/homework/dpp). Class or school scope.
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_leaderboard(
  _scope    text DEFAULT 'class',
  _category text DEFAULT 'xp',
  _subject  text DEFAULT NULL,
  _limit    int  DEFAULT 50
)
RETURNS TABLE (
  user_id        uuid,
  full_name      text,
  roll_number    text,
  class_label    text,
  score          numeric,
  detail         text,
  equipped_badge text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cls uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cls := public.student_class_id(auth.uid());

  RETURN QUERY
  WITH base AS (
    SELECT s.user_id AS uid, s.id AS sid, s.class_id AS cid, s.full_name, s.roll_number,
           COALESCE(c.name || '-' || c.section, 'Unassigned') AS class_label
    FROM public.students s
    LEFT JOIN public.classes c ON c.id = s.class_id
    WHERE s.user_id IS NOT NULL
      AND (_scope = 'school' OR s.class_id = _cls)
  ),
  scored AS (
    SELECT
      b.uid, b.full_name, b.roll_number, b.class_label,
      CASE _category
        WHEN 'xp'      THEN COALESCE(x.xp, 0)::numeric
        WHEN 'wins'    THEN COALESCE(x.wins, 0)::numeric
        WHEN 'streak'  THEN COALESCE(x.current_streak, 0)::numeric
        WHEN 'weekly'  THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('week', now())), 0)::numeric
        WHEN 'monthly' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('month', now())), 0)::numeric
        WHEN 'subject' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       JOIN public.battles bt ON bt.id = bp.battle_id
                                       WHERE bp.user_id = b.uid AND _subject IS NOT NULL
                                         AND lower(bt.subject) = lower(_subject)), 0)::numeric
        WHEN 'marks' THEN COALESCE((
            SELECT CASE WHEN SUM(e.max_marks) > 0
                        THEN ROUND(SUM(m.marks_obtained)::numeric / SUM(e.max_marks) * 100, 1) ELSE 0 END
            FROM public.marks m JOIN public.exams e ON e.id = m.exam_id
            WHERE m.student_id = b.sid), 0)::numeric
        WHEN 'attendance' THEN COALESCE((
            SELECT CASE WHEN COUNT(*) > 0
                        THEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(*) * 100, 0) ELSE 0 END
            FROM public.attendance a WHERE a.student_id = b.sid), 0)::numeric
        WHEN 'homework' THEN COALESCE((
            SELECT CASE WHEN (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) > 0
                        THEN ROUND(
                          (SELECT COUNT(*) FROM public.homework_submissions hs
                             JOIN public.homework h2 ON h2.id = hs.homework_id
                             WHERE hs.student_id = b.sid AND hs.status IN ('submitted','graded') AND h2.class_id = b.cid)::numeric
                          / (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) * 100, 0)
                        ELSE 0 END), 0)::numeric
        WHEN 'dpp' THEN COALESCE((
            SELECT ROUND(AVG(best), 0) FROM (
              SELECT MAX(CASE WHEN da.max_score > 0 THEN da.score::numeric / da.max_score * 100 ELSE 0 END) AS best
              FROM public.dpp_attempts da JOIN public.dpps dp ON dp.id = da.dpp_id
              WHERE da.user_id = b.uid AND da.status = 'submitted' AND dp.is_published
              GROUP BY da.dpp_id) t), 0)::numeric
        ELSE COALESCE(x.xp, 0)::numeric
      END AS score,
      CASE _category
        WHEN 'xp'     THEN 'Lvl ' || COALESCE(x.level,1) || ' · ' || COALESCE(x.wins,0) || ' wins'
        WHEN 'wins'   THEN COALESCE(x.total_battles,0) || ' battles'
        WHEN 'streak' THEN COALESCE(x.current_streak,0) || '-day streak'
        ELSE NULL
      END AS detail,
      x.equipped_badge AS equipped_badge
    FROM base b
    LEFT JOIN public.student_xp x ON x.user_id = b.uid
  )
  SELECT s.uid, s.full_name, s.roll_number, s.class_label, s.score, s.detail, s.equipped_badge
  FROM scored s
  ORDER BY s.score DESC, s.full_name ASC
  LIMIT GREATEST(_limit, 1);
END $$;

-- ---------------------------------------------------------
-- 3) Shared timetable (replaces per-browser localStorage)
--    grid keeps the same shape: { "Mon-1": "Maths", ... }
-- ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.class_timetables (
  class_id   uuid PRIMARY KEY REFERENCES public.classes(id) ON DELETE CASCADE,
  grid       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.class_timetables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timetable read"  ON public.class_timetables;
DROP POLICY IF EXISTS "timetable write" ON public.class_timetables;
-- Timetables are not sensitive: any authenticated user may read.
CREATE POLICY "timetable read" ON public.class_timetables
  FOR SELECT TO authenticated USING (true);
-- Admins/principals manage any; class teachers manage their own class.
CREATE POLICY "timetable write" ON public.class_timetables
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal')
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal')
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_id)
  );
\n\n-- ========== 20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql ==========\n\n-- Combined pending migrations
ALTER TABLE public.battle_questions
  ADD COLUMN IF NOT EXISTS bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS public.student_question_history (
  user_id      uuid NOT NULL,
  question_id  uuid NOT NULL REFERENCES public.question_bank(id) ON DELETE CASCADE,
  times_seen   int  NOT NULL DEFAULT 1,
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_sqh_user ON public.student_question_history(user_id, last_seen_at DESC);
GRANT SELECT ON public.student_question_history TO authenticated;
GRANT ALL ON public.student_question_history TO service_role;
ALTER TABLE public.student_question_history ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "sqh self read" ON public.student_question_history;
CREATE POLICY "sqh self read" ON public.student_question_history
  FOR SELECT TO authenticated USING (user_id = auth.uid());

ALTER TABLE public.student_xp
  ADD COLUMN IF NOT EXISTS best_score      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_correct   int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS total_answered  int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS win_streak      int NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS best_win_streak int NOT NULL DEFAULT 0;

CREATE OR REPLACE FUNCTION public._award_badge(_uid uuid, _code text, _tier public.badge_tier DEFAULT 'bronze')
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.student_badges(user_id, badge_code, tier)
  VALUES (_uid, _code, _tier)
  ON CONFLICT (user_id, badge_code) DO NOTHING;
$$;

CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count int DEFAULT 5)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher') THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0)                     AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC,
      random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET source = 'bank', question_count = _inserted, duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _battle uuid; _score int; _correct int; _answered int; _time int;
  _won boolean := false; _max_score int; _xp record; _avg_ms numeric; _hour int;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms
    INTO _user, _battle, _score, _correct, _answered, _time
    FROM public.battle_participants WHERE id = _participant_id;
  IF _user IS NULL OR _user <> auth.uid() THEN RAISE EXCEPTION 'Not your participation'; END IF;

  UPDATE public.battle_participants SET finished_at = COALESCE(finished_at, now()) WHERE id = _participant_id;

  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  SELECT MAX(score) INTO _max_score FROM public.battle_participants WHERE battle_id = _battle;
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
    updated_at      = now();

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
END $$;

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

  RETURN _bid;
END $$;

DO $seed$
BEGIN
IF (SELECT count(*) FROM public.question_bank) < 20 THEN
  INSERT INTO public.question_bank (class_level, subject, chapter, difficulty, question, options, correct_index, explanation, source) VALUES
  (9,  'Mathematics', 'Number Systems', 'easy',   'Which of the following is a rational number?',                 '["0.75","\u221a2","\u03c0","\u221a3"]'::jsonb, 0, '0.75 = 3/4, a ratio of integers.', 'seed'),
  (9,  'Mathematics', 'Triangles', 'easy',         'The sum of the interior angles of a triangle is:',            '["90\u00b0","180\u00b0","270\u00b0","360\u00b0"]'::jsonb, 1, 'Angle sum property of a triangle.', 'seed'),
  (9,  'Mathematics', 'Mensuration', 'medium',     'The area of a circle of radius r is:',                         '["2\u03c0r","\u03c0r\u00b2","\u03c0d","2\u03c0r\u00b2"]'::jsonb, 1, 'Area = \u03c0r\u00b2.', 'seed'),
  (10, 'Mathematics', 'Quadratic Equations', 'medium', 'The discriminant of ax\u00b2 + bx + c = 0 is:',            '["b\u00b2 \u2212 4ac","2a","\u2212b/2a","b\u00b2 + 4ac"]'::jsonb, 0, 'Discriminant D = b\u00b2 \u2212 4ac.', 'seed'),
  (10, 'Mathematics', 'Real Numbers', 'easy',      'The HCF of 12 and 18 is:',                                     '["6","12","3","9"]'::jsonb, 0, '12 = 2\u00b2\u00d73, 18 = 2\u00d73\u00b2, HCF = 2\u00d73 = 6.', 'seed'),
  (10, 'Mathematics', 'Trigonometry', 'medium',    'The value of sin 30\u00b0 is:',                                '["1/2","\u221a3/2","1","0"]'::jsonb, 0, 'sin 30\u00b0 = 1/2.', 'seed'),
  (11, 'Mathematics', 'Calculus', 'medium',        'The derivative of x\u00b2 with respect to x is:',              '["2x","x","x\u00b2/2","2"]'::jsonb, 0, 'd/dx(x\u00b2) = 2x.', 'seed'),
  (11, 'Mathematics', 'Logarithms', 'easy',        'The value of log\u2081\u2080(1) is:',                          '["1","0","10","Undefined"]'::jsonb, 1, 'log of 1 to any base is 0.', 'seed'),
  (12, 'Mathematics', 'Integration', 'medium',     'The value of \u222b 1 dx is:',                                 '["x + C","1","0","x\u00b2"]'::jsonb, 0, 'Integral of 1 is x + C.', 'seed'),
  (12, 'Mathematics', 'Exponentials', 'easy',      'The value of e\u2070 is:',                                     '["0","1","e","\u221e"]'::jsonb, 1, 'Any non-zero number to the power 0 is 1.', 'seed'),
  (9,  'Physics', 'Force and Laws of Motion', 'easy', 'The SI unit of force is:',                                  '["Newton","Joule","Watt","Pascal"]'::jsonb, 0, 'Force is measured in newtons (N).', 'seed'),
  (9,  'Physics', 'Gravitation', 'easy',           'The acceleration due to gravity on Earth is approximately:',   '["9.8 m/s\u00b2","8.9 m/s\u00b2","10.8 m/s\u00b2","6.7 m/s\u00b2"]'::jsonb, 0, 'g \u2248 9.8 m/s\u00b2.', 'seed'),
  (10, 'Physics', 'Electricity', 'medium',         'Ohm''s law is expressed as:',                                  '["V = IR","V = I/R","V = R/I","V = I + R"]'::jsonb, 0, 'Voltage = Current \u00d7 Resistance.', 'seed'),
  (10, 'Physics', 'Electricity', 'easy',           'The SI unit of electric current is:',                          '["Ampere","Volt","Ohm","Watt"]'::jsonb, 0, 'Current is measured in amperes (A).', 'seed'),
  (11, 'Physics', 'Units and Measurement', 'medium','Which of the following is a vector quantity?',                '["Speed","Mass","Velocity","Time"]'::jsonb, 2, 'Velocity has both magnitude and direction.', 'seed'),
  (11, 'Physics', 'Work, Energy and Power', 'easy', 'The SI unit of work is:',                                     '["Joule","Newton","Watt","Pascal"]'::jsonb, 0, 'Work is measured in joules (J).', 'seed'),
  (12, 'Physics', 'Electrostatics', 'medium',      'The SI unit of capacitance is:',                               '["Farad","Henry","Tesla","Weber"]'::jsonb, 0, 'Capacitance is measured in farads (F).', 'seed'),
  (9,  'Chemistry', 'Atoms and Molecules', 'easy', 'The chemical symbol for sodium is:',                           '["Na","S","So","Sd"]'::jsonb, 0, 'Sodium = Na (from Latin natrium).', 'seed'),
  (9,  'Chemistry', 'Matter', 'easy',              'Water is made up of hydrogen and:',                            '["Oxygen","Nitrogen","Carbon","Helium"]'::jsonb, 0, 'Water is H\u2082O.', 'seed'),
  (10, 'Chemistry', 'Acids, Bases and Salts', 'easy', 'The pH of a neutral solution is:',                         '["7","0","14","1"]'::jsonb, 0, 'Neutral pH = 7.', 'seed'),
  (10, 'Chemistry', 'Acids, Bases and Salts', 'easy', 'The chemical formula of common salt is:',                  '["NaCl","KCl","HCl","NaOH"]'::jsonb, 0, 'Common salt is sodium chloride, NaCl.', 'seed'),
  (11, 'Chemistry', 'Structure of Atom', 'easy',   'The atomic number of carbon is:',                              '["6","12","8","14"]'::jsonb, 0, 'Carbon has 6 protons.', 'seed'),
  (11, 'Chemistry', 'Periodic Table', 'medium',    'The most electronegative element is:',                         '["Fluorine","Oxygen","Chlorine","Nitrogen"]'::jsonb, 0, 'Fluorine is the most electronegative.', 'seed'),
  (12, 'Chemistry', 'p-Block Elements', 'medium',  'Which gas is commonly known as laughing gas?',                 '["Nitrous oxide (N\u2082O)","Carbon dioxide","Oxygen","Nitrogen dioxide"]'::jsonb, 0, 'N\u2082O is laughing gas.', 'seed'),
  (9,  'Biology', 'The Fundamental Unit of Life', 'easy', 'The basic structural unit of life is the:',             '["Cell","Atom","Tissue","Organ"]'::jsonb, 0, 'The cell is the basic unit of life.', 'seed'),
  (9,  'Biology', 'The Fundamental Unit of Life', 'easy', 'The "powerhouse of the cell" is the:',                  '["Mitochondria","Nucleus","Ribosome","Golgi body"]'::jsonb, 0, 'Mitochondria produce ATP.', 'seed'),
  (10, 'Biology', 'Life Processes', 'easy',        'Which organ pumps blood throughout the body?',                 '["Heart","Liver","Lungs","Kidney"]'::jsonb, 0, 'The heart pumps blood.', 'seed'),
  (10, 'Biology', 'Life Processes', 'easy',        'The green pigment in plants responsible for photosynthesis is:', '["Chlorophyll","Hemoglobin","Carotene","Melanin"]'::jsonb, 0, 'Chlorophyll captures light energy.', 'seed'),
  (11, 'Biology', 'Human Physiology', 'easy',      'How many chambers does the human heart have?',                 '["4","2","3","1"]'::jsonb, 0, 'Two atria and two ventricles.', 'seed'),
  (12, 'Biology', 'Molecular Basis of Inheritance', 'medium', 'DNA stands for:',                                   '["Deoxyribonucleic acid","Dinucleic acid","Deoxyribose acid","Diribonucleic acid"]'::jsonb, 0, 'DNA = Deoxyribonucleic acid.', 'seed'),
  (NULL, 'English', 'Vocabulary', 'easy',          'Choose the correct synonym of "happy".',                       '["Joyful","Sad","Angry","Tired"]'::jsonb, 0, 'Joyful means happy.', 'seed'),
  (NULL, 'English', 'Grammar', 'easy',             'The plural of "child" is:',                                    '["Children","Childs","Childes","Child"]'::jsonb, 0, 'Irregular plural: children.', 'seed'),
  (NULL, 'English', 'Grammar', 'easy',             'Which word is a noun?',                                         '["Run","Beautiful","Dog","Quickly"]'::jsonb, 2, 'A dog is a person, place or thing \u2014 a noun.', 'seed'),
  (NULL, 'English', 'Vocabulary', 'medium',        'Choose the antonym of "ancient".',                             '["Modern","Old","Antique","Historic"]'::jsonb, 0, 'Modern is the opposite of ancient.', 'seed'),
  (NULL, 'English', 'Grammar', 'medium',           'Identify the verb: "She sings beautifully."',                  '["sings","She","beautifully","none"]'::jsonb, 0, '"Sings" is the action word.', 'seed'),
  (NULL, 'Computer Science', 'Fundamentals', 'easy', 'What does CPU stand for?',                                   '["Central Processing Unit","Central Print Unit","Computer Personal Unit","Control Process Unit"]'::jsonb, 0, 'CPU = Central Processing Unit.', 'seed'),
  (NULL, 'Computer Science', 'Fundamentals', 'easy', 'Which of these is an input device?',                         '["Keyboard","Monitor","Printer","Speaker"]'::jsonb, 0, 'A keyboard inputs data.', 'seed'),
  (NULL, 'Computer Science', 'Number Systems', 'easy', 'The binary number system uses the digits:',               '["0 and 1","0 to 9","1 and 2","0 to 7"]'::jsonb, 0, 'Binary is base-2: 0 and 1.', 'seed'),
  (NULL, 'Computer Science', 'Web', 'medium',      'HTML is primarily used to:',                                   '["Structure web pages","Style web pages","Manage databases","Run an operating system"]'::jsonb, 0, 'HTML structures content; CSS styles it.', 'seed'),
  (NULL, 'Social Studies', 'Civics', 'easy',       'What is the capital of India?',                                '["New Delhi","Mumbai","Kolkata","Chennai"]'::jsonb, 0, 'New Delhi is the capital of India.', 'seed'),
  (NULL, 'Social Studies', 'History', 'easy',      'Who was the first Prime Minister of India?',                   '["Jawaharlal Nehru","Mahatma Gandhi","Sardar Patel","Subhas Chandra Bose"]'::jsonb, 0, 'Nehru was independent India''s first PM.', 'seed'),
  (NULL, 'Social Studies', 'Geography', 'easy',    'How many continents are there on Earth?',                      '["7","5","6","8"]'::jsonb, 0, 'There are 7 continents.', 'seed'),
  (NULL, 'General Knowledge', 'Science', 'easy',   'Which is the largest planet in our solar system?',             '["Jupiter","Saturn","Earth","Mars"]'::jsonb, 0, 'Jupiter is the largest planet.', 'seed'),
  (NULL, 'General Knowledge', 'Geography', 'medium','The Great Barrier Reef is located off the coast of:',         '["Australia","India","USA","Brazil"]'::jsonb, 0, 'It lies off Queensland, Australia.', 'seed'),
  (12, 'Economics', 'Macroeconomics', 'medium',    'GDP stands for:',                                              '["Gross Domestic Product","Gross Demand Product","General Domestic Price","Gross Domestic Price"]'::jsonb, 0, 'GDP = Gross Domestic Product.', 'seed'),
  (11, 'Accountancy', 'Fundamentals', 'medium',    'The accounting equation is: Assets = Liabilities + ___',       '["Capital","Revenue","Expenses","Drawings"]'::jsonb, 0, 'Assets = Liabilities + Capital (Owner''s equity).', 'seed'),
  (11, 'Accountancy', 'Fundamentals', 'easy',      'Which of the following is a current asset?',                   '["Cash","Building","Machinery","Land"]'::jsonb, 0, 'Cash is a current asset.', 'seed'),
  (11, 'Business Studies', 'Nature of Business', 'easy', 'The primary objective of any business is to earn:',       '["Profit","Loss","Goodwill only","Taxes"]'::jsonb, 0, 'Earning profit is a core business objective.', 'seed'),
  (9,  'Science', 'Mixtures', 'easy',              'Which of the following is a mixture?',                          '["Air","Water","Oxygen","Gold"]'::jsonb, 0, 'Air is a mixture of gases.', 'seed'),
  (10, 'Science', 'Periodic Classification', 'easy','The most abundant gas in Earth''s atmosphere is:',            '["Nitrogen","Oxygen","Carbon dioxide","Hydrogen"]'::jsonb, 0, 'Nitrogen is ~78% of the atmosphere.', 'seed');
END IF;
END $seed$;

CREATE OR REPLACE FUNCTION public.rpc_leaderboard(
  _scope    text DEFAULT 'class',
  _category text DEFAULT 'xp',
  _subject  text DEFAULT NULL,
  _limit    int  DEFAULT 50
)
RETURNS TABLE (
  user_id        uuid,
  full_name      text,
  roll_number    text,
  class_label    text,
  score          numeric,
  detail         text,
  equipped_badge text
)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cls uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cls := public.student_class_id(auth.uid());

  RETURN QUERY
  WITH base AS (
    SELECT s.user_id AS uid, s.id AS sid, s.class_id AS cid, s.full_name, s.roll_number,
           COALESCE(c.name || '-' || c.section, 'Unassigned') AS class_label
    FROM public.students s
    LEFT JOIN public.classes c ON c.id = s.class_id
    WHERE s.user_id IS NOT NULL
      AND (_scope = 'school' OR s.class_id = _cls)
  ),
  scored AS (
    SELECT
      b.uid, b.full_name, b.roll_number, b.class_label,
      CASE _category
        WHEN 'xp'      THEN COALESCE(x.xp, 0)::numeric
        WHEN 'wins'    THEN COALESCE(x.wins, 0)::numeric
        WHEN 'streak'  THEN COALESCE(x.current_streak, 0)::numeric
        WHEN 'weekly'  THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('week', now())), 0)::numeric
        WHEN 'monthly' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       WHERE bp.user_id = b.uid AND bp.joined_at >= date_trunc('month', now())), 0)::numeric
        WHEN 'subject' THEN COALESCE((SELECT SUM(bp.score) FROM public.battle_participants bp
                                       JOIN public.battles bt ON bt.id = bp.battle_id
                                       WHERE bp.user_id = b.uid AND _subject IS NOT NULL
                                         AND lower(bt.subject) = lower(_subject)), 0)::numeric
        WHEN 'marks' THEN COALESCE((
            SELECT CASE WHEN SUM(e.max_marks) > 0
                        THEN ROUND(SUM(m.marks_obtained)::numeric / SUM(e.max_marks) * 100, 1) ELSE 0 END
            FROM public.marks m JOIN public.exams e ON e.id = m.exam_id
            WHERE m.student_id = b.sid), 0)::numeric
        WHEN 'attendance' THEN COALESCE((
            SELECT CASE WHEN COUNT(*) > 0
                        THEN ROUND(COUNT(*) FILTER (WHERE a.status = 'present')::numeric / COUNT(*) * 100, 0) ELSE 0 END
            FROM public.attendance a WHERE a.student_id = b.sid), 0)::numeric
        WHEN 'homework' THEN COALESCE((
            SELECT CASE WHEN (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) > 0
                        THEN ROUND(
                          (SELECT COUNT(*) FROM public.homework_submissions hs
                             JOIN public.homework h2 ON h2.id = hs.homework_id
                             WHERE hs.student_id = b.sid AND hs.status IN ('submitted','graded') AND h2.class_id = b.cid)::numeric
                          / (SELECT COUNT(*) FROM public.homework h WHERE h.class_id = b.cid) * 100, 0)
                        ELSE 0 END), 0)::numeric
        WHEN 'dpp' THEN COALESCE((
            SELECT ROUND(AVG(best), 0) FROM (
              SELECT MAX(CASE WHEN da.max_score > 0 THEN da.score::numeric / da.max_score * 100 ELSE 0 END) AS best
              FROM public.dpp_attempts da JOIN public.dpps dp ON dp.id = da.dpp_id
              WHERE da.user_id = b.uid AND da.status = 'submitted' AND dp.is_published
              GROUP BY da.dpp_id) t), 0)::numeric
        ELSE COALESCE(x.xp, 0)::numeric
      END AS score,
      CASE _category
        WHEN 'xp'     THEN 'Lvl ' || COALESCE(x.level,1) || ' · ' || COALESCE(x.wins,0) || ' wins'
        WHEN 'wins'   THEN COALESCE(x.total_battles,0) || ' battles'
        WHEN 'streak' THEN COALESCE(x.current_streak,0) || '-day streak'
        ELSE NULL
      END AS detail,
      x.equipped_badge AS equipped_badge
    FROM base b
    LEFT JOIN public.student_xp x ON x.user_id = b.uid
  )
  SELECT s.uid, s.full_name, s.roll_number, s.class_label, s.score, s.detail, s.equipped_badge
  FROM scored s
  ORDER BY s.score DESC, s.full_name ASC
  LIMIT GREATEST(_limit, 1);
END $$;

CREATE TABLE IF NOT EXISTS public.notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  type       text NOT NULL DEFAULT 'general',
  title      text NOT NULL,
  body       text,
  icon       text,
  link       text,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_notif_user ON public.notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notif_unread ON public.notifications(user_id) WHERE NOT read;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.notifications TO authenticated;
GRANT ALL ON public.notifications TO service_role;

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notif self read"   ON public.notifications;
DROP POLICY IF EXISTS "notif self insert" ON public.notifications;
DROP POLICY IF EXISTS "notif self update" ON public.notifications;
DROP POLICY IF EXISTS "notif self delete" ON public.notifications;
CREATE POLICY "notif self read"   ON public.notifications FOR SELECT TO authenticated USING (user_id = auth.uid());
CREATE POLICY "notif self insert" ON public.notifications FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif self update" ON public.notifications FOR UPDATE TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
CREATE POLICY "notif self delete" ON public.notifications FOR DELETE TO authenticated USING (user_id = auth.uid());

CREATE OR REPLACE FUNCTION public._notify(
  _uid uuid, _type text, _title text, _body text DEFAULT NULL,
  _icon text DEFAULT NULL, _link text DEFAULT NULL
) RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.notifications(user_id, type, title, body, icon, link)
  VALUES (_uid, _type, _title, _body, _icon, _link);
$$;

CREATE OR REPLACE FUNCTION public._award_badge(_uid uuid, _code text, _tier public.badge_tier DEFAULT 'bronze')
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.student_badges(user_id, badge_code, tier)
  VALUES (_uid, _code, _tier)
  ON CONFLICT (user_id, badge_code) DO NOTHING;
  IF FOUND THEN
    PERFORM public._notify(
      _uid, 'badge', 'Badge unlocked!',
      'You earned a new ' || _tier || ' badge.', 'award',
      '/student/battleground/achievements'
    );
  END IF;
END $$;

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

  PERFORM public._notify(
    _opponent_user_id, 'invite', 'Battle challenge!',
    _name || ' challenged you to a ' || _subject || ' battle.', 'swords',
    '/student/battleground/battle/' || _bid::text
  );

  RETURN _bid;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname='supabase_realtime' AND schemaname='public' AND tablename='notifications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications';
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_classmates()
RETURNS TABLE (
  user_id        uuid,
  student_id     uuid,
  full_name      text,
  roll_number    text,
  equipped_badge text,
  xp             int,
  level          int,
  wins           int,
  current_streak int
)
LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  SELECT s.user_id, s.id, s.full_name, s.roll_number, x.equipped_badge,
         COALESCE(x.xp, 0), COALESCE(x.level, 1), COALESCE(x.wins, 0), COALESCE(x.current_streak, 0)
  FROM public.students s
  LEFT JOIN public.student_xp x ON x.user_id = s.user_id
  WHERE s.class_id = public.student_class_id(auth.uid())
    AND s.user_id IS NOT NULL
    AND s.user_id <> auth.uid()
  ORDER BY s.full_name;
$$;

CREATE TABLE IF NOT EXISTS public.class_timetables (
  class_id   uuid PRIMARY KEY REFERENCES public.classes(id) ON DELETE CASCADE,
  grid       jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_by uuid,
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.class_timetables TO authenticated;
GRANT ALL ON public.class_timetables TO service_role;
ALTER TABLE public.class_timetables ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "timetable read"  ON public.class_timetables;
DROP POLICY IF EXISTS "timetable write" ON public.class_timetables;
CREATE POLICY "timetable read" ON public.class_timetables
  FOR SELECT TO authenticated USING (true);
CREATE POLICY "timetable write" ON public.class_timetables
  FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal')
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_id)
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin') OR public.has_role(auth.uid(),'principal')
    OR EXISTS (SELECT 1 FROM public.teachers t WHERE t.user_id = auth.uid() AND t.class_teacher_of = class_id)
  );

CREATE TABLE IF NOT EXISTS public.app_settings (
  id              boolean PRIMARY KEY DEFAULT true,
  school_name     text    NOT NULL DEFAULT 'Vidyalaya Public School',
  locale          text    NOT NULL DEFAULT 'en-IN',
  currency        text    NOT NULL DEFAULT 'INR',
  enable_notices  boolean NOT NULL DEFAULT true,
  enable_fees     boolean NOT NULL DEFAULT true,
  enable_leaves   boolean NOT NULL DEFAULT true,
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid,
  CONSTRAINT app_settings_singleton CHECK (id)
);
GRANT SELECT, INSERT, UPDATE ON public.app_settings TO authenticated;
GRANT ALL ON public.app_settings TO service_role;

INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "app settings read" ON public.app_settings;
CREATE POLICY "app settings read" ON public.app_settings
  FOR SELECT TO authenticated
  USING (true);

DROP POLICY IF EXISTS "app settings write" ON public.app_settings;
CREATE POLICY "app settings write" ON public.app_settings
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin'))
  WITH CHECK (public.has_role(auth.uid(), 'admin'));
\n\n-- ========== 20260604070000_battleground_feed_ai.sql ==========\n\n-- =========================================================
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
\n\n-- ========== 20260604080000_battle_monitor.sql ==========\n\n-- =========================================================
-- Battleground v2 — Live teacher monitoring
--   rpc_battle_monitor: SECURITY DEFINER aggregate of a battle's
--   live state (per-student + per-question), authorized to the
--   host / class teacher / principal / admin. Teachers cannot read
--   battle_answers directly (self-only RLS), so this RPC bridges it.
-- =========================================================

CREATE OR REPLACE FUNCTION public.rpc_battle_monitor(_battle_id uuid)
RETURNS jsonb LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b record; _uid uuid := auth.uid(); _result jsonb; _allowed boolean;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;

  _allowed := _b.creator_user_id = _uid
    OR public.has_role(_uid, 'admin'::app_role)
    OR public.has_role(_uid, 'principal'::app_role)
    OR (_b.class_id IS NOT NULL AND public.teacher_teaches_class(_uid, _b.class_id));
  IF NOT _allowed THEN RAISE EXCEPTION 'Not authorized to monitor this battle'; END IF;

  SELECT jsonb_build_object(
    'battle', jsonb_build_object(
      'id', _b.id, 'title', _b.title, 'subject', _b.subject, 'topic', _b.topic,
      'status', _b.status, 'question_count', _b.question_count,
      'per_question_sec', _b.per_question_sec, 'duration_sec', _b.duration_sec,
      'starts_at', _b.starts_at
    ),
    'participants', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'user_id', p.user_id,
        'display_name', p.display_name,
        'score', p.score,
        'correct_count', p.correct_count,
        'answered_count', p.answered_count,
        'total_time_ms', p.total_time_ms,
        'rank', p.rank,
        'finished', (p.finished_at IS NOT NULL),
        'joined_at', p.joined_at,
        'progress_pct', CASE WHEN _b.question_count > 0
                             THEN round(100.0 * p.answered_count / _b.question_count) ELSE 0 END,
        'accuracy', CASE WHEN p.answered_count > 0
                         THEN round(100.0 * p.correct_count / p.answered_count) ELSE NULL END,
        'avg_ms', CASE WHEN p.answered_count > 0
                       THEN round(p.total_time_ms::numeric / p.answered_count) ELSE NULL END,
        'struggling', (p.answered_count >= 2 AND p.correct_count::numeric / p.answered_count < 0.4)
      ) ORDER BY p.score DESC, p.total_time_ms ASC)
      FROM public.battle_participants p WHERE p.battle_id = _battle_id
    ), '[]'::jsonb),
    'questions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'order_index', q.order_index,
        'question', q.question,
        'attempts', COALESCE(s.attempts, 0),
        'correct', COALESCE(s.correct, 0),
        'accuracy', CASE WHEN COALESCE(s.attempts, 0) > 0
                         THEN round(100.0 * s.correct / s.attempts) ELSE NULL END
      ) ORDER BY q.order_index)
      FROM public.battle_questions q
      LEFT JOIN (
        SELECT ba.question_id,
               count(*) AS attempts,
               count(*) FILTER (WHERE ba.is_correct) AS correct
        FROM public.battle_answers ba
        JOIN public.battle_questions bq2 ON bq2.id = ba.question_id
        WHERE bq2.battle_id = _battle_id
        GROUP BY ba.question_id
      ) s ON s.question_id = q.id
      WHERE q.battle_id = _battle_id
    ), '[]'::jsonb)
  ) INTO _result;

  RETURN _result;
END $$;
\n\n-- ========== 20260604090000_battle_reports.sql ==========\n\n-- =========================================================
-- Battleground v3 — Post-battle analytics (24h expiry)
--   * battle_reports: per-participant snapshot + optional AI insights
--   * _snapshot_battle_report: builds structured report on finish
--   * rpc_get_battle_report / rpc_teacher_battle_reports: authorized reads
-- =========================================================

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

-- ---------------------------------------------------------
-- Build + upsert a 24h report snapshot for one participant
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._snapshot_battle_report(_participant_id uuid)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _p record; _b record; _report jsonb; _rid uuid;
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
  _won := (_p.score = _max_score AND _p.score > 0 AND _total > 1)
       OR (_p.score = _max_score AND _p.score > 0 AND _total = 1);

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
      'score', _p.score,
      'rank', _p.rank,
      'total_participants', _total,
      'won', _won,
      'correct_count', _p.correct_count,
      'answered_count', _p.answered_count,
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
        'order_index', bq.order_index,
        'question_id', bq.id,
        'question', bq.question,
        'options', bq.options,
        'correct_index', bq.correct_index,
        'selected_index', ba.selected_index,
        'is_correct', COALESCE(ba.is_correct, false),
        'time_ms', COALESCE(ba.time_ms, 0),
        'skipped', (ba.id IS NULL),
        'chapter', qb.chapter,
        'topic', qb.topic,
        'explanation', qb.explanation
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

-- ---------------------------------------------------------
-- Read one report (student own; teacher host; not expired)
-- ---------------------------------------------------------
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
    'id', _r.id,
    'participant_id', _r.participant_id,
    'battle_id', _r.battle_id,
    'user_id', _r.user_id,
    'display_name', _r.display_name,
    'report', _r.report,
    'ai_insights', _r.ai_insights,
    'expires_at', _r.expires_at,
    'created_at', _r.created_at,
    'expired', false
  );
END $$;

-- ---------------------------------------------------------
-- Teacher: all reports for a battle (incl. expired flag)
-- ---------------------------------------------------------
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

-- ---------------------------------------------------------
-- Patch finish_battle to snapshot report
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
    updated_at      = now();

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

  -- 24h analytics snapshot
  PERFORM public._snapshot_battle_report(_participant_id);
END $$;
\n\n-- ========== 20260604100000_battleground_phase4.sql ==========\n\n-- =========================================================
-- Battleground Phase 4 — Frictionless matchmaking + topic filter
--   * rpc_battle_curriculum: chapters/topics from question bank
--   * rpc_generate_battle: respect battle.topic
--   * rpc_challenge_student / rpc_create_quick_battle: accept _topic
-- =========================================================

CREATE OR REPLACE FUNCTION public.rpc_battle_curriculum(_subject text)
RETURNS jsonb LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'chapter', sub.chapter,
    'topic', sub.topic
  ) ORDER BY sub.chapter, sub.topic), '[]'::jsonb)
  FROM (
    SELECT DISTINCT
      COALESCE(NULLIF(trim(chapter), ''), 'General') AS chapter,
      NULLIF(trim(topic), '') AS topic
    FROM public.question_bank
    WHERE is_approved AND lower(subject) = lower(_subject)
  ) sub;
$$;

CREATE OR REPLACE FUNCTION public.rpc_generate_battle(_battle_id uuid, _count int DEFAULT 5)
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b   record;
  _uid uuid := auth.uid();
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.creator_user_id <> _uid
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher') THEN
    RAISE EXCEPTION 'Not your battle';
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty,
           COALESCE(h.times_seen, 0) AS seen,
           COALESCE(h.last_seen_at, 'epoch'::timestamptz) AS last_seen
    FROM public.question_bank q
    LEFT JOIN public.student_question_history h
      ON h.question_id = q.id AND h.user_id = _uid
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC,
      random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id
    FROM picked
    RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET source = 'bank', question_count = _inserted, duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $$;

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
END $$;

CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _name text;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(auth.uid());
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at)
  VALUES (
    _name || ' challenges you · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'class', 'bank', now()
  ) RETURNING id INTO _bid;

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
\n\n-- ========== 20260605000000_student_portal_login.sql ==========\n\n-- Student/parent portal login without requiring sign-in first.
-- Admin sets portal_email / portal_phone on the student row; on first auth (email, phone, or Google)
-- the account is linked automatically.

CREATE OR REPLACE FUNCTION public.normalize_phone(_raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT NULLIF(regexp_replace(coalesce(_raw, ''), '\D', '', 'g'), '');
$$;

ALTER TABLE public.students
  ADD COLUMN IF NOT EXISTS portal_email text,
  ADD COLUMN IF NOT EXISTS portal_phone text,
  ADD COLUMN IF NOT EXISTS parent_portal_email text;

CREATE UNIQUE INDEX IF NOT EXISTS students_portal_email_unique
  ON public.students (lower(portal_email))
  WHERE portal_email IS NOT NULL AND user_id IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS students_portal_phone_unique
  ON public.students (portal_phone)
  WHERE portal_phone IS NOT NULL AND user_id IS NULL;

-- Link auth user to student/teacher/parent rows by reserved identifiers.
CREATE OR REPLACE FUNCTION public.link_portal_on_auth(_uid uuid DEFAULT auth.uid())
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _email text;
  _phone text;
  _teacher_id uuid;
  _student_id uuid;
  _parent_student_id uuid;
BEGIN
  IF _uid IS NULL THEN RETURN; END IF;

  SELECT lower(email), public.normalize_phone(phone)
    INTO _email, _phone
  FROM auth.users WHERE id = _uid;

  -- Teacher (by email on teachers row)
  IF _email IS NOT NULL THEN
    SELECT id INTO _teacher_id FROM public.teachers
      WHERE lower(email) = _email AND user_id IS NULL LIMIT 1;
    IF _teacher_id IS NOT NULL THEN
      UPDATE public.teachers SET user_id = _uid WHERE id = _teacher_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'teacher')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  -- Student (portal email or phone)
  IF _email IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students
      WHERE user_id IS NULL AND lower(portal_email) = _email LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF _phone IS NOT NULL AND _student_id IS NULL THEN
    SELECT id INTO _student_id FROM public.students
      WHERE user_id IS NULL AND portal_phone = _phone LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = _uid WHERE id = _student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  -- Parent (parent portal email or parent mobile)
  IF _email IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL AND lower(parent_portal_email) = _email LIMIT 1;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid
        WHERE id = _parent_student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  IF _phone IS NOT NULL THEN
    SELECT id INTO _parent_student_id FROM public.students
      WHERE parent_user_id IS NULL
        AND public.normalize_phone(parent_mobile) = _phone LIMIT 1;
    IF _parent_student_id IS NOT NULL THEN
      UPDATE public.students SET parent_user_id = _uid
        WHERE id = _parent_student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  -- Admission number in signup metadata (legacy)
  -- handled in handle_new_user for new inserts only
END;
$$;

GRANT EXECUTE ON FUNCTION public.link_portal_on_auth(uuid) TO authenticated;

-- Auth trigger: profile + portal link + admission number
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  _student_id uuid;
BEGIN
  INSERT INTO public.profiles (id, full_name, email, phone)
  VALUES (
    NEW.id,
    COALESCE(NEW.raw_user_meta_data->>'full_name', ''),
    NEW.email,
    NEW.phone
  )
  ON CONFLICT (id) DO NOTHING;

  PERFORM public.link_portal_on_auth(NEW.id);

  IF NEW.raw_user_meta_data->>'admission_number' IS NOT NULL THEN
    SELECT id INTO _student_id FROM public.students
      WHERE admission_number = NEW.raw_user_meta_data->>'admission_number'
        AND user_id IS NULL LIMIT 1;
    IF _student_id IS NOT NULL THEN
      UPDATE public.students SET user_id = NEW.id WHERE id = _student_id;
      INSERT INTO public.user_roles (user_id, role) VALUES (NEW.id, 'student')
      ON CONFLICT (user_id, role) DO NOTHING;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- First sign-in fallback: try portal link before default student role
CREATE OR REPLACE FUNCTION public.ensure_default_role()
RETURNS app_role
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _existing app_role;
BEGIN
  IF _uid IS NULL THEN RETURN NULL; END IF;

  PERFORM public.link_portal_on_auth(_uid);

  SELECT role INTO _existing FROM public.user_roles WHERE user_id = _uid LIMIT 1;
  IF _existing IS NOT NULL THEN RETURN _existing; END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
    ON CONFLICT (user_id, role) DO NOTHING;
  RETURN 'student'::app_role;
END;
$$;

-- Admin: reserve email/phone OR link immediately if account already exists
CREATE OR REPLACE FUNCTION public.admin_connect_student_account(
  _student_id uuid,
  _identifier text,
  _as text DEFAULT 'student'
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth
AS $$
DECLARE
  _uid uuid;
  _id text;
  _phone text;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can connect student accounts';
  END IF;

  _id := trim(_identifier);
  IF _id IS NULL OR _id = '' THEN
    RAISE EXCEPTION 'Email or phone required';
  END IF;

  IF lower(coalesce(_as, 'student')) = 'parent' THEN
    IF position('@' IN _id) > 0 THEN
      SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
      IF _uid IS NULL THEN
        UPDATE public.students SET parent_portal_email = lower(_id) WHERE id = _student_id;
        RETURN NULL;
      END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_portal_email = lower(_id)
        WHERE id = _student_id;
    ELSE
      _phone := public.normalize_phone(_id);
      IF _phone IS NULL OR length(_phone) < 7 THEN
        RAISE EXCEPTION 'Invalid phone number';
      END IF;
      SELECT id INTO _uid FROM auth.users
        WHERE public.normalize_phone(phone) = _phone LIMIT 1;
      IF _uid IS NULL THEN
        UPDATE public.students SET parent_mobile = _phone WHERE id = _student_id;
        RETURN NULL;
      END IF;
      UPDATE public.students SET parent_user_id = _uid, parent_mobile = _phone
        WHERE id = _student_id;
    END IF;
    INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'parent')
    ON CONFLICT (user_id, role) DO NOTHING;
    RETURN _uid;
  END IF;

  -- Student portal access
  IF position('@' IN _id) > 0 THEN
    SELECT id INTO _uid FROM auth.users WHERE lower(email) = lower(_id) LIMIT 1;
    IF _uid IS NULL THEN
      UPDATE public.students
        SET portal_email = lower(_id), portal_phone = NULL
        WHERE id = _student_id;
      RETURN NULL;
    END IF;
    UPDATE public.students
      SET user_id = _uid, portal_email = lower(_id)
      WHERE id = _student_id;
  ELSE
    _phone := public.normalize_phone(_id);
    IF _phone IS NULL OR length(_phone) < 7 THEN
      RAISE EXCEPTION 'Invalid phone number';
    END IF;
    SELECT id INTO _uid FROM auth.users
      WHERE public.normalize_phone(phone) = _phone LIMIT 1;
    IF _uid IS NULL THEN
      UPDATE public.students
        SET portal_phone = _phone, portal_email = NULL
        WHERE id = _student_id;
      RETURN NULL;
    END IF;
    UPDATE public.students
      SET user_id = _uid, portal_phone = _phone
      WHERE id = _student_id;
  END IF;

  INSERT INTO public.user_roles (user_id, role) VALUES (_uid, 'student')
  ON CONFLICT (user_id, role) DO NOTHING;

  RETURN _uid;
END;
$$;

CREATE OR REPLACE FUNCTION public.admin_revoke_student_account(_student_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') THEN
    RAISE EXCEPTION 'Only admins can revoke student accounts';
  END IF;
  SELECT user_id INTO _uid FROM public.students WHERE id = _student_id;
  UPDATE public.students
    SET user_id = NULL,
        portal_email = NULL,
        portal_phone = NULL
    WHERE id = _student_id;
  IF _uid IS NOT NULL THEN
    DELETE FROM public.user_roles WHERE user_id = _uid AND role = 'student'::app_role;
  END IF;
END;
$$;
\n\n-- ========== 20260604120000_demo_data.sql ==========\n\n-- =============================================================================
-- Wisdom Campus (SchoolFlow Connect) — Comprehensive demo dataset
-- Idempotent: fixed UUIDs + ON CONFLICT. Safe to re-run after schema migrations.
--
-- APPLY: Supabase Dashboard SQL editor, or `supabase db push` / migration up.
-- LOGIN: See docs/DEMO_ACCOUNTS.md — password DemoPass123! for all users.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ---------------------------------------------------------------------------
-- Helper: upsert demo auth user (email/password). Runs as migration owner.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._demo_upsert_auth_user(
  _id uuid,
  _email text,
  _password text,
  _full_name text
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
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
      _id,
      '00000000-0000-0000-0000-000000000000',
      'authenticated',
      'authenticated',
      lower(_email),
      extensions.crypt(_password, extensions.gen_salt('bf')),
      now(),
      '{"provider":"email","providers":["email"]}'::jsonb,
      jsonb_build_object('full_name', _full_name),
      now(), now(),
      '', '', '', ''
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

  IF NOT EXISTS (
    SELECT 1 FROM auth.identities WHERE user_id = _id AND provider = 'email'
  ) THEN
    INSERT INTO auth.identities (
      id, user_id, identity_data, provider, provider_id,
      last_sign_in_at, created_at, updated_at
    ) VALUES (
      _id, _id,
      jsonb_build_object('sub', _id::text, 'email', lower(_email)),
      'email', _id::text,
      now(), now(), now()
    );
  END IF;
END;
$$;

DO $demo$
DECLARE
  _pw text := 'DemoPass123!';
  -- Auth user UUIDs
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
  -- Entity UUIDs
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
  -- ===================== AUTH USERS =====================
  PERFORM public._demo_upsert_auth_user(u_admin,     'admin@wisdomcampus.demo',           _pw, 'Ravi Krishnan');
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

  -- Profiles (trigger may have created; ensure full data)
  INSERT INTO public.profiles (id, full_name, email) VALUES
    (u_admin,     'Ravi Krishnan',   'admin@wisdomcampus.demo'),
    (u_principal, 'Sunita Nair',     'principal@wisdomcampus.demo'),
    (u_t_math,    'Priya Sharma',    'priya.sharma@wisdomcampus.demo'),
    (u_t_phys,    'Rajesh Verma',    'rajesh.verma@wisdomcampus.demo'),
    (u_s1,        'Arjun Mehta',     'arjun.mehta@wisdomcampus.demo'),
    (u_s2,        'Priya Patel',     'priya.patel@wisdomcampus.demo'),
    (u_s3,        'Rohan Singh',     'rohan.singh@wisdomcampus.demo'),
    (u_s4,        'Ananya Iyer',     'ananya.iyer@wisdomcampus.demo'),
    (u_s5,        'Vikram Joshi',    'vikram.joshi@wisdomcampus.demo'),
    (u_p1,        'Suresh Mehta',    'mehta.parent@wisdomcampus.demo'),
    (u_p2,        'Kavita Patel',    'patel.parent@wisdomcampus.demo')
  ON CONFLICT (id) DO UPDATE SET full_name = EXCLUDED.full_name, email = EXCLUDED.email;

  -- Roles
  INSERT INTO public.user_roles (user_id, role) VALUES
    (u_admin,     'admin'),
    (u_principal, 'principal'),
    (u_t_math,    'teacher'),
    (u_t_phys,    'teacher'),
    (u_s1,        'student'),
    (u_s2,        'student'),
    (u_s3,        'student'),
    (u_s4,        'student'),
    (u_s5,        'student'),
    (u_p1,        'parent'),
    (u_p2,        'parent')
  ON CONFLICT (user_id, role) DO NOTHING;

  -- ===================== CLASSES =====================
  INSERT INTO public.classes (id, name, section, academic_year, kind, display_name, category) VALUES
    (c10a, '10', 'A', _yr, 'class', 'Class 10-A', 'Secondary'),
    (c9a,  '9',  'A', _yr, 'class', 'Class 9-A',  'Secondary')
  ON CONFLICT (id) DO UPDATE SET
    name = EXCLUDED.name, section = EXCLUDED.section, academic_year = EXCLUDED.academic_year,
    display_name = EXCLUDED.display_name, category = EXCLUDED.category;

  -- ===================== TEACHERS =====================
  INSERT INTO public.teachers (
    id, user_id, full_name, subject, mobile, email,
    is_class_teacher, class_teacher_of, employee_id, department, qualification, joining_date, status
  ) VALUES
    (t_math, u_t_math, 'Priya Sharma', 'Mathematics', '9876501001', 'priya.sharma@wisdomcampus.demo',
     true, c10a, 'EMP-T-001', 'Mathematics', 'M.Sc Mathematics', '2018-06-01', 'active'),
    (t_phys, u_t_phys, 'Rajesh Verma', 'Physics', '9876501002', 'rajesh.verma@wisdomcampus.demo',
     false, NULL, 'EMP-T-002', 'Science', 'M.Sc Physics', '2019-07-15', 'active')
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, full_name = EXCLUDED.full_name, email = EXCLUDED.email,
    is_class_teacher = EXCLUDED.is_class_teacher, class_teacher_of = EXCLUDED.class_teacher_of;

  INSERT INTO public.teacher_classes (teacher_id, class_id, subject) VALUES
    (t_math, c10a, 'Mathematics'),
    (t_math, c9a,  'Mathematics'),
    (t_phys, c10a, 'Physics')
  ON CONFLICT (teacher_id, class_id, subject) DO NOTHING;

  -- ===================== STUDENTS =====================
  INSERT INTO public.students (
    id, user_id, full_name, admission_number, roll_number, class_id,
    parent_user_id, parent_name, parent_mobile, address, date_of_birth
  ) VALUES
    (st1, u_s1, 'Arjun Mehta',   'WC10A001', '1', c10a, u_p1, 'Suresh Mehta',  '9876502001', '12, MG Road, Pune', '2010-03-15'),
    (st2, u_s2, 'Priya Patel',   'WC10A002', '2', c10a, u_p2, 'Kavita Patel',  '9876502002', '45, FC Road, Pune', '2010-07-22'),
    (st3, u_s3, 'Rohan Singh',   'WC10A003', '3', c10a, NULL, 'Harpreet Singh','9876502003', '8, Koregaon Park', '2010-01-08'),
    (st4, u_s4, 'Ananya Iyer',   'WC10A004', '4', c10a, NULL, 'Lakshmi Iyer',  '9876502004', '22, Baner Road',   '2010-11-30'),
    (st5, u_s5, 'Vikram Joshi',  'WC10A005', '5', c10a, NULL, 'Amit Joshi',    '9876502005', '3, Aundh',         '2010-05-18')
  ON CONFLICT (id) DO UPDATE SET
    user_id = EXCLUDED.user_id, class_id = EXCLUDED.class_id,
    parent_user_id = EXCLUDED.parent_user_id, roll_number = EXCLUDED.roll_number;

  -- ===================== ATTENDANCE =====================
  INSERT INTO public.attendance (student_id, class_id, date, status, marked_by) VALUES
    (st1, c10a, _today,     'present', u_t_math),
    (st2, c10a, _today,     'present', u_t_math),
    (st3, c10a, _today,     'absent',  u_t_math),
    (st4, c10a, _today,     'present', u_t_math),
    (st5, c10a, _today,     'leave',   u_t_math),
    (st1, c10a, _today - 1, 'present', u_t_math),
    (st2, c10a, _today - 1, 'present', u_t_math),
    (st3, c10a, _today - 1, 'present', u_t_math),
    (st4, c10a, _today - 1, 'absent',  u_t_math),
    (st5, c10a, _today - 1, 'present', u_t_math)
  ON CONFLICT (student_id, date) DO UPDATE SET status = EXCLUDED.status, marked_by = EXCLUDED.marked_by;

  INSERT INTO public.attendance_locks (class_id, date, locked_by) VALUES
    (c10a, _today - 2, u_t_math)
  ON CONFLICT (class_id, date) DO NOTHING;

  INSERT INTO public.attendance_audit (class_id, date, student_id, prev_status, new_status, edited_by) VALUES
    (c10a, _today - 2, st3, 'absent', 'present', u_principal);

  -- ===================== FEES =====================
  INSERT INTO public.fees (student_id, month, amount, paid_amount, due_date, status, notes) VALUES
    (st1, to_char(_today, 'YYYY') || '-04', 4500, 4500, (_today - 30)::date, 'paid',   'April tuition'),
    (st1, to_char(_today, 'YYYY') || '-05', 4500, 2000, (_today + 10)::date, 'partial','May — partial payment'),
    (st1, to_char(_today, 'YYYY') || '-06', 4500, 0,    (_today + 25)::date, 'unpaid', 'June due'),
    (st2, to_char(_today, 'YYYY') || '-05', 4500, 4500, (_today - 5)::date,  'paid',   NULL),
    (st2, to_char(_today, 'YYYY') || '-06', 4500, 0,    (_today + 20)::date, 'unpaid', NULL),
    (st3, to_char(_today, 'YYYY') || '-06', 4500, 4500, (_today)::date,      'paid',   NULL)
  ON CONFLICT (student_id, month) DO UPDATE SET
    amount = EXCLUDED.amount, paid_amount = EXCLUDED.paid_amount,
    status = EXCLUDED.status, notes = EXCLUDED.notes;

  -- ===================== EXAMS & MARKS =====================
  INSERT INTO public.exams (id, name, exam_type, class_id, subject, max_marks, exam_date, created_by) VALUES
    (exam1, 'Unit Test 1 — Real Numbers', 'unit_test', c10a, 'Mathematics', 20, _today - 14, u_t_math),
    (exam2, 'Half Yearly — Electricity',  'half_yearly', c10a, 'Physics', 50, _today - 7, u_t_phys)
  ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, exam_date = EXCLUDED.exam_date;

  INSERT INTO public.marks (exam_id, student_id, marks_obtained, remarks) VALUES
    (exam1, st1, 18, 'Excellent'),
    (exam1, st2, 16, 'Good'),
    (exam1, st3, 12, 'Needs practice'),
    (exam1, st4, 19, 'Top scorer'),
    (exam1, st5, 14, NULL),
    (exam2, st1, 42, NULL),
    (exam2, st2, 38, NULL),
    (exam2, st3, 45, 'Outstanding'),
    (exam2, st4, 40, NULL),
    (exam2, st5, 35, NULL)
  ON CONFLICT (exam_id, student_id) DO UPDATE SET marks_obtained = EXCLUDED.marks_obtained, remarks = EXCLUDED.remarks;

  -- ===================== NOTICES =====================
  INSERT INTO public.notices (id, title, body, audience, class_id, posted_by, expires_at) VALUES
    ('d9000001-0001-4000-8000-000000000001',
     'PTM — Class 10-A', 'Parent-Teacher meeting on Saturday 10 AM in Room 12.', 'class', c10a, u_t_math, now() + interval '30 days'),
    ('d9000001-0002-4000-8000-000000000002',
     'Holiday — Guru Purnima', 'School closed on Guru Purnima. Regular classes resume next day.', 'all', NULL, u_principal, now() + interval '60 days'),
    ('d9000001-0003-4000-8000-000000000003',
     'Teachers: CBSE workshop', 'Mandatory NCERT-aligned workshop for Science & Maths faculty.', 'teachers', NULL, u_principal, now() + interval '14 days'),
    ('d9000001-0004-4000-8000-000000000004',
     'Fee reminder', 'Please clear pending June fees before the due date.', 'parents', NULL, u_admin, now() + interval '21 days')
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, body = EXCLUDED.body;

  -- ===================== HOMEWORK =====================
  INSERT INTO public.homework (id, class_id, subject, title, description, due_date, created_by) VALUES
    (hw1, c10a, 'Mathematics', 'NCERT Ch 1 — Euclid''s Division Lemma',
     'Solve Ex 1.1 Q 1–5 and upload working.', _today + 3, u_t_math)
  ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title;

  INSERT INTO public.homework_submissions (id, homework_id, student_id, content, status, grade, teacher_remarks, submitted_at, graded_at) VALUES
    (hw_sub1, hw1, st1, 'Completed all five questions with steps.', 'graded', 'A', 'Neat presentation', now() - interval '1 day', now())
  ON CONFLICT (homework_id, student_id) DO UPDATE SET status = EXCLUDED.status, grade = EXCLUDED.grade;

  INSERT INTO public.homework_submissions (homework_id, student_id, content, status, submitted_at) VALUES
    (hw1, st2, 'Submitted — pending review', 'submitted', now() - interval '2 hours')
  ON CONFLICT (homework_id, student_id) DO NOTHING;

  -- ===================== LIBRARY =====================
  INSERT INTO public.library_books (id, title, author, isbn, category, total_copies, available_copies, shelf_location) VALUES
    (lib_book1, 'Mathematics — Class X (NCERT)', 'NCERT', '978-81-7450-634-4', 'Textbook', 5, 4, 'A-12'),
    ('d7000001-0002-4000-8000-000000000002', 'Science — Class X (NCERT)', 'NCERT', '978-81-7450-636-8', 'Textbook', 5, 5, 'A-13'),
    ('d7000001-0003-4000-8000-000000000003', 'Physics Refresher', 'H.C. Verma', '978-8177091878', 'Reference', 2, 2, 'B-02')
  ON CONFLICT (id) DO UPDATE SET available_copies = EXCLUDED.available_copies;

  INSERT INTO public.library_checkouts (id, book_id, student_id, due_date, status, issued_by) VALUES
    (lib_co1, lib_book1, st1, _today + 10, 'borrowed', u_t_math)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

  -- ===================== MESSAGES (chat) =====================
  INSERT INTO public.messages (sender_id, receiver_id, content, is_read) VALUES
    (u_p1, u_t_math, 'Namaste Ma''am, Arjun was unwell yesterday. Will share medical certificate.', true),
    (u_t_math, u_p1, 'Received. Attendance updated. Hope Arjun feels better soon.', true),
    (u_p1, u_t_math, 'Thank you. When is the PTM?', false)
  ON CONFLICT DO NOTHING;

  -- ===================== LEAVE REQUESTS =====================
  INSERT INTO public.leave_requests (
    id, applicant_user_id, applicant_kind, student_id, class_id,
    leave_type, from_date, to_date, reason, status, reviewed_by, reviewed_at
  ) VALUES
    ('d9000002-0001-4000-8000-000000000001', u_s5, 'student', st5, c10a,
     'medical', _today, _today + 1, 'Viral fever', 'pending', NULL, NULL),
    ('d9000002-0002-4000-8000-000000000002', u_s3, 'student', st3, c10a,
     'family', _today - 10, _today - 9, 'Family function', 'approved', u_t_math, now() - interval '11 days'),
    ('d9000002-0003-4000-8000-000000000003', u_t_phys, 'teacher', NULL, NULL,
     'personal', _today + 5, _today + 5, 'Personal work', 'rejected', u_principal, now() - interval '1 day')
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status;

  -- ===================== STAFF ATTENDANCE =====================
  INSERT INTO public.staff_attendance (teacher_id, date, status, marked_by) VALUES
    (t_math, _today,     'present', u_principal),
    (t_phys, _today,     'present', u_principal),
    (t_math, _today - 1, 'present', u_principal)
  ON CONFLICT (teacher_id, date) DO NOTHING;

  -- ===================== INQUIRIES & COMPLAINTS =====================
  INSERT INTO public.school_inquiries (id, contact_name, contact_phone, contact_email, grade_interest, message, status, created_by) VALUES
    ('d9000003-0001-4000-8000-000000000001', 'Amit Deshmukh', '9988776655', 'amit@example.com', 'Class 9',
     'Interested in CBSE admission for 2026-27.', 'open', u_admin)
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.school_complaints (id, student_id, submitted_by, complainant_name, subject, body, category, status) VALUES
    ('d9000004-0001-4000-8000-000000000001', st3, u_p1, 'Suresh Mehta', 'Canteen hygiene',
     'Request to improve lunch hygiene standards.', 'facilities', 'in_progress')
  ON CONFLICT (id) DO NOTHING;

  -- ===================== STUDENT XP & BADGES =====================
  INSERT INTO public.student_xp (user_id, xp, level, current_streak, longest_streak, total_battles, wins, equipped_badge, last_battle_at) VALUES
    (u_s1, 320, 4, 3, 7, 8, 3, 'first_win', now() - interval '1 day'),
    (u_s2, 180, 2, 1, 5, 4, 1, NULL, now() - interval '3 days'),
    (u_s3, 450, 5, 5, 12, 12, 6, 'sharp_shooter', now() - interval '2 hours')
  ON CONFLICT (user_id) DO UPDATE SET xp = EXCLUDED.xp, level = EXCLUDED.level, wins = EXCLUDED.wins;

  INSERT INTO public.student_badges (user_id, badge_code, tier) VALUES
    (u_s1, 'first_win', 'bronze'),
    (u_s1, 'first_dpp', 'bronze'),
    (u_s3, 'first_win', 'bronze'),
    (u_s3, 'sharp_shooter', 'silver'),
    (u_s3, 'dpp_perfect', 'gold')
  ON CONFLICT (user_id, badge_code) DO NOTHING;

  -- ===================== BATTLES =====================
  INSERT INTO public.battles (
    id, class_id, creator_user_id, title, subject, topic, chapter, difficulty,
    type, status, starts_at, duration_sec, per_question_sec, question_count,
    is_public, mode, source, class_level
  ) VALUES
    (b_sched, c10a, u_t_math, 'Scheduled: Trigonometry Warm-up', 'Mathematics', 'Trigonometry', 'Introduction', 'easy',
     'mcq', 'scheduled', now() + interval '2 days', 100, 20, 5, true, 'class', 'bank', 10),
    (b_live, c10a, u_s3, 'Live: Physics Electricity', 'Physics', 'Electricity', 'Current Electricity', 'medium',
     'mcq', 'live', now(), 100, 20, 5, true, 'class', 'bank', 10),
    (b_done, c10a, u_s1, 'Finished: Real Numbers Quiz', 'Mathematics', 'Real Numbers', 'Real Numbers', 'medium',
     'mcq', 'finished', now() - interval '2 days', 100, 20, 2, true, 'class', 'bank', 10)
  ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, title = EXCLUDED.title;

  -- Pick question bank rows for battle questions
  SELECT id INTO _qb_id FROM public.question_bank
  WHERE is_approved AND subject = 'Mathematics' AND class_level = 10 LIMIT 1;

  INSERT INTO public.battle_questions (id, battle_id, order_index, question, options, correct_index, points, bank_question_id) VALUES
    (bq_done1, b_done, 0,
     'The HCF of 12 and 18 is:',
     '["6","12","3","9"]'::jsonb, 0, 10, _qb_id),
    (bq_done2, b_done, 1,
     'The value of sin 30° is:',
     '["1/2","√3/2","1","0"]'::jsonb, 0, 10,
     (SELECT id FROM public.question_bank WHERE is_approved AND subject = 'Mathematics' AND class_level = 10 OFFSET 1 LIMIT 1))
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.battle_participants (
    id, battle_id, user_id, student_id, display_name,
    joined_at, finished_at, score, correct_count, answered_count, total_time_ms, rank
  ) VALUES
    (bp_done1, b_done, u_s1, st1, 'Arjun Mehta', now() - interval '2 days', now() - interval '2 days' + interval '90 seconds', 20, 2, 2, 45000, 1),
    (bp_done2, b_done, u_s3, st3, 'Rohan Singh', now() - interval '2 days', now() - interval '2 days' + interval '120 seconds', 10, 1, 2, 90000, 2)
  ON CONFLICT (battle_id, user_id) DO UPDATE SET score = EXCLUDED.score, rank = EXCLUDED.rank, finished_at = EXCLUDED.finished_at;

  INSERT INTO public.battle_answers (participant_id, question_id, selected_index, is_correct, time_ms) VALUES
    (bp_done1, bq_done1, 0, true, 20000),
    (bp_done1, bq_done2, 0, true, 25000),
    (bp_done2, bq_done1, 0, true, 40000),
    (bp_done2, bq_done2, 1, false, 50000)
  ON CONFLICT (participant_id, question_id) DO NOTHING;

  -- Battle invite (Rohan challenged by Arjun — pending)
  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id, status) VALUES
    (b_live, u_s1, u_s3, 'pending')
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  -- Battle feed events
  INSERT INTO public.battle_events (kind, actor_user_id, actor_name, opponent_name, subject, detail, battle_id, class_id, icon) VALUES
    ('win', u_s3, 'Rohan Singh', 'Arjun Mehta', 'Mathematics', 'won a close Real Numbers duel', b_done, c10a, 'trophy'),
    ('challenge', u_s3, 'Rohan Singh', NULL, 'Physics', 'threw down an Electricity challenge', b_live, c10a, 'swords'),
    ('badge', u_s1, 'Arjun Mehta', NULL, NULL, 'earned First Win badge', NULL, c10a, 'award')
  ON CONFLICT DO NOTHING;

  -- Battle report for finished participant (minimal valid report JSON)
  INSERT INTO public.battle_reports (participant_id, battle_id, user_id, display_name, report, expires_at) VALUES
    (bp_done1, b_done, u_s1, 'Arjun Mehta',
     jsonb_build_object(
       'summary', jsonb_build_object('score', 20, 'correct', 2, 'answered', 2, 'rank', 1, 'won', true),
       'comparison', jsonb_build_object('class_avg_score', 15, 'class_avg_accuracy', 75)
     ),
     now() + interval '20 hours')
  ON CONFLICT (participant_id) DO UPDATE SET report = EXCLUDED.report, expires_at = EXCLUDED.expires_at;

  -- ===================== DPPS =====================
  INSERT INTO public.dpps (
    id, title, subject, chapter, topic, class_id, created_by,
    difficulty, instructions, due_at, duration_sec, total_marks, negative_marking,
    is_published, question_count
  ) VALUES
    (dpp_pub, 'DPP — Quadratic Equations', 'Mathematics', 'Quadratic Equations', 'Nature of Roots',
     c10a, u_t_math, 'medium', 'No calculator. Show rough work in notebook.', now() + interval '5 days',
     1200, 2, 0.25, true, 2),
    (dpp_draft, 'Draft DPP — Light (unpublished)', 'Physics', 'Light', 'Reflection',
     c10a, u_t_phys, 'easy', 'For class test revision.', now() + interval '7 days',
     900, 0, 0, false, 0)
  ON CONFLICT (id) DO UPDATE SET is_published = EXCLUDED.is_published, title = EXCLUDED.title;

  INSERT INTO public.dpp_questions (id, dpp_id, order_index, kind, question, options, correct, marks, explanation) VALUES
    (dpp_q1, dpp_pub, 0, 'mcq',
     'The discriminant of ax² + bx + c = 0 is:',
     '["b² − 4ac","2a","−b/2a","b² + 4ac"]'::jsonb,
     '{"indexes":[0]}'::jsonb, 1, 'D = b² − 4ac'),
    (dpp_q2, dpp_pub, 1, 'mcq',
     'If roots are equal, discriminant equals:',
     '["0","1","b²","2ac"]'::jsonb,
     '{"indexes":[0]}'::jsonb, 1, 'Equal roots ⇒ D = 0')
  ON CONFLICT (id) DO NOTHING;

  UPDATE public.dpps SET question_count = 2, total_marks = 2 WHERE id = dpp_pub;

  INSERT INTO public.dpp_attempts (
    id, dpp_id, user_id, student_id, started_at, submitted_at,
    score, max_score, correct_count, total_count, time_spent_sec, status
  ) VALUES
    (dpp_att, dpp_pub, u_s1, st1, now() - interval '1 day', now() - interval '23 hours',
     2, 2, 2, 2, 420, 'submitted')
  ON CONFLICT (dpp_id, user_id) DO UPDATE SET status = EXCLUDED.status, score = EXCLUDED.score;

  INSERT INTO public.dpp_answers (attempt_id, question_id, response, is_correct, marks_awarded, time_ms) VALUES
    (dpp_att, dpp_q1, '{"indexes":[0]}'::jsonb, true, 1, 180000),
    (dpp_att, dpp_q2, '{"indexes":[0]}'::jsonb, true, 1, 200000)
  ON CONFLICT (attempt_id, question_id) DO NOTHING;

  -- In-progress attempt for student 2
  INSERT INTO public.dpp_attempts (dpp_id, user_id, student_id, max_score, total_count, status)
  VALUES (dpp_pub, u_s2, st2, 2, 2, 'in_progress')
  ON CONFLICT (dpp_id, user_id) DO NOTHING;

  -- ===================== NOTIFICATIONS =====================
  INSERT INTO public.notifications (user_id, type, title, body, icon, link, read) VALUES
    (u_s1, 'invite', 'Battle challenge!', 'Rohan Singh challenged you to a Physics battle.', 'swords', '/student/battleground/battle/' || b_live::text, false),
    (u_s1, 'notice', 'PTM reminder', 'Class 10-A PTM this Saturday.', 'bell', '/student/notices', false),
    (u_s2, 'homework', 'Homework graded', 'Your Mathematics submission was graded A.', 'book', '/student/homework', true),
    (u_p1, 'fee', 'Fee reminder', 'June fees pending for Arjun.', 'wallet', '/parent/fees', false),
    (u_t_math, 'leave', 'Leave pending', 'Vikram Joshi requested medical leave.', 'calendar', '/teacher/leaves', false),
    (u_principal, 'inquiry', 'New admission inquiry', 'Amit Deshmukh — Class 9 interest.', 'inbox', '/principal/cases', false)
  ON CONFLICT DO NOTHING;

  -- ===================== TIMETABLE =====================
  INSERT INTO public.class_timetables (class_id, grid, updated_by) VALUES
    (c10a, jsonb_build_object(
      'monday',    jsonb_build_array('Mathematics','Physics','English','Hindi','Chemistry'),
      'tuesday',   jsonb_build_array('Physics','Mathematics','Social Science','English','Games'),
      'wednesday', jsonb_build_array('Chemistry','Mathematics','Physics','Computer','Library'),
      'thursday',  jsonb_build_array('English','Mathematics','Physics','Hindi','Art'),
      'friday',    jsonb_build_array('Mathematics','Chemistry','Physics','Social Science','Assembly'),
      'saturday',  jsonb_build_array('DPP / Revision','Sports','—','—','—')
    ), u_t_math)
  ON CONFLICT (class_id) DO UPDATE SET grid = EXCLUDED.grid, updated_by = EXCLUDED.updated_by;

  -- ===================== APP SETTINGS =====================
  INSERT INTO public.app_settings (id, school_name, locale, currency, enable_notices, enable_fees, enable_leaves, updated_by) VALUES
    (true, 'Wisdom Campus Demo School', 'en-IN', 'INR', true, true, true, u_admin)
  ON CONFLICT (id) DO UPDATE SET
    school_name = EXCLUDED.school_name,
    enable_notices = EXCLUDED.enable_notices,
    enable_fees = EXCLUDED.enable_fees,
    enable_leaves = EXCLUDED.enable_leaves,
    updated_by = EXCLUDED.updated_by;

  -- ===================== AUDIT LOGS =====================
  INSERT INTO public.audit_logs (actor_user_id, action, entity, entity_id, metadata) VALUES
    (u_admin, 'demo_seed', 'migration', NULL, '{"note":"Wisdom Campus demo dataset applied"}'::jsonb),
    (u_principal, 'leave_review', 'leave_requests', 'd9000002-0003-4000-8000-000000000003', '{"status":"rejected"}'::jsonb)
  ON CONFLICT DO NOTHING;

  RAISE NOTICE 'Wisdom Campus demo data applied. Login: admin@wisdomcampus.demo / DemoPass123! — see docs/DEMO_ACCOUNTS.md';
END $demo$;

DROP FUNCTION IF EXISTS public._demo_upsert_auth_user(uuid, text, text, text);
\n

-- ========== Student Success Phase 1 (20260606000000) ==========

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


-- ========== Student Success Phase 2 (20260607000000) ==========

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


-- ========== Student Success Phase 1 (20260606000000) ==========

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

-- ========== Student Success Phase 2 (20260607000000) ==========

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

-- ========== Student Success Phase 3 (20260608000000) ==========

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
