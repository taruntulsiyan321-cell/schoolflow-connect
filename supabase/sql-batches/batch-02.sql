-- BATCH 2 of 4 — run in Supabase SQL Editor
-- Project: kdmjipeksjdyojjdokbi

-- ── 20260604080000_battle_monitor.sql — Battle monitor

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



-- ── 20260604100000_battleground_phase4.sql — Battleground phase 4

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



-- ── 20260605000000_student_portal_login.sql — Portal email/phone auto-link

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



-- ── 20260606000000_student_success_platform.sql — Student Success Phase 1

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


