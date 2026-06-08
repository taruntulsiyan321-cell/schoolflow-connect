-- FRESH DATABASE batch 10/12
-- For NEW empty Supabase project (paste in SQL Editor → Run)
-- Project: imrsjhftejghcrhzdjrl

-- ── 20260604090000_battle_reports.sql

-- =========================================================
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



-- ── 20260604100000_battleground_phase4.sql

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



-- ── 20260604120000_demo_data.sql

-- =============================================================================
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



-- ── 20260605000000_student_portal_login.sql

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


