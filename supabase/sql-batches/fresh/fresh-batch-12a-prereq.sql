-- STEP A: Run BEFORE concept mastery patch (migrations 100, 110, 120)

-- FRESH DATABASE batch 12/12
-- For NEW empty Supabase project (paste in SQL Editor â†’ Run)
-- Project: imrsjhftejghcrhzdjrl

-- â”€â”€ 20260610000000_battleground_overhaul.sql

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
    'Solo Practice Â· ' || _subject || COALESCE(' Â· ' || _chapter, ''),
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
    'Open Battle Â· ' || _subject,
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
    'Class Battle Â· ' || _subject,
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
    _name || ' challenges you Â· ' || _subject,
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



-- â”€â”€ 20260611000000_question_template_engine.sql

-- CBSE Class 12 Mathematics â€” parametric question template engine

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



-- â”€â”€ 20260612000000_ai_and_audit_fixes.sql

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


