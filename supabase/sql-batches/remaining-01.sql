-- REMAINING BATCH 1/5 — Supabase SQL Editor
-- Project: kdmjipeksjdyojjdokbi
-- NO Lovable credits needed

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



-- ── 20260516000000_inquiries_complaints.sql

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



-- ── 20260604030000_student_panel_fixes.sql

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


