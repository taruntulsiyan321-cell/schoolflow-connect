-- =============================================================================
-- LOVABLE — PASTE THIS ENTIRE FILE ONCE
-- Project database: kdmjipeksjdyojjdokbi (Lovable Cloud Supabase)
-- Open Lovable → your SchoolFlow project → Supabase → SQL Editor → New query
-- Paste everything below → Run (single click, no batches)
-- =============================================================================

-- ========== 20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql ==========


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


-- ========== 20260516000000_inquiries_complaints.sql ==========

-- Inquiry & complaint workflows for admin / principal

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


-- ========== 20260604030000_student_panel_fixes.sql ==========

-- =========================================================
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


-- ========== 20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql ==========

-- Combined pending migrations
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


-- ========== 20260604080000_battle_monitor.sql ==========

-- =========================================================
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


-- ========== 20260604100000_battleground_phase4.sql ==========

-- =========================================================
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


-- ========== 20260605000000_student_portal_login.sql ==========

-- Student/parent portal login without requiring sign-in first.
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


-- ========== 20260606000000_student_success_platform.sql ==========

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


-- ========== 20260604120000_demo_data.sql ==========

-- =============================================================================
-- Wisdom Campus (SchoolFlow Connect) — Comprehensive demo dataset
-- Idempotent: fixed UUIDs + ON CONFLICT. Safe to re-run after schema migrations.
--
-- APPLY: Supabase Dashboard SQL editor, or `supabase db push` / migration up.
-- LOGIN: See docs/DEMO_ACCOUNTS.md — password DemoPass123! for all users.
-- =============================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Lovable library schema: books may lack shelf_location; checkouts use library_books_id
ALTER TABLE public.library_books ADD COLUMN IF NOT EXISTS shelf_location TEXT DEFAULT '';

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

  -- ===================== LIBRARY (Lovable schema: optional shelf_location; library_books_id) =====================
  INSERT INTO public.library_books (id, title, author, isbn, category, total_copies, available_copies) VALUES
    (lib_book1, 'Mathematics — Class X (NCERT)', 'NCERT', '978-81-7450-634-4', 'Textbook', 5, 4),
    ('d7000001-0002-4000-8000-000000000002', 'Science — Class X (NCERT)', 'NCERT', '978-81-7450-636-8', 'Textbook', 5, 5),
    ('d7000001-0003-4000-8000-000000000003', 'Physics Refresher', 'H.C. Verma', '978-8177091878', 'Reference', 2, 2)
  ON CONFLICT (id) DO UPDATE SET available_copies = EXCLUDED.available_copies;

  INSERT INTO public.library_checkouts (id, library_books_id, student_id, due_date, status) VALUES
    (lib_co1, lib_book1, st1, _today + 10, 'borrowed')
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


-- ========== 20260609000000_fix_quick_battle_overload.sql ==========

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


-- ========== 20260610000000_battleground_overhaul.sql ==========

-- Battleground: solo privacy, open/class lobbies, auto-finish battles, class-scoped curriculum

-- Helper: mark battle finished when appropriate
CREATE OR REPLACE FUNCTION public._maybe_finish_battle(_battle_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _b record; _total int; _done int;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL OR _b.status = 'finished' THEN RETURN; END IF;

  SELECT count(*), count(*) FILTER (WHERE finished_at IS NOT NULL)
    INTO _total, _done
  FROM public.battle_participants WHERE battle_id = _battle_id;

  IF _b.mode = 'solo' AND _done >= 1 THEN
    UPDATE public.battles SET status = 'finished' WHERE id = _battle_id;
    RETURN;
  END IF;

  IF _total >= 2 AND _done = _total THEN
    UPDATE public.battles SET status = 'finished' WHERE id = _battle_id;
    RETURN;
  END IF;

  IF _b.mode IN ('open', 'lobby') AND _total >= 1 AND _done = _total AND _done > 0 THEN
    UPDATE public.battles SET status = 'finished' WHERE id = _battle_id;
  END IF;
END; $$;

-- Class grade from class id
CREATE OR REPLACE FUNCTION public._class_grade(_class_id uuid)
RETURNS int LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT (regexp_match(COALESCE(c.name, c.display_name, ''), '\m(6|7|8|9|10|11|12)\M'))[1]::int
  FROM public.classes c WHERE c.id = _class_id;
$$;

-- Curriculum filtered by class grade when class_id provided
CREATE OR REPLACE FUNCTION public.rpc_battle_curriculum(_subject text, _class_id uuid DEFAULT NULL)
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
      AND (
        _class_id IS NULL
        OR class_level IS NULL
        OR class_level = public._class_grade(_class_id)
      )
  ) sub;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_battle_curriculum(text, uuid) TO authenticated;

-- Solo practice: private, not listed in open battles
DROP FUNCTION IF EXISTS public.rpc_create_quick_battle(text, text, integer, integer, text, uuid);

CREATE OR REPLACE FUNCTION public.rpc_create_quick_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _class_id uuid DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  _grade := public._class_grade(_cid);

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    'Solo Practice · ' || _subject || COALESCE(' · ' || _chapter, ''),
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, false, 'solo', 'bank', now(), _grade
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;

-- Open lobby: anyone in school can join
CREATE OR REPLACE FUNCTION public.rpc_create_open_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _topic text DEFAULT NULL,
  _class_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  _grade := public._class_grade(_cid);

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    'Open Battle · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'open', 'bank', now(), _grade
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_create_open_battle(text, text, int, int, text, text, uuid) TO authenticated;

-- Class lobby: only same class_id
CREATE OR REPLACE FUNCTION public.rpc_create_class_battle(
  _subject text, _difficulty text DEFAULT 'medium', _count int DEFAULT 5,
  _per_q int DEFAULT 20, _chapter text DEFAULT NULL, _topic text DEFAULT NULL,
  _class_id uuid DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := COALESCE(_class_id, public.student_class_id(auth.uid()));
  IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to host a class battle'; END IF;
  _grade := public._class_grade(_cid);

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    'Class Battle · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, true, 'lobby', 'bank', now(), _grade
  ) RETURNING id INTO _bid;
  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this combination yet';
  END IF;
  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_create_class_battle(text, text, int, int, text, text, uuid) TO authenticated;

-- Patch finish_battle: idempotent + auto-finish battle row
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _user uuid; _battle uuid; _score int; _correct int; _answered int; _time int;
  _won boolean := false; _max_score int; _xp record; _avg_ms numeric; _hour int;
  _subject text; _class uuid; _name text; _opp text; _participants int;
  _mins int; _already timestamptz;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms, display_name, finished_at
    INTO _user, _battle, _score, _correct, _answered, _time, _name, _already
    FROM public.battle_participants WHERE id = _participant_id;
  IF _user IS NULL OR _user <> auth.uid() THEN RAISE EXCEPTION 'Not your participation'; END IF;
  IF _already IS NOT NULL THEN
    PERFORM public._maybe_finish_battle(_battle);
    RETURN;
  END IF;

  UPDATE public.battle_participants SET finished_at = now() WHERE id = _participant_id;

  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC) AS r
    FROM public.battle_participants WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p SET rank = r.r FROM ranked r WHERE p.id = r.id;

  SELECT MAX(score), count(*) INTO _max_score, _participants
    FROM public.battle_participants WHERE battle_id = _battle;
  _won := (_score = _max_score AND _score > 0 AND _participants > 1);

  INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at)
  SELECT _user, bq.bank_question_id, 1, now()
  FROM public.battle_answers ba
  JOIN public.battle_questions bq ON bq.id = ba.question_id
  WHERE ba.participant_id = _participant_id AND bq.bank_question_id IS NOT NULL
  ON CONFLICT (user_id, question_id) DO UPDATE
    SET times_seen = student_question_history.times_seen + 1, last_seen_at = now();

  INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at,
    best_score, total_correct, total_answered, win_streak, best_win_streak, current_streak, longest_streak)
  VALUES (_user, _score, 1 + (_score/100), 1, CASE WHEN _won THEN 1 ELSE 0 END, now(),
    _score, _correct, _answered, CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END,
    CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END)
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
    current_streak  = CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1 ELSE 0 END,
    longest_streak  = GREATEST(COALESCE(student_xp.longest_streak, 0),
                      CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1 ELSE 0 END);

  SELECT * INTO _xp FROM public.student_xp WHERE user_id = _user;
  _avg_ms := CASE WHEN _answered > 0 THEN _time::numeric / _answered ELSE NULL END;
  _hour   := EXTRACT(HOUR FROM now());

  IF _won THEN PERFORM public._award_badge(_user,'first_win','bronze'); END IF;
  IF _correct >= 5 THEN PERFORM public._award_badge(_user,'sharp_shooter','silver'); END IF;
  IF _answered >= 5 AND _correct = _answered THEN PERFORM public._award_badge(_user,'flawless','gold'); END IF;

  SELECT b.subject, b.class_id INTO _subject, _class FROM public.battles b WHERE b.id = _battle;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_capture_battle_mistakes') THEN
    PERFORM public._capture_battle_mistakes(_participant_id);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_bump_academic_activity') THEN
    _mins := GREATEST(COALESCE(_time / 60000, 1), 1);
    PERFORM public._bump_academic_activity(_user, 0, 0, 1, _mins);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_award_engagement_badges') THEN
    PERFORM public._award_engagement_badges(_user);
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_snapshot_battle_report') THEN
    PERFORM public._snapshot_battle_report(_participant_id);
  END IF;

  PERFORM public._maybe_finish_battle(_battle);
END; $$;

-- Duel challenges: private, not in open lobby list
CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _bid uuid; _cid uuid; _n int; _name text; _grade int;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(auth.uid());
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = auth.uid() LIMIT 1;

  INSERT INTO public.battles (title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
  VALUES (
    _name || ' challenges you · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count, false, 'duel', 'bank', now(), _grade
  ) RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
  VALUES (_bid, _opponent_user_id, auth.uid())
  ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
    PERFORM public._battle_event('challenge', auth.uid(), _name,
      'threw down a ' || _subject || ' challenge',
      _subject, NULL, _bid, _cid, 'swords');
  END IF;

  RETURN _bid;
END; $$;

-- Clean up stale solo/duel battles stuck in live list
UPDATE public.battles SET status = 'finished'
WHERE mode IN ('solo', 'duel') AND status IN ('live', 'scheduled')
  AND EXISTS (
    SELECT 1 FROM public.battle_participants bp
    WHERE bp.battle_id = battles.id AND bp.finished_at IS NOT NULL
  );


-- ========== 20260611000000_question_template_engine.sql ==========

-- CBSE Class 12 Mathematics — parametric question template engine

CREATE TABLE IF NOT EXISTS public.question_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  class int NOT NULL,
  subject text NOT NULL,
  chapter text NOT NULL,
  template_type text NOT NULL,
  template_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation_template text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_templates_chapter
  ON public.question_templates (class, subject, chapter) WHERE is_active;

CREATE INDEX IF NOT EXISTS question_templates_type
  ON public.question_templates (template_type);

CREATE TABLE IF NOT EXISTS public.practice_sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject text NOT NULL,
  chapter text NOT NULL,
  question_count int NOT NULL DEFAULT 10,
  correct_count int NOT NULL DEFAULT 0,
  score numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.question_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid REFERENCES public.practice_sessions(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.question_templates(id) ON DELETE CASCADE,
  generated_question jsonb NOT NULL,
  selected_answer jsonb,
  correct_answer jsonb NOT NULL,
  score numeric NOT NULL DEFAULT 0,
  is_correct boolean,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS question_attempts_student
  ON public.question_attempts (student_id, created_at DESC);

ALTER TABLE public.question_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.question_attempts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "templates read all" ON public.question_templates;
CREATE POLICY "templates read all" ON public.question_templates
  FOR SELECT TO authenticated USING (is_active);

DROP POLICY IF EXISTS "practice sessions self" ON public.practice_sessions;
CREATE POLICY "practice sessions self" ON public.practice_sessions
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "question attempts self" ON public.question_attempts;
CREATE POLICY "question attempts self" ON public.question_attempts
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

-- Randomly pick template IDs for a practice session (generation happens client-side)
CREATE OR REPLACE FUNCTION public.rpc_pick_question_templates(
  _class int,
  _subject text,
  _chapter text,
  _count int DEFAULT 10
)
RETURNS SETOF public.question_templates
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT *
  FROM public.question_templates
  WHERE class = _class
    AND lower(subject) = lower(_subject)
    AND chapter = _chapter
    AND is_active
  ORDER BY random()
  LIMIT GREATEST(_count, 1);
$$;

GRANT EXECUTE ON FUNCTION public.rpc_pick_question_templates(int, text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_start_practice_session(
  _subject text,
  _chapter text,
  _count int DEFAULT 10
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _sid uuid; _student uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  INSERT INTO public.practice_sessions (student_id, user_id, subject, chapter, question_count)
  VALUES (_student, _uid, _subject, _chapter, _count)
  RETURNING id INTO _sid;
  RETURN _sid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_start_practice_session(text, text, int) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _session_id uuid,
  _template_id uuid,
  _generated_question jsonb,
  _correct_answer jsonb,
  _selected_answer jsonb DEFAULT NULL,
  _is_correct boolean DEFAULT NULL,
  _score numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _student uuid; _aid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct
  ) VALUES (
    _session_id, _student, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct
  ) RETURNING id INTO _aid;

  IF _is_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1, score = score + COALESCE(_score, 1)
      WHERE id = _session_id AND user_id = _uid;
  END IF;
  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_question_attempt(uuid, uuid, jsonb, jsonb, jsonb, boolean, numeric) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_finish_practice_session(_session_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _s record;
BEGIN
  UPDATE public.practice_sessions SET finished_at = now()
    WHERE id = _session_id AND user_id = auth.uid()
    RETURNING * INTO _s;
  IF _s IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;
  RETURN jsonb_build_object(
    'session_id', _s.id,
    'chapter', _s.chapter,
    'question_count', _s.question_count,
    'correct_count', _s.correct_count,
    'score', _s.score
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_practice_session(uuid) TO authenticated;


-- ========== 20260612000000_ai_and_audit_fixes.sql ==========

-- AI report fixes: ensure snapshot exists, secure AI insights save, on-demand snapshot

CREATE OR REPLACE FUNCTION public.rpc_ensure_battle_report(_participant_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _p record;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _p FROM public.battle_participants WHERE id = _participant_id;
  IF _p IS NULL THEN RAISE EXCEPTION 'Participant not found'; END IF;
  IF _p.user_id <> auth.uid()
     AND NOT public.has_role(auth.uid(), 'admin')
     AND NOT public.has_role(auth.uid(), 'principal')
     AND NOT EXISTS (
       SELECT 1 FROM public.battles b
       WHERE b.id = _p.battle_id
         AND (b.creator_user_id = auth.uid()
           OR public.teacher_teaches_class(auth.uid(), b.class_id))
     ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  IF _p.finished_at IS NULL THEN
    RAISE EXCEPTION 'Finish the battle first to view the report';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.battle_reports WHERE participant_id = _participant_id) THEN
    PERFORM public._snapshot_battle_report(_participant_id);
  END IF;

  RETURN public.rpc_get_battle_report(_participant_id);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_battle_report(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_save_battle_ai_insights(
  _participant_id uuid,
  _insights jsonb
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _owner uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT user_id INTO _owner FROM public.battle_reports WHERE participant_id = _participant_id;
  IF _owner IS NULL THEN RAISE EXCEPTION 'Report not found'; END IF;
  IF _owner <> _uid
     AND NOT public.has_role(_uid, 'admin')
     AND NOT public.has_role(_uid, 'principal')
     AND NOT EXISTS (
       SELECT 1 FROM public.battle_reports br
       JOIN public.battles b ON b.id = br.battle_id
       WHERE br.participant_id = _participant_id
         AND (b.creator_user_id = _uid OR public.teacher_teaches_class(_uid, b.class_id))
     ) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  UPDATE public.battle_reports
    SET ai_insights = _insights
    WHERE participant_id = _participant_id;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_save_battle_ai_insights(uuid, jsonb) TO authenticated;


-- ========== 20260613000000_concept_mastery_recovery.sql ==========

-- Concept Mastery & Mistake Recovery System
-- Extends Student Success Phases 1-3 with concept tagging, mastery scores, recovery assignments.

-- ── Concept columns on question sources ───────────────────────────────────────
ALTER TABLE public.question_bank
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.dpp_questions
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS subject text,
  ADD COLUMN IF NOT EXISTS chapter text,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.battle_questions
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.question_templates
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text;

ALTER TABLE public.student_mistakes
  ADD COLUMN IF NOT EXISTS class_level int,
  ADD COLUMN IF NOT EXISTS concept text,
  ADD COLUMN IF NOT EXISTS subconcept text,
  ADD COLUMN IF NOT EXISTS assessment_type text;

UPDATE public.student_mistakes SET assessment_type = source WHERE assessment_type IS NULL;

-- ── Concept mastery per student ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.concept_mastery (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  class_level int,
  subject text NOT NULL,
  chapter text,
  concept text NOT NULL,
  subconcept text,
  mastery_score numeric NOT NULL DEFAULT 0 CHECK (mastery_score >= 0 AND mastery_score <= 100),
  total_attempts int NOT NULL DEFAULT 0,
  correct_attempts int NOT NULL DEFAULT 0,
  recovery_attempts int NOT NULL DEFAULT 0,
  recovery_correct int NOT NULL DEFAULT 0,
  mistake_count int NOT NULL DEFAULT 0,
  last_attempt_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS concept_mastery_user_concept
  ON public.concept_mastery (
    user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, '')
  );

CREATE INDEX IF NOT EXISTS concept_mastery_user_score
  ON public.concept_mastery (user_id, mastery_score ASC);

ALTER TABLE public.concept_mastery ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mastery self" ON public.concept_mastery;
CREATE POLICY "mastery self" ON public.concept_mastery
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS "mastery parent" ON public.concept_mastery;
CREATE POLICY "mastery parent" ON public.concept_mastery
  FOR SELECT TO authenticated USING (
    EXISTS (SELECT 1 FROM public.students s WHERE s.user_id = concept_mastery.user_id AND s.parent_user_id = auth.uid())
  );
DROP POLICY IF EXISTS "mastery teacher" ON public.concept_mastery;
CREATE POLICY "mastery teacher" ON public.concept_mastery
  FOR SELECT TO authenticated USING (
    public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'principal')
    OR EXISTS (
      SELECT 1 FROM public.students s
      WHERE s.user_id = concept_mastery.user_id AND public.teacher_teaches_class(auth.uid(), s.class_id)
    )
  );

-- ── Recovery assignments ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recovery_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  student_id uuid REFERENCES public.students(id) ON DELETE SET NULL,
  subject text NOT NULL,
  chapter text,
  concept text NOT NULL,
  subconcept text,
  severity text NOT NULL CHECK (severity IN ('minor', 'moderate', 'severe')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'skipped')),
  question_count int NOT NULL DEFAULT 0,
  questions_completed int NOT NULL DEFAULT 0,
  questions_correct int NOT NULL DEFAULT 0,
  source_type text,
  source_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

CREATE INDEX IF NOT EXISTS recovery_assignments_user_open
  ON public.recovery_assignments (user_id, status) WHERE status IN ('pending', 'in_progress');

ALTER TABLE public.recovery_assignments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recovery self" ON public.recovery_assignments;
CREATE POLICY "recovery self" ON public.recovery_assignments
  FOR ALL TO authenticated USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());

CREATE TABLE IF NOT EXISTS public.recovery_assignment_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL REFERENCES public.recovery_assignments(id) ON DELETE CASCADE,
  order_index int NOT NULL DEFAULT 0,
  question_text text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  correct_answer jsonb NOT NULL DEFAULT '{}'::jsonb,
  explanation text,
  bank_question_id uuid REFERENCES public.question_bank(id) ON DELETE SET NULL,
  template_id uuid REFERENCES public.question_templates(id) ON DELETE SET NULL,
  answered boolean NOT NULL DEFAULT false,
  is_correct boolean,
  student_answer jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS recovery_questions_assignment
  ON public.recovery_assignment_questions (assignment_id, order_index);

ALTER TABLE public.recovery_assignment_questions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recovery q via assignment" ON public.recovery_assignment_questions;
CREATE POLICY "recovery q via assignment" ON public.recovery_assignment_questions
  FOR ALL TO authenticated USING (
    EXISTS (SELECT 1 FROM public.recovery_assignments a WHERE a.id = assignment_id AND a.user_id = auth.uid())
  ) WITH CHECK (
    EXISTS (SELECT 1 FROM public.recovery_assignments a WHERE a.id = assignment_id AND a.user_id = auth.uid())
  );

-- ── Concept tag helpers ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._humanize_template_type(_t text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT initcap(replace(replace(_t, '_', ' '), 'rf ', 'Relations '));
$$;

CREATE OR REPLACE FUNCTION public._backfill_question_bank_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.question_bank SET
    concept = COALESCE(NULLIF(concept, ''), NULLIF(topic, ''), NULLIF(chapter, ''), subject),
    subconcept = COALESCE(NULLIF(subconcept, ''), NULLIF(topic, ''), concept)
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_dpp_question_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.dpp_questions dq SET
    class_level = COALESCE(
      dq.class_level,
      CASE WHEN c.name ~ '^[0-9]+$' THEN c.name::int ELSE NULL END
    ),
    subject = COALESCE(dq.subject, d.subject),
    chapter = COALESCE(dq.chapter, d.chapter),
    concept = COALESCE(NULLIF(dq.concept, ''), NULLIF(dq.subconcept, ''), NULLIF(d.topic, ''), NULLIF(d.chapter, ''), d.subject),
    subconcept = COALESCE(NULLIF(dq.subconcept, ''), NULLIF(d.topic, ''), dq.concept)
  FROM public.dpps d
  LEFT JOIN public.classes c ON c.id = d.class_id
  WHERE dq.dpp_id = d.id AND (dq.concept IS NULL OR dq.concept = '');
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_battle_question_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.battle_questions bq SET
    concept = v.new_concept,
    subconcept = v.new_subconcept
  FROM (
    SELECT
      bq2.id,
      COALESCE(NULLIF(bq2.concept, ''), NULLIF(qb.concept, ''), NULLIF(qb.topic, ''), NULLIF(b.chapter, ''), b.subject) AS new_concept,
      COALESCE(NULLIF(bq2.subconcept, ''), NULLIF(qb.subconcept, ''), NULLIF(qb.topic, ''), bq2.concept) AS new_subconcept
    FROM public.battle_questions bq2
    INNER JOIN public.battles b ON bq2.battle_id = b.id
    LEFT JOIN public.question_bank qb ON qb.id = bq2.bank_question_id
    WHERE bq2.concept IS NULL OR bq2.concept = ''
  ) v
  WHERE bq.id = v.id;
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public._backfill_template_concepts()
RETURNS int LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _n int;
BEGIN
  UPDATE public.question_templates SET
    concept = COALESCE(NULLIF(concept, ''), chapter),
    subconcept = COALESCE(NULLIF(subconcept, ''), public._humanize_template_type(template_type))
  WHERE concept IS NULL OR concept = '';
  GET DIAGNOSTICS _n = ROW_COUNT;
  RETURN _n;
END; $$;

CREATE OR REPLACE FUNCTION public.rpc_backfill_question_concepts()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'admin') AND NOT public.has_role(auth.uid(), 'principal') THEN
    RAISE EXCEPTION 'Admin or principal only';
  END IF;
  RETURN jsonb_build_object(
    'question_bank', public._backfill_question_bank_concepts(),
    'dpp_questions', public._backfill_dpp_question_concepts(),
    'battle_questions', public._backfill_battle_question_concepts(),
    'question_templates', public._backfill_template_concepts()
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_backfill_question_concepts() TO authenticated;

-- Run backfill on migration
SELECT public._backfill_question_bank_concepts();
SELECT public._backfill_dpp_question_concepts();
SELECT public._backfill_battle_question_concepts();
SELECT public._backfill_template_concepts();

-- ── Mastery computation ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._compute_mastery_score(
  _attempts int, _correct int, _recovery_attempts int, _recovery_correct int, _mistakes int, _last_at timestamptz
)
RETURNS numeric LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _acc numeric := CASE WHEN _attempts > 0 THEN 100.0 * _correct / _attempts ELSE 50 END;
  _rec numeric := CASE WHEN _recovery_attempts > 0 THEN 100.0 * _recovery_correct / _recovery_attempts ELSE _acc END;
  _cons numeric := CASE WHEN _attempts >= 8 THEN LEAST(100, _acc + 5) WHEN _attempts >= 4 THEN _acc ELSE _acc * 0.9 END;
  _recency numeric := CASE
    WHEN _last_at IS NULL THEN 40
    WHEN _last_at >= now() - interval '3 days' THEN 100
    WHEN _last_at >= now() - interval '14 days' THEN 75
    WHEN _last_at >= now() - interval '30 days' THEN 50
    ELSE 30
  END;
  _penalty numeric := LEAST(25, _mistakes * 3);
BEGIN
  RETURN LEAST(100, GREATEST(0, round(
    0.45 * _acc + 0.25 * _rec + 0.15 * _cons + 0.15 * _recency - _penalty, 1
  )));
END; $$;

CREATE OR REPLACE FUNCTION public._upsert_concept_mastery(
  _uid uuid, _sid uuid, _class int, _subject text, _chapter text, _concept text, _subconcept text,
  _is_correct boolean, _is_recovery boolean DEFAULT false
)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _mistakes int;
BEGIN
  IF _concept IS NULL OR _concept = '' THEN
    _concept := COALESCE(_chapter, _subject, 'General');
  END IF;

  SELECT count(*)::int INTO _mistakes FROM public.student_mistakes
  WHERE user_id = _uid AND NOT mastered
    AND subject = _subject
    AND COALESCE(chapter, '') = COALESCE(_chapter, '')
    AND COALESCE(concept, topic, '') = COALESCE(_concept, '');

  INSERT INTO public.concept_mastery (
    user_id, student_id, class_level, subject, chapter, concept, subconcept,
    total_attempts, correct_attempts, recovery_attempts, recovery_correct,
    mistake_count, last_attempt_at, mastery_score, updated_at
  ) VALUES (
    _uid, _sid, _class, _subject, _chapter, _concept, _subconcept,
    1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    _mistakes, now(),
    public._compute_mastery_score(
      1, CASE WHEN _is_correct THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    now()
  )
  ON CONFLICT (user_id, subject, COALESCE(chapter, ''), concept, COALESCE(subconcept, ''))
  DO UPDATE SET
    student_id = COALESCE(EXCLUDED.student_id, concept_mastery.student_id),
    class_level = COALESCE(EXCLUDED.class_level, concept_mastery.class_level),
    total_attempts = concept_mastery.total_attempts + 1,
    correct_attempts = concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
    recovery_attempts = concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
    recovery_correct = concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
    mistake_count = _mistakes,
    last_attempt_at = now(),
    mastery_score = public._compute_mastery_score(
      concept_mastery.total_attempts + 1,
      concept_mastery.correct_attempts + CASE WHEN _is_correct THEN 1 ELSE 0 END,
      concept_mastery.recovery_attempts + CASE WHEN _is_recovery THEN 1 ELSE 0 END,
      concept_mastery.recovery_correct + CASE WHEN _is_recovery AND _is_correct THEN 1 ELSE 0 END,
      _mistakes, now()
    ),
    updated_at = now();
END; $$;

-- ── Unified mistake recording with concepts ───────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_concept_mistake(
  _assessment_type text,
  _source_id uuid,
  _question_id uuid DEFAULT NULL,
  _subject text DEFAULT 'General',
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _class_level int DEFAULT NULL,
  _question_text text DEFAULT '',
  _options jsonb DEFAULT '[]'::jsonb,
  _student_answer jsonb DEFAULT '{}'::jsonb,
  _correct_answer jsonb DEFAULT '{}'::jsonb,
  _explanation text DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _sid uuid; _mid uuid; _concept_f text; _sub_f text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _sub_f := COALESCE(NULLIF(_subconcept, ''), _concept_f);

  INSERT INTO public.student_mistakes (
    user_id, student_id, source, source_id, question_id,
    class_level, subject, chapter, topic, concept, subconcept, assessment_type,
    question_text, options, student_answer, correct_answer, explanation,
    times_wrong, last_wrong_at
  ) VALUES (
    _uid, _sid,
    CASE _assessment_type
      WHEN 'battle' THEN 'battleground'
      WHEN 'practice' THEN 'practice'
      ELSE _assessment_type
    END,
    _source_id, _question_id,
    _class_level, _subject, _chapter, _concept_f, _concept_f, _sub_f, _assessment_type,
    _question_text, _options, _student_answer, _correct_answer, _explanation,
    1, now()
  )
  ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
    times_wrong = student_mistakes.times_wrong + 1,
    last_wrong_at = now(),
    student_answer = EXCLUDED.student_answer,
    concept = EXCLUDED.concept,
    subconcept = EXCLUDED.subconcept,
    mastered = false
  RETURNING id INTO _mid;

  PERFORM public._upsert_concept_mastery(_uid, _sid, _class_level, _subject, _chapter, _concept_f, _sub_f, false, false);

  RETURN _mid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_record_concept_mistake(text, uuid, uuid, text, text, text, text, int, text, jsonb, jsonb, jsonb, text) TO authenticated;

-- ── Severity from accuracy ────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public._concept_severity(_accuracy numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _accuracy < 35 THEN 'severe'
    WHEN _accuracy < 55 THEN 'moderate'
    ELSE 'minor'
  END;
$$;

CREATE OR REPLACE FUNCTION public._recovery_question_count(_severity text)
RETURNS int LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE _severity
    WHEN 'severe' THEN 12
    WHEN 'moderate' THEN 6
    ELSE 3
  END;
$$;

-- ── Assign recovery questions for a weak concept ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_assign_concept_recovery(
  _subject text,
  _chapter text DEFAULT NULL,
  _concept text DEFAULT NULL,
  _subconcept text DEFAULT NULL,
  _accuracy numeric DEFAULT 40,
  _source_type text DEFAULT NULL,
  _source_id uuid DEFAULT NULL
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _severity text; _cnt int; _aid uuid; _concept_f text;
  _qb record; _tm record; _idx int := 0;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;

  _concept_f := COALESCE(NULLIF(_concept, ''), NULLIF(_subconcept, ''), NULLIF(_chapter, ''), _subject);
  _severity := public._concept_severity(_accuracy);
  _cnt := public._recovery_question_count(_severity);

  IF EXISTS (
    SELECT 1 FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND COALESCE(chapter, '') = COALESCE(_chapter, '')
      AND concept = _concept_f AND COALESCE(subconcept, '') = COALESCE(_subconcept, '')
  ) THEN
    SELECT id INTO _aid FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress')
      AND subject = _subject AND concept = _concept_f
    ORDER BY created_at DESC LIMIT 1;
    RETURN _aid;
  END IF;

  INSERT INTO public.recovery_assignments (
    user_id, student_id, subject, chapter, concept, subconcept,
    severity, question_count, source_type, source_id
  ) VALUES (
    _uid, _sid, _subject, _chapter, _concept_f, _subconcept,
    _severity, _cnt, _source_type, _source_id
  ) RETURNING id INTO _aid;

  FOR _qb IN
    SELECT id, question, options, correct_index, explanation
    FROM public.question_bank
    WHERE is_approved
      AND lower(subject) = lower(_subject)
      AND (_chapter IS NULL OR chapter ILIKE '%' || _chapter || '%' OR concept ILIKE '%' || _concept_f || '%')
      AND (concept ILIKE '%' || _concept_f || '%' OR topic ILIKE '%' || _concept_f || '%' OR chapter ILIKE '%' || _concept_f || '%')
    ORDER BY random() LIMIT _cnt
  LOOP
    _idx := _idx + 1;
    INSERT INTO public.recovery_assignment_questions (
      assignment_id, order_index, question_text, options, correct_answer, explanation, bank_question_id
    ) VALUES (
      _aid, _idx, _qb.question, _qb.options,
      jsonb_build_object('correct_index', _qb.correct_index),
      _qb.explanation, _qb.id
    );
  END LOOP;

  IF _idx < _cnt AND lower(_subject) LIKE '%math%' THEN
    FOR _tm IN
      SELECT id, chapter, template_type, explanation_template
      FROM public.question_templates
      WHERE is_active AND class = 12 AND lower(subject) = 'mathematics'
        AND (_chapter IS NULL OR chapter = _chapter)
        AND (concept = _concept_f OR subconcept ILIKE '%' || COALESCE(_subconcept, _concept_f) || '%')
      ORDER BY random() LIMIT (_cnt - _idx)
    LOOP
      _idx := _idx + 1;
      INSERT INTO public.recovery_assignment_questions (
        assignment_id, order_index, question_text, options, correct_answer, explanation, template_id
      ) VALUES (
        _aid, _idx,
        'Practice: ' || public._humanize_template_type(_tm.template_type) || ' (' || _tm.chapter || ')',
        '["Option A","Option B","Option C","Option D"]'::jsonb,
        '{"correct_index":0,"note":"Complete via Class 12 Math practice for full generated question"}'::jsonb,
        _tm.explanation_template, _tm.id
      );
    END LOOP;
  END IF;

  UPDATE public.recovery_assignments SET question_count = _idx WHERE id = _aid;

  IF NOT EXISTS (
    SELECT 1 FROM public.revision_queue
    WHERE user_id = _uid AND NOT completed
      AND subject = _subject AND COALESCE(topic, '') = _concept_f AND reason = 'concept_recovery'
  ) THEN
    INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
    VALUES (_uid, _sid, _subject, _chapter, _concept_f, 'concept_recovery', 95, CURRENT_DATE);
  END IF;

  RETURN _aid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_assign_concept_recovery(text, text, text, text, numeric, text, uuid) TO authenticated;

-- ── Read-only concept report builder (no side effects) ────────────────────────
CREATE OR REPLACE FUNCTION public._build_concept_recovery_report(
  _source_type text,
  _source_id uuid,
  _uid uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _total int := 0; _correct int := 0; _time_sec int := 0;
  _weak jsonb := '[]'::jsonb; _strong jsonb := '[]'::jsonb; _row record;
BEGIN

  IF _source_type = 'dpp_attempt' THEN
    SELECT att.correct_count, att.total_count, att.time_spent_sec
      INTO _correct, _total, _time_sec
    FROM public.dpp_attempts att WHERE att.id = _source_id AND att.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(dq.subject, d.subject, 'General') AS subject,
        COALESCE(dq.chapter, d.chapter) AS chapter,
        COALESCE(dq.concept, dq.subconcept, d.topic, d.chapter, d.subject) AS concept,
        dq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE da.is_correct)::int AS correct
      FROM public.dpp_answers da
      JOIN public.dpp_questions dq ON dq.id = da.question_id
      JOIN public.dpp_attempts att ON att.id = da.attempt_id
      JOIN public.dpps d ON d.id = att.dpp_id
      WHERE att.id = _source_id AND att.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'subconcept', _row.subconcept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1),
          'attempts', _row.attempts, 'correct', _row.correct
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter,
          'concept', _row.concept, 'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'battle_participant' THEN
    SELECT bp.correct_count, bp.answered_count,
           GREATEST(EXTRACT(EPOCH FROM (bp.finished_at - bp.joined_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.battle_participants bp WHERE bp.id = _source_id AND bp.user_id = _uid;

    FOR _row IN
      SELECT
        COALESCE(b.subject, 'General') AS subject,
        b.chapter,
        b.class_level,
        COALESCE(bq.concept, b.topic, b.chapter, b.subject) AS concept,
        bq.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE ba.is_correct)::int AS correct
      FROM public.battle_answers ba
      JOIN public.battle_questions bq ON bq.id = ba.question_id
      JOIN public.battle_participants bp ON bp.id = ba.participant_id
      JOIN public.battles b ON b.id = bp.battle_id
      WHERE bp.id = _source_id AND bp.user_id = _uid
      GROUP BY 1, 2, 3, 4, 5
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;

  ELSIF _source_type = 'practice_session' THEN
    SELECT ps.correct_count, ps.question_count,
           GREATEST(EXTRACT(EPOCH FROM (ps.finished_at - ps.created_at))::int, 0)
      INTO _correct, _total, _time_sec
    FROM public.practice_sessions ps WHERE ps.id = _source_id AND ps.user_id = _uid;

    FOR _row IN
      SELECT
        ps.subject,
        ps.chapter,
        COALESCE(qt.concept, qt.chapter) AS concept,
        qt.subconcept,
        count(*)::int AS attempts,
        count(*) FILTER (WHERE qa.is_correct)::int AS correct
      FROM public.question_attempts qa
      JOIN public.practice_sessions ps ON ps.id = qa.session_id
      JOIN public.question_templates qt ON qt.id = qa.template_id
      WHERE ps.id = _source_id AND ps.user_id = _uid
      GROUP BY 1, 2, 3, 4
    LOOP
      IF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) < 70 THEN
        _weak := _weak || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      ELSIF _row.attempts > 0 AND round(100.0 * _row.correct / _row.attempts, 1) >= 80 THEN
        _strong := _strong || jsonb_build_array(jsonb_build_object(
          'subject', _row.subject, 'chapter', _row.chapter, 'concept', _row.concept,
          'accuracy', round(100.0 * _row.correct / _row.attempts, 1)
        ));
      END IF;
    END LOOP;
  ELSE
    RAISE EXCEPTION 'Unknown source_type: %', _source_type;
  END IF;

  RETURN jsonb_build_object(
    'source_type', _source_type,
    'source_id', _source_id,
    'accuracy_pct', CASE WHEN _total > 0 THEN round(100.0 * _correct / _total, 1) ELSE 0 END,
    'correct_count', _correct,
    'total_count', _total,
    'time_sec', _time_sec,
    'time_minutes', round(COALESCE(_time_sec, 0) / 60.0, 1),
    'weak_concepts', _weak,
    'strong_concepts', _strong,
    'improvement_areas', (
      SELECT COALESCE(jsonb_agg(w->>'concept'), '[]'::jsonb)
      FROM jsonb_array_elements(_weak) w
    )
  );
END; $$;

-- Read-only report for result pages (safe to call on every view)
CREATE OR REPLACE FUNCTION public.rpc_get_concept_recovery_report(_source_type text, _source_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _report jsonb; _assignments jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _report := public._build_concept_recovery_report(_source_type, _source_id, _uid);

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'assignment_id', id, 'concept', concept, 'severity', severity, 'status', status
  )), '[]'::jsonb)
    INTO _assignments
  FROM public.recovery_assignments
  WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id;

  RETURN _report || jsonb_build_object('recovery_assignments', _assignments);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_get_concept_recovery_report(text, uuid) TO authenticated;

-- One-shot post-assessment: assign recovery + rebuild revision (idempotent per source)
CREATE OR REPLACE FUNCTION public.rpc_post_assessment_concept_analysis(
  _source_type text,
  _source_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _report jsonb;
  _weak jsonb; _w record; _aid uuid; _assignments jsonb := '[]'::jsonb;
  _already boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _sid FROM public.students WHERE user_id = _uid LIMIT 1;
  _report := public._build_concept_recovery_report(_source_type, _source_id, _uid);
  _weak := _report->'weak_concepts';

  SELECT EXISTS (
    SELECT 1 FROM public.recovery_assignments
    WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id
  ) INTO _already;

  IF NOT _already THEN
    FOR _w IN SELECT * FROM jsonb_to_recordset(_weak) AS x(
      subject text, chapter text, concept text, subconcept text, accuracy numeric
    ) LOOP
      _aid := public.rpc_assign_concept_recovery(
        _w.subject, _w.chapter, _w.concept, _w.subconcept,
        _w.accuracy, _source_type, _source_id
      );
      _assignments := _assignments || jsonb_build_array(jsonb_build_object(
        'assignment_id', _aid, 'concept', _w.concept,
        'severity', public._concept_severity(_w.accuracy)
      ));
    END LOOP;
    PERFORM public._rebuild_revision_queue(_uid, _sid);
  ELSE
    SELECT COALESCE(jsonb_agg(jsonb_build_object(
      'assignment_id', id, 'concept', concept, 'severity', severity
    )), '[]'::jsonb)
      INTO _assignments
    FROM public.recovery_assignments
    WHERE user_id = _uid AND source_type = _source_type AND source_id = _source_id;
  END IF;

  RETURN _report || jsonb_build_object('recovery_assignments', _assignments);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_post_assessment_concept_analysis(text, uuid) TO authenticated;

-- ── Recovery zone dashboard ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_recovery_zone()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _pending int; _weak jsonb; _mastery jsonb; _open jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT count(*)::int INTO _pending FROM public.recovery_assignments
  WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score, 'mistake_count', mistake_count, 'last_attempt_at', last_attempt_at
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _weak
  FROM public.concept_mastery
  WHERE user_id = _uid AND mastery_score < 60
  LIMIT 12;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score
  ) ORDER BY mastery_score DESC), '[]'::jsonb)
    INTO _mastery
  FROM public.concept_mastery
  WHERE user_id = _uid
  LIMIT 20;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', id, 'subject', subject, 'chapter', chapter, 'concept', concept,
    'severity', severity, 'status', status,
    'question_count', question_count, 'questions_completed', questions_completed,
    'created_at', created_at
  ) ORDER BY
    CASE severity WHEN 'severe' THEN 1 WHEN 'moderate' THEN 2 ELSE 3 END,
    created_at DESC), '[]'::jsonb)
    INTO _open
  FROM public.recovery_assignments
  WHERE user_id = _uid AND status IN ('pending', 'in_progress')
  LIMIT 15;

  RETURN jsonb_build_object(
    'pending_count', _pending,
    'weak_concepts', _weak,
    'mastery', _mastery,
    'open_assignments', _open
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_recovery_zone() TO authenticated;

-- ── Recovery session: load assignment ─────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_get_recovery_assignment(_assignment_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _a record; _questions jsonb;
BEGIN
  SELECT * INTO _a FROM public.recovery_assignments
  WHERE id = _assignment_id AND user_id = auth.uid();
  IF _a IS NULL THEN RAISE EXCEPTION 'Assignment not found'; END IF;

  IF _a.status = 'pending' THEN
    UPDATE public.recovery_assignments SET status = 'in_progress' WHERE id = _assignment_id;
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', q.id, 'order_index', q.order_index,
    'question_text', q.question_text, 'options', q.options,
    'answered', q.answered, 'is_correct', q.is_correct,
    'explanation', q.explanation
  ) ORDER BY q.order_index), '[]'::jsonb)
    INTO _questions
  FROM public.recovery_assignment_questions q
  WHERE q.assignment_id = _assignment_id;

  RETURN jsonb_build_object(
    'assignment', jsonb_build_object(
      'id', _a.id, 'subject', _a.subject, 'chapter', _a.chapter,
      'concept', _a.concept, 'subconcept', _a.subconcept,
      'severity', _a.severity, 'status', _a.status,
      'question_count', _a.question_count,
      'questions_completed', _a.questions_completed,
      'questions_correct', _a.questions_correct
    ),
    'questions', _questions
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_get_recovery_assignment(uuid) TO authenticated;

CREATE OR REPLACE FUNCTION public.rpc_submit_recovery_answer(
  _question_id uuid,
  _student_answer jsonb,
  _is_correct boolean
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _q record; _a record; _uid uuid := auth.uid(); _done boolean;
BEGIN
  SELECT q.*, a.user_id, a.student_id, a.subject, a.chapter, a.concept, a.subconcept, a.id AS assignment_id
    INTO _q
  FROM public.recovery_assignment_questions q
  JOIN public.recovery_assignments a ON a.id = q.assignment_id
  WHERE q.id = _question_id AND a.user_id = _uid;

  IF _q IS NULL THEN RAISE EXCEPTION 'Question not found'; END IF;

  UPDATE public.recovery_assignment_questions SET
    answered = true, is_correct = _is_correct, student_answer = _student_answer
  WHERE id = _question_id;

  UPDATE public.recovery_assignments SET
    questions_completed = questions_completed + 1,
    questions_correct = questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  WHERE id = _q.assignment_id
  RETURNING * INTO _a;

  PERFORM public._upsert_concept_mastery(
    _uid, _a.student_id, NULL, _a.subject, _a.chapter, _a.concept, _a.subconcept, _is_correct, true
  );

  SELECT count(*) = _a.question_count INTO _done
  FROM public.recovery_assignment_questions WHERE assignment_id = _q.assignment_id AND answered;

  IF _done THEN
    UPDATE public.recovery_assignments SET status = 'completed', completed_at = now() WHERE id = _q.assignment_id;
    PERFORM public._rebuild_revision_queue(_uid, _a.student_id);
  END IF;

  RETURN jsonb_build_object(
    'completed', _done,
    'questions_completed', _a.questions_completed + 1,
    'questions_correct', _a.questions_correct + CASE WHEN _is_correct THEN 1 ELSE 0 END
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_answer(uuid, jsonb, boolean) TO authenticated;

-- ── Student concept mastery list ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_concept_mastery()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _items jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'chapter', chapter, 'concept', concept, 'subconcept', subconcept,
    'mastery_score', mastery_score, 'total_attempts', total_attempts,
    'correct_attempts', correct_attempts, 'recovery_attempts', recovery_attempts,
    'mistake_count', mistake_count, 'last_attempt_at', last_attempt_at
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _items
  FROM public.concept_mastery WHERE user_id = _uid;
  RETURN jsonb_build_object('items', _items);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_student_concept_mastery() TO authenticated;

-- ── Patch DPP mistake capture with concepts ───────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_dpp_mistakes(_attempt_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _att record; _q record; _ans record; _prio int; _existing uuid;
  _concept text; _subconcept text;
BEGIN
  SELECT a.*, d.subject, d.chapter, d.topic INTO _att
  FROM public.dpp_attempts a JOIN public.dpps d ON d.id = a.dpp_id
  WHERE a.id = _attempt_id;
  IF _att IS NULL THEN RETURN; END IF;

  FOR _q IN SELECT * FROM public.dpp_questions WHERE dpp_id = _att.dpp_id LOOP
    SELECT * INTO _ans FROM public.dpp_answers WHERE attempt_id = _attempt_id AND question_id = _q.id;
    IF _ans IS NULL OR COALESCE(_ans.is_correct, false) THEN
      IF _ans IS NOT NULL THEN
        _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
        _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);
        PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
          COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
          _concept, _subconcept, true, false);
      END IF;
      CONTINUE;
    END IF;

    _concept := COALESCE(_q.concept, _q.subconcept, _att.topic, _att.chapter, _att.subject);
    _subconcept := COALESCE(_q.subconcept, _q.concept, _att.topic);

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _att.user_id, _att.student_id, 'dpp', _att.dpp_id, _q.id,
      _q.class_level, COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _att.topic, _concept, _subconcept, 'dpp',
      _q.question, _q.options, _ans.response, _q.correct, _q.explanation, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      student_answer = EXCLUDED.student_answer,
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_att.user_id, _att.student_id, _q.class_level,
      COALESCE(_q.subject, _att.subject, 'General'), COALESCE(_q.chapter, _att.chapter),
      _concept, _subconcept, false, false);

    SELECT p.priority INTO _prio
    FROM public._revision_topic_priority(
      _att.user_id, COALESCE(_att.subject, 'General'), _att.chapter, _concept, NULL
    ) p;

    SELECT id INTO _existing FROM public.revision_queue
    WHERE user_id = _att.user_id AND NOT completed
      AND subject = COALESCE(_att.subject, 'General')
      AND COALESCE(chapter, '') = COALESCE(_att.chapter, '')
      AND COALESCE(topic, '') = COALESCE(_concept, '')
    LIMIT 1;

    IF _existing IS NOT NULL THEN
      UPDATE public.revision_queue SET
        priority = GREATEST(priority, _prio), reason = 'dpp_wrong', due_date = LEAST(due_date, CURRENT_DATE)
      WHERE id = _existing;
    ELSE
      INSERT INTO public.revision_queue (user_id, student_id, subject, chapter, topic, reason, priority, due_date)
      VALUES (
        _att.user_id, _att.student_id,
        COALESCE(_att.subject, 'General'), _att.chapter, _concept,
        'dpp_wrong', _prio, CURRENT_DATE
      );
    END IF;
  END LOOP;
END; $$;

-- ── Patch battle mistake capture with concepts ────────────────────────────────
CREATE OR REPLACE FUNCTION public._capture_battle_mistakes(_participant_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _bp record; _ba record; _concept text; _subconcept text;
BEGIN
  SELECT bp.*, b.subject, b.chapter, b.topic, b.class_level
    INTO _bp
  FROM public.battle_participants bp
  JOIN public.battles b ON b.id = bp.battle_id
  WHERE bp.id = _participant_id;
  IF _bp IS NULL THEN RETURN; END IF;

  FOR _ba IN
    SELECT ba.*, bq.question, bq.options, bq.correct_index, bq.bank_question_id,
           bq.concept, bq.subconcept
    FROM public.battle_answers ba
    JOIN public.battle_questions bq ON bq.id = ba.question_id
    WHERE ba.participant_id = _participant_id
  LOOP
    _concept := COALESCE(_ba.concept, _bp.topic, _bp.chapter, _bp.subject);
    _subconcept := COALESCE(_ba.subconcept, _ba.concept, _bp.topic);

    IF _ba.is_correct THEN
      PERFORM public._upsert_concept_mastery(_bp.user_id, _bp.student_id, _bp.class_level,
        COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, true, false);
      CONTINUE;
    END IF;

    INSERT INTO public.student_mistakes (
      user_id, student_id, source, source_id, question_id,
      class_level, subject, chapter, topic, concept, subconcept, assessment_type,
      question_text, options, student_answer, correct_answer, explanation, times_wrong, last_wrong_at
    ) VALUES (
      _bp.user_id, _bp.student_id, 'battleground', _bp.battle_id, _ba.question_id,
      _bp.class_level, COALESCE(_bp.subject, 'General'), _bp.chapter, _bp.topic,
      _concept, _subconcept, 'battle',
      _ba.question, _ba.options,
      jsonb_build_object('selected_index', _ba.selected_index),
      jsonb_build_object('correct_index', _ba.correct_index),
      NULL, 1, now()
    )
    ON CONFLICT (user_id, source, question_id) WHERE question_id IS NOT NULL DO UPDATE SET
      times_wrong = student_mistakes.times_wrong + 1,
      last_wrong_at = now(),
      concept = EXCLUDED.concept,
      subconcept = EXCLUDED.subconcept,
      mastered = false;

    PERFORM public._upsert_concept_mastery(_bp.user_id, _bp.student_id, _bp.class_level,
      COALESCE(_bp.subject, 'General'), _bp.chapter, _concept, _subconcept, false, false);
  END LOOP;
END; $$;

-- ── Patch practice attempt recording ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_record_question_attempt(
  _session_id uuid,
  _template_id uuid,
  _generated_question jsonb,
  _correct_answer jsonb,
  _selected_answer jsonb DEFAULT NULL,
  _is_correct boolean DEFAULT NULL,
  _score numeric DEFAULT 0
)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _student uuid; _aid uuid; _tm record; _concept text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT id INTO _student FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT * INTO _tm FROM public.question_templates WHERE id = _template_id;
  _concept := COALESCE(_tm.concept, _tm.chapter);

  INSERT INTO public.question_attempts (
    session_id, student_id, user_id, template_id,
    generated_question, selected_answer, correct_answer, score, is_correct
  ) VALUES (
    _session_id, _student, _uid, _template_id,
    _generated_question, _selected_answer, _correct_answer, _score, _is_correct
  ) RETURNING id INTO _aid;

  IF _is_correct THEN
    UPDATE public.practice_sessions
      SET correct_count = correct_count + 1, score = score + COALESCE(_score, 1)
      WHERE id = _session_id AND user_id = _uid;
  ELSE
    PERFORM public.rpc_record_concept_mistake(
      'practice', _session_id, _aid,
      _tm.subject, _tm.chapter, _concept, _tm.subconcept, _tm.class,
      COALESCE(_generated_question->>'question', 'Practice question'),
      COALESCE(_generated_question->'options', '[]'::jsonb),
      COALESCE(_selected_answer, '{}'::jsonb),
      _correct_answer,
      _tm.explanation_template
    );
  END IF;

  PERFORM public._upsert_concept_mastery(_uid, _student, _tm.class, _tm.subject, _tm.chapter,
    _concept, _tm.subconcept, COALESCE(_is_correct, false), false);

  RETURN _aid;
END; $$;

-- ── Teacher concept analytics ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_teacher_concept_analytics(_class_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid(); _base jsonb;
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal')
     AND NOT public.teacher_teaches_class(_uid, _class_id) THEN
    RAISE EXCEPTION 'Not authorized';
  END IF;

  _base := public.rpc_teacher_class_insights(_class_id);

  RETURN _base || jsonb_build_object(
    'class_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', cm.subject, 'chapter', cm.chapter, 'concept', cm.concept,
        'avg_mastery', round(avg(cm.mastery_score), 1),
        'students', count(DISTINCT cm.user_id)
      ) ORDER BY avg(cm.mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 55
      GROUP BY cm.subject, cm.chapter, cm.concept
      LIMIT 10
    ),
    'student_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'student_id', s.id, 'name', s.full_name,
        'concept', cm.concept, 'subject', cm.subject,
        'mastery_score', cm.mastery_score
      ) ORDER BY cm.mastery_score ASC), '[]'::jsonb)
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id AND cm.mastery_score < 45
      LIMIT 20
    ),
    'recovery_completion_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE ra.status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments ra
      JOIN public.students s ON s.user_id = ra.user_id
      WHERE s.class_id = _class_id
    ),
    'mastery_distribution', (
      SELECT jsonb_build_object(
        'below_40', count(*) FILTER (WHERE cm.mastery_score < 40),
        '40_60', count(*) FILTER (WHERE cm.mastery_score >= 40 AND cm.mastery_score < 60),
        '60_80', count(*) FILTER (WHERE cm.mastery_score >= 60 AND cm.mastery_score < 80),
        'above_80', count(*) FILTER (WHERE cm.mastery_score >= 80)
      )
      FROM public.concept_mastery cm
      JOIN public.students s ON s.user_id = cm.user_id
      WHERE s.class_id = _class_id
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_teacher_concept_analytics(uuid) TO authenticated;

-- ── Parent concept analytics (no question detail) ─────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_parent_concept_analytics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _parent uuid := auth.uid(); _result jsonb := '[]'::jsonb; _child record;
BEGIN
  IF NOT public.has_role(_parent, 'parent') AND NOT public.has_role(_parent, 'admin') THEN
    RAISE EXCEPTION 'Parent only';
  END IF;

  FOR _child IN SELECT s.* FROM public.students s WHERE s.parent_user_id = _parent
  LOOP
    IF _child.user_id IS NULL THEN CONTINUE; END IF;
    _result := _result || jsonb_build_array(jsonb_build_object(
      'student_id', _child.id,
      'name', _child.full_name,
      'weak_areas', (
        SELECT COALESCE(jsonb_agg(jsonb_build_object(
          'subject', subject, 'concept', concept, 'mastery_score', mastery_score
        ) ORDER BY mastery_score ASC), '[]'::jsonb)
        FROM public.concept_mastery
        WHERE user_id = _child.user_id AND mastery_score < 55
        LIMIT 5
      ),
      'recovery_pending', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status IN ('pending', 'in_progress')
      ),
      'recovery_completed', (
        SELECT count(*)::int FROM public.recovery_assignments
        WHERE user_id = _child.user_id AND status = 'completed'
          AND completed_at >= now() - interval '30 days'
      ),
      'mastery_trend', (
        SELECT round(avg(mastery_score), 1) FROM public.concept_mastery WHERE user_id = _child.user_id
      )
    ));
  END LOOP;

  RETURN jsonb_build_object('children', _result);
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_parent_concept_analytics() TO authenticated;

-- ── Principal concept analytics ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_principal_concept_analytics()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _uid uuid := auth.uid();
BEGIN
  IF NOT public.has_role(_uid, 'admin') AND NOT public.has_role(_uid, 'principal') THEN
    RAISE EXCEPTION 'Principal or admin only';
  END IF;

  RETURN jsonb_build_object(
    'school_weak_concepts', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject, 'concept', concept,
        'avg_mastery', round(avg(mastery_score), 1),
        'students_affected', count(DISTINCT user_id)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      WHERE mastery_score < 50
      GROUP BY subject, concept
      LIMIT 12
    ),
    'subject_performance', (
      SELECT COALESCE(jsonb_agg(jsonb_build_object(
        'subject', subject,
        'avg_mastery', round(avg(mastery_score), 1),
        'concepts_tracked', count(*)
      ) ORDER BY avg(mastery_score) ASC), '[]'::jsonb)
      FROM public.concept_mastery
      GROUP BY subject
    ),
    'recovery_rate', (
      SELECT CASE WHEN count(*) > 0
        THEN round(100.0 * count(*) FILTER (WHERE status = 'completed') / count(*), 1)
        ELSE 0 END
      FROM public.recovery_assignments
    ),
    'recovery_participation', (
      SELECT count(DISTINCT user_id)::int FROM public.recovery_assignments
      WHERE created_at >= now() - interval '30 days'
    )
  );
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_principal_concept_analytics() TO authenticated;

-- ── Extend academic snapshot with recovery + mastery ──────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_academic_snapshot()
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid(); _s record; _xp record;
  _hw_pending int := 0; _hw_done int := 0; _dpp_open int := 0; _dpp_done int := 0;
  _weak jsonb; _strong jsonb; _rev jsonb; _mistakes int; _heat jsonb;
  _recovery_pending int := 0; _mastery_summary jsonb;
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

  SELECT count(*)::int INTO _recovery_pending FROM public.recovery_assignments
    WHERE user_id = _uid AND status IN ('pending', 'in_progress');

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'subject', subject, 'concept', concept, 'mastery_score', mastery_score
  ) ORDER BY mastery_score ASC), '[]'::jsonb)
    INTO _mastery_summary
  FROM public.concept_mastery WHERE user_id = _uid AND mastery_score < 60 LIMIT 5;

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
    'recovery_pending', _recovery_pending,
    'weak_concepts', _mastery_summary,
    'activity_heatmap', _heat,
    'exam_readiness', public._exam_readiness(_uid, _s.id)
  );
END; $$;


-- ========== class12_math_templates.sql (seed) ==========

-- Class 12 Mathematics template seed (idempotent)
DELETE FROM public.question_templates WHERE class = 12 AND subject = 'Mathematics';
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":0,"seed":1,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":1,"seed":2,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":2,"seed":3,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":3,"seed":4,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":4,"seed":5,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":5,"seed":6,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":6,"seed":7,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":7,"seed":8,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":8,"seed":9,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":9,"seed":10,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":10,"seed":11,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":11,"seed":12,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":12,"seed":13,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":13,"seed":14,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":14,"seed":15,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":15,"seed":16,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":16,"seed":17,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":17,"seed":18,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":18,"seed":19,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":19,"seed":20,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":20,"seed":21,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":21,"seed":22,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":22,"seed":23,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":23,"seed":24,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":24,"seed":25,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":25,"seed":26,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":26,"seed":27,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":27,"seed":28,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":28,"seed":29,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":29,"seed":30,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":30,"seed":31,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":31,"seed":32,"difficulty":"medium"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":32,"seed":33,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":33,"seed":34,"difficulty":"hard"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_composition_linear', '{"variant":34,"seed":35,"difficulty":"easy"}'::jsonb, 'Apply (f ∘ g)(x) = f(g(x)) step by step using NCERT composition rules.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":0,"seed":36,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":1,"seed":37,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":2,"seed":38,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":3,"seed":39,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":4,"seed":40,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":5,"seed":41,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":6,"seed":42,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":7,"seed":43,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":8,"seed":44,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":9,"seed":45,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":10,"seed":46,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":11,"seed":47,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":12,"seed":48,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":13,"seed":49,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":14,"seed":50,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":15,"seed":51,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":16,"seed":52,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":17,"seed":53,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":18,"seed":54,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":19,"seed":55,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":20,"seed":56,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":21,"seed":57,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":22,"seed":58,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":23,"seed":59,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":24,"seed":60,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":25,"seed":61,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":26,"seed":62,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":27,"seed":63,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":28,"seed":64,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":29,"seed":65,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":30,"seed":66,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":31,"seed":67,"difficulty":"medium"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":32,"seed":68,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":33,"seed":69,"difficulty":"hard"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_inverse_linear', '{"variant":34,"seed":70,"difficulty":"easy"}'::jsonb, 'To find f⁻¹, solve y = f(x) for x and interchange variables.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":0,"seed":71,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":1,"seed":72,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":2,"seed":73,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":3,"seed":74,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":4,"seed":75,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":5,"seed":76,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":6,"seed":77,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":7,"seed":78,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":8,"seed":79,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":9,"seed":80,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":10,"seed":81,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":11,"seed":82,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":12,"seed":83,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":13,"seed":84,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":14,"seed":85,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":15,"seed":86,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":16,"seed":87,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":17,"seed":88,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":18,"seed":89,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":19,"seed":90,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":20,"seed":91,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":21,"seed":92,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":22,"seed":93,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":23,"seed":94,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":24,"seed":95,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":25,"seed":96,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":26,"seed":97,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":27,"seed":98,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":28,"seed":99,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":29,"seed":100,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":30,"seed":101,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":31,"seed":102,"difficulty":"medium"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":32,"seed":103,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":33,"seed":104,"difficulty":"hard"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Relations and Functions', 'rf_bijective_check', '{"variant":34,"seed":105,"difficulty":"easy"}'::jsonb, 'Bijective ⇔ one-one and onto on the given domain.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":0,"seed":106,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":1,"seed":107,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":2,"seed":108,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":3,"seed":109,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":4,"seed":110,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":5,"seed":111,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":6,"seed":112,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":7,"seed":113,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":8,"seed":114,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":9,"seed":115,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":10,"seed":116,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":11,"seed":117,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":12,"seed":118,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":13,"seed":119,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":14,"seed":120,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":15,"seed":121,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":16,"seed":122,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":17,"seed":123,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":18,"seed":124,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":19,"seed":125,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":20,"seed":126,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":21,"seed":127,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":22,"seed":128,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":23,"seed":129,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":24,"seed":130,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":25,"seed":131,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":26,"seed":132,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":27,"seed":133,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":28,"seed":134,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":29,"seed":135,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":30,"seed":136,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":31,"seed":137,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":32,"seed":138,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":33,"seed":139,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":34,"seed":140,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":35,"seed":141,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":36,"seed":142,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":37,"seed":143,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":38,"seed":144,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":39,"seed":145,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":40,"seed":146,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":41,"seed":147,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":42,"seed":148,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":43,"seed":149,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":44,"seed":150,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":45,"seed":151,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":46,"seed":152,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":47,"seed":153,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":48,"seed":154,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":49,"seed":155,"difficulty":"medium"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":50,"seed":156,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":51,"seed":157,"difficulty":"hard"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_sin_inverse_value', '{"variant":52,"seed":158,"difficulty":"easy"}'::jsonb, 'Use principal value branch of sin⁻¹ as in NCERT Chapter 2.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":0,"seed":159,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":1,"seed":160,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":2,"seed":161,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":3,"seed":162,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":4,"seed":163,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":5,"seed":164,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":6,"seed":165,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":7,"seed":166,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":8,"seed":167,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":9,"seed":168,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":10,"seed":169,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":11,"seed":170,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":12,"seed":171,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":13,"seed":172,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":14,"seed":173,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":15,"seed":174,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":16,"seed":175,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":17,"seed":176,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":18,"seed":177,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":19,"seed":178,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":20,"seed":179,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":21,"seed":180,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":22,"seed":181,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":23,"seed":182,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":24,"seed":183,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":25,"seed":184,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":26,"seed":185,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":27,"seed":186,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":28,"seed":187,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":29,"seed":188,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":30,"seed":189,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":31,"seed":190,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":32,"seed":191,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":33,"seed":192,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":34,"seed":193,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":35,"seed":194,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":36,"seed":195,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":37,"seed":196,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":38,"seed":197,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":39,"seed":198,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":40,"seed":199,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":41,"seed":200,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":42,"seed":201,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":43,"seed":202,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":44,"seed":203,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":45,"seed":204,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":46,"seed":205,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":47,"seed":206,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":48,"seed":207,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":49,"seed":208,"difficulty":"medium"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":50,"seed":209,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":51,"seed":210,"difficulty":"hard"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Inverse Trigonometric Functions', 'itg_composite_sin', '{"variant":52,"seed":211,"difficulty":"easy"}'::jsonb, 'Simplify using domain restrictions of inverse trigonometric functions.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":0,"seed":212,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":1,"seed":213,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":2,"seed":214,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":3,"seed":215,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":4,"seed":216,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":5,"seed":217,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":6,"seed":218,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":7,"seed":219,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":8,"seed":220,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":9,"seed":221,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":10,"seed":222,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":11,"seed":223,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":12,"seed":224,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":13,"seed":225,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":14,"seed":226,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":15,"seed":227,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":16,"seed":228,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":17,"seed":229,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":18,"seed":230,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":19,"seed":231,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":20,"seed":232,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":21,"seed":233,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":22,"seed":234,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":23,"seed":235,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":24,"seed":236,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":25,"seed":237,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":26,"seed":238,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":27,"seed":239,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":28,"seed":240,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":29,"seed":241,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":30,"seed":242,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":31,"seed":243,"difficulty":"medium"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":32,"seed":244,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":33,"seed":245,"difficulty":"hard"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_add_2x2', '{"variant":34,"seed":246,"difficulty":"easy"}'::jsonb, 'Matrix addition is element-wise for matrices of the same order.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":0,"seed":247,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":1,"seed":248,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":2,"seed":249,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":3,"seed":250,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":4,"seed":251,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":5,"seed":252,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":6,"seed":253,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":7,"seed":254,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":8,"seed":255,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":9,"seed":256,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":10,"seed":257,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":11,"seed":258,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":12,"seed":259,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":13,"seed":260,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":14,"seed":261,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":15,"seed":262,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":16,"seed":263,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":17,"seed":264,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":18,"seed":265,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":19,"seed":266,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":20,"seed":267,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":21,"seed":268,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":22,"seed":269,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":23,"seed":270,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":24,"seed":271,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":25,"seed":272,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":26,"seed":273,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":27,"seed":274,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":28,"seed":275,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":29,"seed":276,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":30,"seed":277,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":31,"seed":278,"difficulty":"medium"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":32,"seed":279,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":33,"seed":280,"difficulty":"hard"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_multiply_2x2', '{"variant":34,"seed":281,"difficulty":"easy"}'::jsonb, 'Use row×column rule for matrix multiplication.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":0,"seed":282,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":1,"seed":283,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":2,"seed":284,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":3,"seed":285,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":4,"seed":286,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":5,"seed":287,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":6,"seed":288,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":7,"seed":289,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":8,"seed":290,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":9,"seed":291,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":10,"seed":292,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":11,"seed":293,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":12,"seed":294,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":13,"seed":295,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":14,"seed":296,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":15,"seed":297,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":16,"seed":298,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":17,"seed":299,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":18,"seed":300,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":19,"seed":301,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":20,"seed":302,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":21,"seed":303,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":22,"seed":304,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":23,"seed":305,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":24,"seed":306,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":25,"seed":307,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":26,"seed":308,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":27,"seed":309,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":28,"seed":310,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":29,"seed":311,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":30,"seed":312,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":31,"seed":313,"difficulty":"medium"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":32,"seed":314,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":33,"seed":315,"difficulty":"hard"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Matrices', 'mat_transpose', '{"variant":34,"seed":316,"difficulty":"easy"}'::jsonb, 'Transpose reflects entries across the main diagonal.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":0,"seed":317,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":1,"seed":318,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":2,"seed":319,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":3,"seed":320,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":4,"seed":321,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":5,"seed":322,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":6,"seed":323,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":7,"seed":324,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":8,"seed":325,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":9,"seed":326,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":10,"seed":327,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":11,"seed":328,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":12,"seed":329,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":13,"seed":330,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":14,"seed":331,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":15,"seed":332,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":16,"seed":333,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":17,"seed":334,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":18,"seed":335,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":19,"seed":336,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":20,"seed":337,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":21,"seed":338,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":22,"seed":339,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":23,"seed":340,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":24,"seed":341,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":25,"seed":342,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":26,"seed":343,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":27,"seed":344,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":28,"seed":345,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":29,"seed":346,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":30,"seed":347,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":31,"seed":348,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":32,"seed":349,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":33,"seed":350,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":34,"seed":351,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":35,"seed":352,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":36,"seed":353,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":37,"seed":354,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":38,"seed":355,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":39,"seed":356,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":40,"seed":357,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":41,"seed":358,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":42,"seed":359,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":43,"seed":360,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":44,"seed":361,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":45,"seed":362,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":46,"seed":363,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":47,"seed":364,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":48,"seed":365,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":49,"seed":366,"difficulty":"medium"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":50,"seed":367,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":51,"seed":368,"difficulty":"hard"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_2x2', '{"variant":52,"seed":369,"difficulty":"easy"}'::jsonb, 'Determinant of [a b; c d] equals ad − bc.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":0,"seed":370,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":1,"seed":371,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":2,"seed":372,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":3,"seed":373,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":4,"seed":374,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":5,"seed":375,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":6,"seed":376,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":7,"seed":377,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":8,"seed":378,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":9,"seed":379,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":10,"seed":380,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":11,"seed":381,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":12,"seed":382,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":13,"seed":383,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":14,"seed":384,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":15,"seed":385,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":16,"seed":386,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":17,"seed":387,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":18,"seed":388,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":19,"seed":389,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":20,"seed":390,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":21,"seed":391,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":22,"seed":392,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":23,"seed":393,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":24,"seed":394,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":25,"seed":395,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":26,"seed":396,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":27,"seed":397,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":28,"seed":398,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":29,"seed":399,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":30,"seed":400,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":31,"seed":401,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":32,"seed":402,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":33,"seed":403,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":34,"seed":404,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":35,"seed":405,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":36,"seed":406,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":37,"seed":407,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":38,"seed":408,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":39,"seed":409,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":40,"seed":410,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":41,"seed":411,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":42,"seed":412,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":43,"seed":413,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":44,"seed":414,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":45,"seed":415,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":46,"seed":416,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":47,"seed":417,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":48,"seed":418,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":49,"seed":419,"difficulty":"medium"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":50,"seed":420,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":51,"seed":421,"difficulty":"hard"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Determinants', 'det_3x3_simple', '{"variant":52,"seed":422,"difficulty":"easy"}'::jsonb, 'For diagonal matrices, determinant is product of diagonal elements.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":0,"seed":423,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":1,"seed":424,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":2,"seed":425,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":3,"seed":426,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":4,"seed":427,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":5,"seed":428,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":6,"seed":429,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":7,"seed":430,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":8,"seed":431,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":9,"seed":432,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":10,"seed":433,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":11,"seed":434,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":12,"seed":435,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":13,"seed":436,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":14,"seed":437,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":15,"seed":438,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":16,"seed":439,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":17,"seed":440,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":18,"seed":441,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":19,"seed":442,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":20,"seed":443,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":21,"seed":444,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":22,"seed":445,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":23,"seed":446,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":24,"seed":447,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":25,"seed":448,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":26,"seed":449,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":27,"seed":450,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":28,"seed":451,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":29,"seed":452,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":30,"seed":453,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":31,"seed":454,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":32,"seed":455,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":33,"seed":456,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":34,"seed":457,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":35,"seed":458,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":36,"seed":459,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":37,"seed":460,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":38,"seed":461,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":39,"seed":462,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":40,"seed":463,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":41,"seed":464,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":42,"seed":465,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":43,"seed":466,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":44,"seed":467,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":45,"seed":468,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":46,"seed":469,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":47,"seed":470,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":48,"seed":471,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":49,"seed":472,"difficulty":"medium"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":50,"seed":473,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":51,"seed":474,"difficulty":"hard"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'cont_limit_poly', '{"variant":52,"seed":475,"difficulty":"easy"}'::jsonb, 'Polynomial functions are continuous; direct substitution gives the limit.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":0,"seed":476,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":1,"seed":477,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":2,"seed":478,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":3,"seed":479,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":4,"seed":480,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":5,"seed":481,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":6,"seed":482,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":7,"seed":483,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":8,"seed":484,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":9,"seed":485,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":10,"seed":486,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":11,"seed":487,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":12,"seed":488,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":13,"seed":489,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":14,"seed":490,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":15,"seed":491,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":16,"seed":492,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":17,"seed":493,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":18,"seed":494,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":19,"seed":495,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":20,"seed":496,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":21,"seed":497,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":22,"seed":498,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":23,"seed":499,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":24,"seed":500,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":25,"seed":501,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":26,"seed":502,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":27,"seed":503,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":28,"seed":504,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":29,"seed":505,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":30,"seed":506,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":31,"seed":507,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":32,"seed":508,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":33,"seed":509,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":34,"seed":510,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":35,"seed":511,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":36,"seed":512,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":37,"seed":513,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":38,"seed":514,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":39,"seed":515,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":40,"seed":516,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":41,"seed":517,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":42,"seed":518,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":43,"seed":519,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":44,"seed":520,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":45,"seed":521,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":46,"seed":522,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":47,"seed":523,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":48,"seed":524,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":49,"seed":525,"difficulty":"medium"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":50,"seed":526,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":51,"seed":527,"difficulty":"hard"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Continuity and Differentiability', 'diff_power_rule', '{"variant":52,"seed":528,"difficulty":"easy"}'::jsonb, 'Apply d/dx(x^n) = n·x^(n−1).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":0,"seed":529,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":1,"seed":530,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":2,"seed":531,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":3,"seed":532,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":4,"seed":533,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":5,"seed":534,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":6,"seed":535,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":7,"seed":536,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":8,"seed":537,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":9,"seed":538,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":10,"seed":539,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":11,"seed":540,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":12,"seed":541,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":13,"seed":542,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":14,"seed":543,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":15,"seed":544,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":16,"seed":545,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":17,"seed":546,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":18,"seed":547,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":19,"seed":548,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":20,"seed":549,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":21,"seed":550,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":22,"seed":551,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":23,"seed":552,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":24,"seed":553,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":25,"seed":554,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":26,"seed":555,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":27,"seed":556,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":28,"seed":557,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":29,"seed":558,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":30,"seed":559,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":31,"seed":560,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":32,"seed":561,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":33,"seed":562,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":34,"seed":563,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":35,"seed":564,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":36,"seed":565,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":37,"seed":566,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":38,"seed":567,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":39,"seed":568,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":40,"seed":569,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":41,"seed":570,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":42,"seed":571,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":43,"seed":572,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":44,"seed":573,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":45,"seed":574,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":46,"seed":575,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":47,"seed":576,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":48,"seed":577,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":49,"seed":578,"difficulty":"medium"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":50,"seed":579,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":51,"seed":580,"difficulty":"hard"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_critical_cubic', '{"variant":52,"seed":581,"difficulty":"easy"}'::jsonb, 'Critical points satisfy f′(x) = 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":0,"seed":582,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":1,"seed":583,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":2,"seed":584,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":3,"seed":585,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":4,"seed":586,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":5,"seed":587,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":6,"seed":588,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":7,"seed":589,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":8,"seed":590,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":9,"seed":591,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":10,"seed":592,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":11,"seed":593,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":12,"seed":594,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":13,"seed":595,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":14,"seed":596,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":15,"seed":597,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":16,"seed":598,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":17,"seed":599,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":18,"seed":600,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":19,"seed":601,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":20,"seed":602,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":21,"seed":603,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":22,"seed":604,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":23,"seed":605,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":24,"seed":606,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":25,"seed":607,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":26,"seed":608,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":27,"seed":609,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":28,"seed":610,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":29,"seed":611,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":30,"seed":612,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":31,"seed":613,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":32,"seed":614,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":33,"seed":615,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":34,"seed":616,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":35,"seed":617,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":36,"seed":618,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":37,"seed":619,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":38,"seed":620,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":39,"seed":621,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":40,"seed":622,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":41,"seed":623,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":42,"seed":624,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":43,"seed":625,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":44,"seed":626,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":45,"seed":627,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":46,"seed":628,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":47,"seed":629,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":48,"seed":630,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":49,"seed":631,"difficulty":"medium"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":50,"seed":632,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":51,"seed":633,"difficulty":"hard"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Derivatives', 'appd_increasing_interval', '{"variant":52,"seed":634,"difficulty":"easy"}'::jsonb, 'f increases where f′(x) > 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":0,"seed":635,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":1,"seed":636,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":2,"seed":637,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":3,"seed":638,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":4,"seed":639,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":5,"seed":640,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":6,"seed":641,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":7,"seed":642,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":8,"seed":643,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":9,"seed":644,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":10,"seed":645,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":11,"seed":646,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":12,"seed":647,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":13,"seed":648,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":14,"seed":649,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":15,"seed":650,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":16,"seed":651,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":17,"seed":652,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":18,"seed":653,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":19,"seed":654,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":20,"seed":655,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":21,"seed":656,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":22,"seed":657,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":23,"seed":658,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":24,"seed":659,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":25,"seed":660,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":26,"seed":661,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":27,"seed":662,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":28,"seed":663,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":29,"seed":664,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":30,"seed":665,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":31,"seed":666,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":32,"seed":667,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":33,"seed":668,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":34,"seed":669,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":35,"seed":670,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":36,"seed":671,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":37,"seed":672,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":38,"seed":673,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":39,"seed":674,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":40,"seed":675,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":41,"seed":676,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":42,"seed":677,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":43,"seed":678,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":44,"seed":679,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":45,"seed":680,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":46,"seed":681,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":47,"seed":682,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":48,"seed":683,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":49,"seed":684,"difficulty":"medium"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":50,"seed":685,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":51,"seed":686,"difficulty":"hard"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_power', '{"variant":52,"seed":687,"difficulty":"easy"}'::jsonb, 'Use ∫x^n dx = x^(n+1)/(n+1) + C.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":0,"seed":688,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":1,"seed":689,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":2,"seed":690,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":3,"seed":691,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":4,"seed":692,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":5,"seed":693,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":6,"seed":694,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":7,"seed":695,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":8,"seed":696,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":9,"seed":697,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":10,"seed":698,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":11,"seed":699,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":12,"seed":700,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":13,"seed":701,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":14,"seed":702,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":15,"seed":703,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":16,"seed":704,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":17,"seed":705,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":18,"seed":706,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":19,"seed":707,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":20,"seed":708,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":21,"seed":709,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":22,"seed":710,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":23,"seed":711,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":24,"seed":712,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":25,"seed":713,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":26,"seed":714,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":27,"seed":715,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":28,"seed":716,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":29,"seed":717,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":30,"seed":718,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":31,"seed":719,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":32,"seed":720,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":33,"seed":721,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":34,"seed":722,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":35,"seed":723,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":36,"seed":724,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":37,"seed":725,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":38,"seed":726,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":39,"seed":727,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":40,"seed":728,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":41,"seed":729,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":42,"seed":730,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":43,"seed":731,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":44,"seed":732,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":45,"seed":733,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":46,"seed":734,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":47,"seed":735,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":48,"seed":736,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":49,"seed":737,"difficulty":"medium"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":50,"seed":738,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":51,"seed":739,"difficulty":"hard"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Integrals', 'int_trig', '{"variant":52,"seed":740,"difficulty":"easy"}'::jsonb, 'Memorise standard integrals of sin and cos.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":0,"seed":741,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":1,"seed":742,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":2,"seed":743,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":3,"seed":744,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":4,"seed":745,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":5,"seed":746,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":6,"seed":747,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":7,"seed":748,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":8,"seed":749,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":9,"seed":750,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":10,"seed":751,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":11,"seed":752,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":12,"seed":753,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":13,"seed":754,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":14,"seed":755,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":15,"seed":756,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":16,"seed":757,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":17,"seed":758,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":18,"seed":759,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":19,"seed":760,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":20,"seed":761,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":21,"seed":762,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":22,"seed":763,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":23,"seed":764,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":24,"seed":765,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":25,"seed":766,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":26,"seed":767,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":27,"seed":768,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":28,"seed":769,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":29,"seed":770,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":30,"seed":771,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":31,"seed":772,"difficulty":"medium"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":32,"seed":773,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":33,"seed":774,"difficulty":"hard"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_under_parabola', '{"variant":34,"seed":775,"difficulty":"easy"}'::jsonb, 'Definite integral gives area under curve for x ≥ 0.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":0,"seed":776,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":1,"seed":777,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":2,"seed":778,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":3,"seed":779,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":4,"seed":780,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":5,"seed":781,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":6,"seed":782,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":7,"seed":783,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":8,"seed":784,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":9,"seed":785,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":10,"seed":786,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":11,"seed":787,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":12,"seed":788,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":13,"seed":789,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":14,"seed":790,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":15,"seed":791,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":16,"seed":792,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":17,"seed":793,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":18,"seed":794,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":19,"seed":795,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":20,"seed":796,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":21,"seed":797,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":22,"seed":798,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":23,"seed":799,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":24,"seed":800,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":25,"seed":801,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":26,"seed":802,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":27,"seed":803,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":28,"seed":804,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":29,"seed":805,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":30,"seed":806,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":31,"seed":807,"difficulty":"medium"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":32,"seed":808,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":33,"seed":809,"difficulty":"hard"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_area_line', '{"variant":34,"seed":810,"difficulty":"easy"}'::jsonb, 'Area under a line y = mx is a triangle/trapezoid integral.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":0,"seed":811,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":1,"seed":812,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":2,"seed":813,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":3,"seed":814,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":4,"seed":815,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":5,"seed":816,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":6,"seed":817,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":7,"seed":818,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":8,"seed":819,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":9,"seed":820,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":10,"seed":821,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":11,"seed":822,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":12,"seed":823,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":13,"seed":824,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":14,"seed":825,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":15,"seed":826,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":16,"seed":827,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":17,"seed":828,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":18,"seed":829,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":19,"seed":830,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":20,"seed":831,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":21,"seed":832,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":22,"seed":833,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":23,"seed":834,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":24,"seed":835,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":25,"seed":836,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":26,"seed":837,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":27,"seed":838,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":28,"seed":839,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":29,"seed":840,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":30,"seed":841,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":31,"seed":842,"difficulty":"medium"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":32,"seed":843,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":33,"seed":844,"difficulty":"hard"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Applications of Integrals', 'aint_between_curves', '{"variant":34,"seed":845,"difficulty":"easy"}'::jsonb, 'Area between curves = ∫ (upper − lower) dx on the interval.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":0,"seed":846,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":1,"seed":847,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":2,"seed":848,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":3,"seed":849,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":4,"seed":850,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":5,"seed":851,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":6,"seed":852,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":7,"seed":853,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":8,"seed":854,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":9,"seed":855,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":10,"seed":856,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":11,"seed":857,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":12,"seed":858,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":13,"seed":859,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":14,"seed":860,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":15,"seed":861,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":16,"seed":862,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":17,"seed":863,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":18,"seed":864,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":19,"seed":865,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":20,"seed":866,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":21,"seed":867,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":22,"seed":868,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":23,"seed":869,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":24,"seed":870,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":25,"seed":871,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":26,"seed":872,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":27,"seed":873,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":28,"seed":874,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":29,"seed":875,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":30,"seed":876,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":31,"seed":877,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":32,"seed":878,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":33,"seed":879,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":34,"seed":880,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":35,"seed":881,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":36,"seed":882,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":37,"seed":883,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":38,"seed":884,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":39,"seed":885,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":40,"seed":886,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":41,"seed":887,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":42,"seed":888,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":43,"seed":889,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":44,"seed":890,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":45,"seed":891,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":46,"seed":892,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":47,"seed":893,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":48,"seed":894,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":49,"seed":895,"difficulty":"medium"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":50,"seed":896,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":51,"seed":897,"difficulty":"hard"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_order_degree', '{"variant":52,"seed":898,"difficulty":"easy"}'::jsonb, 'Identify highest derivative and its power.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":0,"seed":899,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":1,"seed":900,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":2,"seed":901,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":3,"seed":902,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":4,"seed":903,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":5,"seed":904,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":6,"seed":905,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":7,"seed":906,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":8,"seed":907,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":9,"seed":908,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":10,"seed":909,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":11,"seed":910,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":12,"seed":911,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":13,"seed":912,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":14,"seed":913,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":15,"seed":914,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":16,"seed":915,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":17,"seed":916,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":18,"seed":917,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":19,"seed":918,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":20,"seed":919,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":21,"seed":920,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":22,"seed":921,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":23,"seed":922,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":24,"seed":923,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":25,"seed":924,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":26,"seed":925,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":27,"seed":926,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":28,"seed":927,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":29,"seed":928,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":30,"seed":929,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":31,"seed":930,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":32,"seed":931,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":33,"seed":932,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":34,"seed":933,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":35,"seed":934,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":36,"seed":935,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":37,"seed":936,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":38,"seed":937,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":39,"seed":938,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":40,"seed":939,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":41,"seed":940,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":42,"seed":941,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":43,"seed":942,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":44,"seed":943,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":45,"seed":944,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":46,"seed":945,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":47,"seed":946,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":48,"seed":947,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":49,"seed":948,"difficulty":"medium"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":50,"seed":949,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":51,"seed":950,"difficulty":"hard"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Differential Equations', 'de_separable', '{"variant":52,"seed":951,"difficulty":"easy"}'::jsonb, 'Separate variables and integrate both sides.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":0,"seed":952,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":1,"seed":953,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":2,"seed":954,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":3,"seed":955,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":4,"seed":956,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":5,"seed":957,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":6,"seed":958,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":7,"seed":959,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":8,"seed":960,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":9,"seed":961,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":10,"seed":962,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":11,"seed":963,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":12,"seed":964,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":13,"seed":965,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":14,"seed":966,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":15,"seed":967,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":16,"seed":968,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":17,"seed":969,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":18,"seed":970,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":19,"seed":971,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":20,"seed":972,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":21,"seed":973,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":22,"seed":974,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":23,"seed":975,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":24,"seed":976,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":25,"seed":977,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":26,"seed":978,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":27,"seed":979,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":28,"seed":980,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":29,"seed":981,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":30,"seed":982,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":31,"seed":983,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":32,"seed":984,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":33,"seed":985,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":34,"seed":986,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":35,"seed":987,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":36,"seed":988,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":37,"seed":989,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":38,"seed":990,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":39,"seed":991,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":40,"seed":992,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":41,"seed":993,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":42,"seed":994,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":43,"seed":995,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":44,"seed":996,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":45,"seed":997,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":46,"seed":998,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":47,"seed":999,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":48,"seed":1000,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":49,"seed":1001,"difficulty":"medium"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":50,"seed":1002,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":51,"seed":1003,"difficulty":"hard"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_dot', '{"variant":52,"seed":1004,"difficulty":"easy"}'::jsonb, 'Scalar (dot) product sums products of corresponding components.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":0,"seed":1005,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":1,"seed":1006,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":2,"seed":1007,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":3,"seed":1008,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":4,"seed":1009,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":5,"seed":1010,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":6,"seed":1011,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":7,"seed":1012,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":8,"seed":1013,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":9,"seed":1014,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":10,"seed":1015,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":11,"seed":1016,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":12,"seed":1017,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":13,"seed":1018,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":14,"seed":1019,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":15,"seed":1020,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":16,"seed":1021,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":17,"seed":1022,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":18,"seed":1023,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":19,"seed":1024,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":20,"seed":1025,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":21,"seed":1026,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":22,"seed":1027,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":23,"seed":1028,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":24,"seed":1029,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":25,"seed":1030,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":26,"seed":1031,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":27,"seed":1032,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":28,"seed":1033,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":29,"seed":1034,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":30,"seed":1035,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":31,"seed":1036,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":32,"seed":1037,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":33,"seed":1038,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":34,"seed":1039,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":35,"seed":1040,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":36,"seed":1041,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":37,"seed":1042,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":38,"seed":1043,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":39,"seed":1044,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":40,"seed":1045,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":41,"seed":1046,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":42,"seed":1047,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":43,"seed":1048,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":44,"seed":1049,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":45,"seed":1050,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":46,"seed":1051,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":47,"seed":1052,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":48,"seed":1053,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":49,"seed":1054,"difficulty":"medium"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":50,"seed":1055,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":51,"seed":1056,"difficulty":"hard"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Vector Algebra', 'vec_magnitude', '{"variant":52,"seed":1057,"difficulty":"easy"}'::jsonb, 'Modulus of ai + bj + ck is √(a² + b² + c²).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":0,"seed":1058,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":1,"seed":1059,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":2,"seed":1060,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":3,"seed":1061,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":4,"seed":1062,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":5,"seed":1063,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":6,"seed":1064,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":7,"seed":1065,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":8,"seed":1066,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":9,"seed":1067,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":10,"seed":1068,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":11,"seed":1069,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":12,"seed":1070,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":13,"seed":1071,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":14,"seed":1072,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":15,"seed":1073,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":16,"seed":1074,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":17,"seed":1075,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":18,"seed":1076,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":19,"seed":1077,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":20,"seed":1078,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":21,"seed":1079,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":22,"seed":1080,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":23,"seed":1081,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":24,"seed":1082,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":25,"seed":1083,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":26,"seed":1084,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":27,"seed":1085,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":28,"seed":1086,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":29,"seed":1087,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":30,"seed":1088,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":31,"seed":1089,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":32,"seed":1090,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":33,"seed":1091,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":34,"seed":1092,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":35,"seed":1093,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":36,"seed":1094,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":37,"seed":1095,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":38,"seed":1096,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":39,"seed":1097,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":40,"seed":1098,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":41,"seed":1099,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":42,"seed":1100,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":43,"seed":1101,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":44,"seed":1102,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":45,"seed":1103,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":46,"seed":1104,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":47,"seed":1105,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":48,"seed":1106,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":49,"seed":1107,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":50,"seed":1108,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":51,"seed":1109,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":52,"seed":1110,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":53,"seed":1111,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":54,"seed":1112,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":55,"seed":1113,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":56,"seed":1114,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":57,"seed":1115,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":58,"seed":1116,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":59,"seed":1117,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":60,"seed":1118,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":61,"seed":1119,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":62,"seed":1120,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":63,"seed":1121,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":64,"seed":1122,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":65,"seed":1123,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":66,"seed":1124,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":67,"seed":1125,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":68,"seed":1126,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":69,"seed":1127,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":70,"seed":1128,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":71,"seed":1129,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":72,"seed":1130,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":73,"seed":1131,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":74,"seed":1132,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":75,"seed":1133,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":76,"seed":1134,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":77,"seed":1135,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":78,"seed":1136,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":79,"seed":1137,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":80,"seed":1138,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":81,"seed":1139,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":82,"seed":1140,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":83,"seed":1141,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":84,"seed":1142,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":85,"seed":1143,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":86,"seed":1144,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":87,"seed":1145,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":88,"seed":1146,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":89,"seed":1147,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":90,"seed":1148,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":91,"seed":1149,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":92,"seed":1150,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":93,"seed":1151,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":94,"seed":1152,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":95,"seed":1153,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":96,"seed":1154,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":97,"seed":1155,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":98,"seed":1156,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":99,"seed":1157,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":100,"seed":1158,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":101,"seed":1159,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":102,"seed":1160,"difficulty":"hard"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":103,"seed":1161,"difficulty":"medium"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Three Dimensional Geometry', 'geo3d_distance', '{"variant":104,"seed":1162,"difficulty":"easy"}'::jsonb, 'Use 3D distance formula between two points.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":0,"seed":1163,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":1,"seed":1164,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":2,"seed":1165,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":3,"seed":1166,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":4,"seed":1167,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":5,"seed":1168,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":6,"seed":1169,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":7,"seed":1170,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":8,"seed":1171,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":9,"seed":1172,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":10,"seed":1173,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":11,"seed":1174,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":12,"seed":1175,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":13,"seed":1176,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":14,"seed":1177,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":15,"seed":1178,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":16,"seed":1179,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":17,"seed":1180,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":18,"seed":1181,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":19,"seed":1182,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":20,"seed":1183,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":21,"seed":1184,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":22,"seed":1185,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":23,"seed":1186,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":24,"seed":1187,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":25,"seed":1188,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":26,"seed":1189,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":27,"seed":1190,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":28,"seed":1191,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":29,"seed":1192,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":30,"seed":1193,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":31,"seed":1194,"difficulty":"medium"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":32,"seed":1195,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":33,"seed":1196,"difficulty":"hard"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_corner_max', '{"variant":34,"seed":1197,"difficulty":"easy"}'::jsonb, 'Linear programming optimum occurs at a corner of the feasible region.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":0,"seed":1198,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":1,"seed":1199,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":2,"seed":1200,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":3,"seed":1201,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":4,"seed":1202,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":5,"seed":1203,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":6,"seed":1204,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":7,"seed":1205,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":8,"seed":1206,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":9,"seed":1207,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":10,"seed":1208,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":11,"seed":1209,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":12,"seed":1210,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":13,"seed":1211,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":14,"seed":1212,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":15,"seed":1213,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":16,"seed":1214,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":17,"seed":1215,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":18,"seed":1216,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":19,"seed":1217,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":20,"seed":1218,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":21,"seed":1219,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":22,"seed":1220,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":23,"seed":1221,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":24,"seed":1222,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":25,"seed":1223,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":26,"seed":1224,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":27,"seed":1225,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":28,"seed":1226,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":29,"seed":1227,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":30,"seed":1228,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":31,"seed":1229,"difficulty":"medium"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":32,"seed":1230,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":33,"seed":1231,"difficulty":"hard"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_feasible_region', '{"variant":34,"seed":1232,"difficulty":"easy"}'::jsonb, 'Check all constraints for a feasible point.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":0,"seed":1233,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":1,"seed":1234,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":2,"seed":1235,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":3,"seed":1236,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":4,"seed":1237,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":5,"seed":1238,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":6,"seed":1239,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":7,"seed":1240,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":8,"seed":1241,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":9,"seed":1242,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":10,"seed":1243,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":11,"seed":1244,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":12,"seed":1245,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":13,"seed":1246,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":14,"seed":1247,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":15,"seed":1248,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":16,"seed":1249,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":17,"seed":1250,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":18,"seed":1251,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":19,"seed":1252,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":20,"seed":1253,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":21,"seed":1254,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":22,"seed":1255,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":23,"seed":1256,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":24,"seed":1257,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":25,"seed":1258,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":26,"seed":1259,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":27,"seed":1260,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":28,"seed":1261,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":29,"seed":1262,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":30,"seed":1263,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":31,"seed":1264,"difficulty":"medium"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":32,"seed":1265,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":33,"seed":1266,"difficulty":"hard"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Linear Programming', 'lp_minimize', '{"variant":34,"seed":1267,"difficulty":"easy"}'::jsonb, 'Compare objective value at corner points including origin.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":0,"seed":1268,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":1,"seed":1269,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":2,"seed":1270,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":3,"seed":1271,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":4,"seed":1272,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":5,"seed":1273,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":6,"seed":1274,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":7,"seed":1275,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":8,"seed":1276,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":9,"seed":1277,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":10,"seed":1278,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":11,"seed":1279,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":12,"seed":1280,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":13,"seed":1281,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":14,"seed":1282,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":15,"seed":1283,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":16,"seed":1284,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":17,"seed":1285,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":18,"seed":1286,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":19,"seed":1287,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":20,"seed":1288,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":21,"seed":1289,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":22,"seed":1290,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":23,"seed":1291,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":24,"seed":1292,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":25,"seed":1293,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":26,"seed":1294,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":27,"seed":1295,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":28,"seed":1296,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":29,"seed":1297,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":30,"seed":1298,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":31,"seed":1299,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":32,"seed":1300,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":33,"seed":1301,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":34,"seed":1302,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":35,"seed":1303,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":36,"seed":1304,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":37,"seed":1305,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":38,"seed":1306,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":39,"seed":1307,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":40,"seed":1308,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":41,"seed":1309,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":42,"seed":1310,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":43,"seed":1311,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":44,"seed":1312,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":45,"seed":1313,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":46,"seed":1314,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":47,"seed":1315,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":48,"seed":1316,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":49,"seed":1317,"difficulty":"medium"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":50,"seed":1318,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":51,"seed":1319,"difficulty":"hard"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_conditional', '{"variant":52,"seed":1320,"difficulty":"easy"}'::jsonb, 'Conditional probability P(A|B) = P(A∩B)/P(B).');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":0,"seed":1321,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":1,"seed":1322,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":2,"seed":1323,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":3,"seed":1324,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":4,"seed":1325,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":5,"seed":1326,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":6,"seed":1327,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":7,"seed":1328,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":8,"seed":1329,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":9,"seed":1330,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":10,"seed":1331,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":11,"seed":1332,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":12,"seed":1333,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":13,"seed":1334,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":14,"seed":1335,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":15,"seed":1336,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":16,"seed":1337,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":17,"seed":1338,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":18,"seed":1339,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":19,"seed":1340,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":20,"seed":1341,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":21,"seed":1342,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":22,"seed":1343,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":23,"seed":1344,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":24,"seed":1345,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":25,"seed":1346,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":26,"seed":1347,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":27,"seed":1348,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":28,"seed":1349,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":29,"seed":1350,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":30,"seed":1351,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":31,"seed":1352,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":32,"seed":1353,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":33,"seed":1354,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":34,"seed":1355,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":35,"seed":1356,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":36,"seed":1357,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":37,"seed":1358,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":38,"seed":1359,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":39,"seed":1360,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":40,"seed":1361,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":41,"seed":1362,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":42,"seed":1363,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":43,"seed":1364,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":44,"seed":1365,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":45,"seed":1366,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":46,"seed":1367,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":47,"seed":1368,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":48,"seed":1369,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":49,"seed":1370,"difficulty":"medium"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":50,"seed":1371,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":51,"seed":1372,"difficulty":"hard"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
INSERT INTO public.question_templates (class, subject, chapter, template_type, template_data, explanation_template) VALUES (12, 'Mathematics', 'Probability', 'prob_bayes', '{"variant":52,"seed":1373,"difficulty":"easy"}'::jsonb, 'Bayes theorem updates prior probability using test accuracy.');
