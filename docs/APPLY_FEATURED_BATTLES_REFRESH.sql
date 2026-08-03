-- =============================================================================
-- APPLY FEATURED BATTLES (ordered Critical stack) — paste in Supabase SQL editor
-- =============================================================================

-- >>> Prerequisite: 20260802340000 — _pick_featured_subject (used by ensure/seed)
CREATE OR REPLACE FUNCTION public._pick_featured_subject(_class_id uuid, _grade int)
RETURNS text
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _stream text;
  _subj text;
BEGIN
  SELECT lower(nullif(trim(s.stream), '')) INTO _stream
  FROM public.classes c
  JOIN public.schools s ON s.id = c.school_id
  WHERE c.id = _class_id;

  -- Prefer subjects that actually have bank questions for this class level
  IF _stream = 'commerce' THEN
    SELECT q.subject INTO _subj
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) IN ('accountancy', 'business studies', 'economics', 'mathematics', 'english', 'hindi')
      AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
    GROUP BY q.subject
    ORDER BY
      CASE lower(q.subject)
        WHEN 'accountancy' THEN 1
        WHEN 'business studies' THEN 2
        WHEN 'economics' THEN 3
        WHEN 'mathematics' THEN 4
        WHEN 'english' THEN 5
        ELSE 6
      END,
      count(*) DESC
    LIMIT 1;
  ELSIF _stream = 'science' THEN
    SELECT q.subject INTO _subj
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) IN ('physics', 'chemistry', 'biology', 'mathematics', 'english', 'hindi')
      AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
    GROUP BY q.subject
    ORDER BY
      CASE lower(q.subject)
        WHEN 'physics' THEN 1
        WHEN 'chemistry' THEN 2
        WHEN 'mathematics' THEN 3
        WHEN 'biology' THEN 4
        ELSE 5
      END,
      count(*) DESC
    LIMIT 1;
  END IF;

  IF _subj IS NOT NULL THEN
    RETURN _subj;
  END IF;

  -- Any approved subject with questions for this grade
  SELECT q.subject INTO _subj
  FROM public.question_bank q
  WHERE q.is_approved
    AND (_grade IS NULL OR q.class_level IS NULL OR q.class_level = _grade)
  GROUP BY q.subject
  ORDER BY count(*) DESC
  LIMIT 1;

  RETURN COALESCE(_subj, 'Mathematics');
END;
$$;

GRANT EXECUTE ON FUNCTION public._pick_featured_subject(uuid, int) TO authenticated;

-- >>> 20260803200000_featured_battle_period_refresh.sql
-- Featured battles: period refresh + playable ensure (Daily / Weekly / NCERT).
-- Fixes: stale live rows never expire; empty shells unplayable for classmates;
-- Battleground home can warm current-period cards without tap.

-- ── 1) One-shot close prior-period featured still marked live/scheduled ──────
UPDATE public.battles
SET status = 'finished'
WHERE source IN ('featured_daily', 'featured_ncert')
  AND status IN ('live', 'scheduled')
  AND starts_at::date < CURRENT_DATE;

UPDATE public.battles
SET status = 'finished'
WHERE source = 'featured_weekly'
  AND status IN ('live', 'scheduled')
  AND date_trunc('week', starts_at) < date_trunc('week', now());

-- ── 2) Rotate helper (no battles.updated_at — column does not exist) ─────────
CREATE OR REPLACE FUNCTION public.rpc_rotate_featured_battles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _daily int := 0;
  _weekly int := 0;
  _ncert int := 0;
  _topper int := 0;
BEGIN
  UPDATE public.battles
  SET status = 'finished'
  WHERE source = 'featured_daily'
    AND status IN ('live', 'scheduled')
    AND starts_at::date < current_date;
  GET DIAGNOSTICS _daily = ROW_COUNT;

  UPDATE public.battles
  SET status = 'finished'
  WHERE source = 'featured_weekly'
    AND status IN ('live', 'scheduled')
    AND date_trunc('week', starts_at) < date_trunc('week', now());
  GET DIAGNOSTICS _weekly = ROW_COUNT;

  UPDATE public.battles
  SET status = 'finished'
  WHERE source = 'featured_ncert'
    AND status IN ('live', 'scheduled')
    AND starts_at::date < current_date;
  GET DIAGNOSTICS _ncert = ROW_COUNT;

  UPDATE public.battles
  SET status = 'cancelled'
  WHERE source = 'featured_beat_topper'
    AND status IN ('live', 'scheduled')
    AND starts_at < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.battle_participants bp
      WHERE bp.battle_id = battles.id AND bp.finished_at IS NOT NULL
    );
  GET DIAGNOSTICS _topper = ROW_COUNT;

  RETURN jsonb_build_object(
    'daily_expired', _daily,
    'weekly_expired', _weekly,
    'ncert_expired', _ncert,
    'topper_cancelled', _topper,
    'rotated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_rotate_featured_battles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_rotate_featured_battles() TO service_role;

-- ── 3) Fill questions without creator auth (cron / classmate backfill) ──────
CREATE OR REPLACE FUNCTION public._fill_featured_battle_questions(_battle_id uuid, _count int DEFAULT 10)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _b record;
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _battle_id LIMIT 1) THEN
    SELECT count(*) INTO _inserted FROM public.battle_questions WHERE battle_id = _battle_id;
    RETURN _inserted;
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
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
  SET
    source = CASE
      WHEN nullif(trim(source), '') IS NULL THEN 'bank'
      ELSE source
    END,
    question_count = GREATEST(_inserted, 1),
    duration_sec = per_question_sec * GREATEST(_inserted, 1)
  WHERE id = _battle_id;

  RETURN _inserted;
END;
$$;

REVOKE ALL ON FUNCTION public._fill_featured_battle_questions(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._fill_featured_battle_questions(uuid, int) TO service_role;

-- ── 4) Classmates may generate questions on featured shells ─────────────────
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
     AND NOT has_role(_uid,'admin') AND NOT has_role(_uid,'teacher')
     AND NOT (
       coalesce(_b.source, '') LIKE 'featured_%'
       AND _b.class_id IS NOT NULL
       AND public.student_class_id(_uid) IS NOT DISTINCT FROM _b.class_id
     ) THEN
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
    SELECT id, question, options, correct_index FROM pool
    ORDER BY seen ASC,
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
      last_seen ASC, random()
    LIMIT GREATEST(_count, 1)
  ), ins AS (
    INSERT INTO public.battle_questions
      (battle_id, order_index, question, options, correct_index, points, bank_question_id)
    SELECT _battle_id, row_number() OVER () - 1, question, options, correct_index, 10, id
    FROM picked RETURNING 1
  )
  SELECT count(*) INTO _inserted FROM ins;

  UPDATE public.battles
    SET
      source = CASE
        WHEN nullif(trim(source), '') IS NULL THEN 'bank'
        ELSE source
      END,
      question_count = _inserted,
      duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $$;

GRANT EXECUTE ON FUNCTION public.rpc_generate_battle(uuid, int) TO authenticated;

-- ── 5) Ensure single kind (rotate → create/return → backfill questions) ─────
CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battle(_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _grade int; _name text; _bid uuid; _n int;
  _topper_uid uuid; _topper_name text; _existing uuid;
  _stu_id uuid;
  _lock_a int;
  _lock_b int;
  _subj text;
  _qneed int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF _kind IN ('daily', 'weekly', 'ncert') THEN
    PERFORM public.rpc_rotate_featured_battles();
  END IF;

  _cid := public.student_class_id(_uid);
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;

  IF _kind IN ('daily', 'weekly', 'ncert', 'teacher') AND _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to play this featured battle';
  END IF;

  -- Teacher peeks only — pick subject when creating Daily/Weekly/NCERT/Beat Topper.
  IF _kind IN ('daily', 'weekly', 'ncert', 'beat_topper') THEN
    _subj := public._pick_featured_subject(_cid, _grade);
  END IF;

  _lock_a := hashtext('featured:' || coalesce(_kind, '') || ':' || coalesce(_cid::text, ''));
  IF _kind = 'weekly' THEN
    _lock_b := hashtext(date_trunc('week', now())::text);
  ELSIF _kind IN ('daily', 'ncert') THEN
    _lock_b := hashtext(current_date::text);
  ELSE
    _lock_b := hashtext(_uid::text);
  END IF;
  PERFORM pg_advisory_xact_lock(_lock_a, _lock_b);

  IF _kind = 'daily' THEN
    _qneed := 10;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_daily' AND starts_at::date = current_date
        AND status IN ('live','scheduled') AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
        VALUES ('Daily Challenge', _subj, 'medium', 'mcq', 'live', _cid,
          _uid, 20, 10, 20 * 10, true, 'open', 'featured_daily', now(), _grade)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_daily' AND starts_at::date = current_date
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Daily Challenge'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for today''s Daily Challenge yet';
      END IF;
    END IF;

  ELSIF _kind = 'weekly' THEN
    _qneed := 15;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live','scheduled') AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
        VALUES ('Weekly Championship', _subj, 'hard', 'mcq', 'live', _cid,
          _uid, 25, 15, 25 * 15, true, 'open', 'featured_weekly', now(), _grade)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Weekly Championship'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for this week''s Championship yet';
      END IF;
    END IF;

  ELSIF _kind = 'ncert' THEN
    _qneed := 10;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_ncert' AND starts_at::date = current_date
        AND status IN ('live','scheduled') AND class_id = _cid
        AND (class_level IS NOT DISTINCT FROM _grade)
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
        VALUES ('NCERT Challenge', _subj, 'easy', 'mcq', 'live', _cid,
          _uid, 20, 10, 20 * 10, true, 'open', 'featured_ncert', now(), _grade)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_ncert' AND starts_at::date = current_date
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create NCERT Challenge'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for the NCERT Challenge yet';
      END IF;
    END IF;

  ELSIF _kind = 'beat_topper' THEN
    IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to challenge your topper'; END IF;
    SELECT s.user_id, s.full_name INTO _topper_uid, _topper_name
      FROM public.students s
      JOIN public.student_xp x ON x.user_id = s.user_id
      WHERE s.class_id = _cid AND s.user_id IS NOT NULL AND s.user_id <> _uid
      ORDER BY x.xp DESC LIMIT 1;
    IF _topper_uid IS NULL THEN
      RAISE EXCEPTION 'No class topper to challenge yet — be the first to score!';
    END IF;

    INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
      creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
    VALUES ('Beat the Topper · ' || _topper_name, _subj, 'hard', 'mcq', 'live', _cid,
      _uid, 20, 10, 20 * 10, false, 'duel', 'featured_beat_topper', now(), _grade)
    RETURNING id INTO _bid;
    SELECT public._fill_featured_battle_questions(_bid, 10) INTO _n;
    IF coalesce(_n, 0) = 0 THEN
      SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
    END IF;
    IF coalesce(_n, 0) = 0 THEN
      DELETE FROM public.battles WHERE id = _bid;
      RAISE EXCEPTION 'No questions available to challenge the topper yet';
    END IF;

    INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
    VALUES (_bid, _topper_uid, _uid)
    ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
      PERFORM public._battle_event('challenge', _uid, _name,
        'is trying to beat the topper, ' || _topper_name, _subj, _topper_name, _bid, _cid, 'crown');
    END IF;

  ELSIF _kind = 'teacher' THEN
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'manual' AND class_id = _cid AND is_public = true
        AND status IN ('live','scheduled')
        AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = battles.creator_user_id AND ur.role = 'teacher')
      ORDER BY starts_at DESC LIMIT 1;
    IF _existing IS NULL THEN
      RAISE EXCEPTION 'No teacher-hosted challenge is live right now — check back soon.';
    END IF;
    _bid := _existing;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      RAISE EXCEPTION 'Teacher challenge has no questions yet — ask your teacher to publish it.';
    END IF;

  ELSE
    RAISE EXCEPTION 'Unknown featured battle kind: %', _kind;
  END IF;

  IF _bid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.battle_participants WHERE battle_id = _bid AND user_id = _uid
  ) THEN
    INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name)
    VALUES (_bid, _uid, _stu_id, COALESCE(_name, 'Challenger'));
  END IF;

  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battle(text) TO authenticated;

-- ── 6) Ensure Daily+Weekly+NCERT for Battleground warm load ─────────────────
CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battles_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _daily uuid;
  _weekly uuid;
  _ncert uuid;
  _teacher uuid;
  _cid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  PERFORM public.rpc_rotate_featured_battles();

  BEGIN
    _daily := public.rpc_ensure_featured_battle('daily');
  EXCEPTION WHEN OTHERS THEN
    _daily := NULL;
  END;

  BEGIN
    _weekly := public.rpc_ensure_featured_battle('weekly');
  EXCEPTION WHEN OTHERS THEN
    _weekly := NULL;
  END;

  BEGIN
    _ncert := public.rpc_ensure_featured_battle('ncert');
  EXCEPTION WHEN OTHERS THEN
    _ncert := NULL;
  END;

  _cid := public.student_class_id(_uid);
  IF _cid IS NOT NULL THEN
    SELECT id INTO _teacher
    FROM public.battles
    WHERE source = 'manual'
      AND class_id = _cid
      AND is_public = true
      AND status IN ('live', 'scheduled')
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = battles.creator_user_id AND ur.role = 'teacher'
      )
    ORDER BY starts_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'daily', _daily,
    'weekly', _weekly,
    'ncert', _ncert,
    'teacher', _teacher
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battles_all() TO authenticated;

-- Alias used by older clients / types
CREATE OR REPLACE FUNCTION public.rpc_refresh_featured_battles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN public.rpc_rotate_featured_battles();
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_refresh_featured_battles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_refresh_featured_battles() TO service_role;

-- ── 7) Optional hourly rotate via pg_cron ───────────────────────────────────
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('rotate-featured-battles');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('refresh-featured-battles');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'rotate-featured-battles',
      '5 * * * *',
      $cron$SELECT public.rpc_rotate_featured_battles();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron schedule skipped: %', SQLERRM;
END;
$$;


-- >>> 20260803220000_featured_battles_refresh.sql
-- =============================================================================
-- APPLY_FEATURED_BATTLES_REFRESH.sql
-- Idempotent featured battle rotation for Battleground.
--
-- Paste into Supabase SQL editor (or apply via migration
-- 20260803220000_featured_battles_refresh.sql).
--
-- Provides:
--   * rpc_refresh_featured_battles() — close expired daily/ncert/weekly,
--     seed current-window challenges per class (safe to run often)
--   * rpc_rotate_featured_battles() — close-only compat helper
--   * rpc_ensure_featured_battles_all() — caller warm for Daily/Weekly/NCERT
--   * Optional pg_cron hourly job when extension is available
--
-- Wire: existing battles.source featured_daily | featured_weekly | featured_ncert
-- (from 20260801120000_battle_codes_and_featured.sql and later).
-- beat_topper / teacher remain on-demand via rpc_ensure_featured_battle.
-- =============================================================================

-- â”€â”€ 1. System creator for class-scoped featured inserts â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION public._featured_system_creator(_class_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid;
  _school uuid;
BEGIN
  SELECT c.school_id INTO _school FROM public.classes c WHERE c.id = _class_id;

  SELECT t.user_id INTO _uid
  FROM public.teacher_classes tc
  JOIN public.teachers t ON t.id = tc.teacher_id
  WHERE tc.class_id = _class_id AND t.user_id IS NOT NULL
  ORDER BY tc.id
  LIMIT 1;
  IF _uid IS NOT NULL THEN RETURN _uid; END IF;

  IF _school IS NOT NULL THEN
    SELECT ur.user_id INTO _uid
    FROM public.user_roles ur
    JOIN public.profiles p ON p.id = ur.user_id
    WHERE p.school_id = _school
      AND ur.role IN ('admin', 'principal', 'teacher')
    ORDER BY CASE ur.role WHEN 'admin' THEN 1 WHEN 'principal' THEN 2 ELSE 3 END, ur.user_id
    LIMIT 1;
    IF _uid IS NOT NULL THEN RETURN _uid; END IF;
  END IF;

  SELECT s.user_id INTO _uid
  FROM public.students s
  WHERE s.class_id = _class_id AND s.user_id IS NOT NULL
  ORDER BY s.created_at NULLS LAST, s.id
  LIMIT 1;
  IF _uid IS NOT NULL THEN RETURN _uid; END IF;

  SELECT p.id INTO _uid FROM public.profiles p ORDER BY p.created_at NULLS LAST LIMIT 1;
  RETURN _uid;
END;
$$;

-- â”€â”€ 2. Fill questions without auth.uid() (cron / refresh path) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION public._fill_featured_battle_questions(_battle_id uuid, _count int DEFAULT 10)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _b record;
  _inserted int := 0;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL THEN RETURN 0; END IF;
  IF EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _battle_id LIMIT 1) THEN
    SELECT count(*) INTO _inserted FROM public.battle_questions WHERE battle_id = _battle_id;
    RETURN _inserted;
  END IF;

  WITH pool AS (
    SELECT q.id, q.question, q.options, q.correct_index, q.difficulty
    FROM public.question_bank q
    WHERE q.is_approved
      AND lower(q.subject) = lower(_b.subject)
      AND (_b.chapter IS NULL OR q.chapter ILIKE _b.chapter)
      AND (_b.topic IS NULL OR q.topic ILIKE _b.topic)
      AND (_b.class_level IS NULL OR q.class_level IS NULL OR q.class_level = _b.class_level)
  ), picked AS (
    SELECT id, question, options, correct_index
    FROM pool
    ORDER BY
      (_b.difficulty IS NOT NULL AND difficulty = _b.difficulty) DESC,
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
  SET
    source = CASE
      WHEN nullif(trim(source), '') IS NULL THEN 'bank'
      ELSE source
    END,
    question_count = GREATEST(_inserted, 1),
    duration_sec = per_question_sec * GREATEST(_inserted, 1)
  WHERE id = _battle_id;

  RETURN _inserted;
END;
$$;

-- â”€â”€ 3. Seed one featured kind for a class (current window) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION public._seed_featured_battle_for_class(_class_id uuid, _kind text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _grade int;
  _subj text;
  _creator uuid;
  _bid uuid;
  _n int;
  _source text;
  _title text;
  _diff text;
  _qcount int;
  _pqsec int;
  _lock_a int;
  _lock_b int;
BEGIN
  IF _class_id IS NULL THEN RETURN NULL; END IF;
  IF _kind NOT IN ('daily', 'weekly', 'ncert') THEN
    RAISE EXCEPTION 'Unsupported featured seed kind: %', _kind;
  END IF;

  _grade := public._class_grade(_class_id);
  _subj := public._pick_featured_subject(_class_id, _grade);
  _creator := public._featured_system_creator(_class_id);
  IF _creator IS NULL THEN RETURN NULL; END IF;

  IF _kind = 'daily' THEN
    _source := 'featured_daily';
    _title := 'Daily Challenge';
    _diff := 'medium';
    _qcount := 10;
    _pqsec := 20;
  ELSIF _kind = 'weekly' THEN
    _source := 'featured_weekly';
    _title := 'Weekly Championship';
    _diff := 'hard';
    _qcount := 15;
    _pqsec := 25;
  ELSE
    _source := 'featured_ncert';
    _title := 'NCERT Challenge';
    _diff := 'easy';
    _qcount := 10;
    _pqsec := 20;
  END IF;

  _lock_a := hashtext('featured-seed:' || _kind || ':' || _class_id::text);
  IF _kind = 'weekly' THEN
    _lock_b := hashtext(date_trunc('week', now())::text);
  ELSE
    _lock_b := hashtext(current_date::text);
  END IF;
  PERFORM pg_advisory_xact_lock(_lock_a, _lock_b);

  IF _kind = 'weekly' THEN
    SELECT id INTO _bid FROM public.battles
    WHERE source = _source
      AND class_id = _class_id
      AND date_trunc('week', starts_at) = date_trunc('week', now())
      AND status IN ('live', 'scheduled')
    ORDER BY created_at
    LIMIT 1;
  ELSE
    SELECT id INTO _bid FROM public.battles
    WHERE source = _source
      AND class_id = _class_id
      AND starts_at::date = current_date
      AND status IN ('live', 'scheduled')
    ORDER BY created_at
    LIMIT 1;
  END IF;

  IF _bid IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      SELECT public._fill_featured_battle_questions(_bid, _qcount) INTO _n;
      IF _n = 0 THEN
        UPDATE public.battles SET status = 'cancelled' WHERE id = _bid;
        RETURN NULL;
      END IF;
    END IF;
    RETURN _bid;
  END IF;

  BEGIN
    INSERT INTO public.battles (
      title, subject, difficulty, type, status, class_id,
      creator_user_id, per_question_sec, question_count, duration_sec,
      is_public, mode, source, starts_at, class_level
    ) VALUES (
      _title, _subj, _diff, 'mcq', 'live', _class_id,
      _creator, _pqsec, _qcount, _pqsec * _qcount,
      true, 'open', _source, now(), _grade
    )
    RETURNING id INTO _bid;
  EXCEPTION WHEN unique_violation THEN
    IF _kind = 'weekly' THEN
      SELECT id INTO _bid FROM public.battles
      WHERE source = _source AND class_id = _class_id
        AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live', 'scheduled')
      ORDER BY created_at LIMIT 1;
    ELSE
      SELECT id INTO _bid FROM public.battles
      WHERE source = _source AND class_id = _class_id
        AND starts_at::date = current_date
        AND status IN ('live', 'scheduled')
      ORDER BY created_at LIMIT 1;
    END IF;
  END;

  IF _bid IS NULL THEN RETURN NULL; END IF;

  IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
    SELECT public._fill_featured_battle_questions(_bid, _qcount) INTO _n;
    IF _n = 0 THEN
      UPDATE public.battles SET status = 'cancelled' WHERE id = _bid;
      RETURN NULL;
    END IF;
  END IF;

  RETURN _bid;
END;
$$;

-- â”€â”€ 4. rpc_refresh_featured_battles â€” close expired + seed current â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION public.rpc_refresh_featured_battles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _closed int := 0;
  _seeded int := 0;
  _skipped int := 0;
  _failed int := 0;
  _cls record;
  _kind text;
  _bid uuid;
  _kinds text[] := ARRAY['daily', 'ncert', 'weekly'];
BEGIN
  PERFORM pg_advisory_xact_lock(hashtext('rpc_refresh_featured_battles'), 1);

  -- Close daily / ncert whose calendar day has ended
  WITH closed AS (
    UPDATE public.battles b
    SET status = 'finished'
    WHERE b.source IN ('featured_daily', 'featured_ncert')
      AND b.status IN ('live', 'scheduled')
      AND b.starts_at::date < current_date
    RETURNING 1
  )
  SELECT count(*) INTO _closed FROM closed;

  -- Close weekly whose ISO week has ended
  WITH closed AS (
    UPDATE public.battles b
    SET status = 'finished'
    WHERE b.source = 'featured_weekly'
      AND b.status IN ('live', 'scheduled')
      AND date_trunc('week', b.starts_at) < date_trunc('week', now())
    RETURNING 1
  )
  SELECT _closed + count(*) INTO _closed FROM closed;

  -- Seed current-window featured for every class that has linked students
  FOR _cls IN
    SELECT DISTINCT c.id AS class_id
    FROM public.classes c
    JOIN public.students s ON s.class_id = c.id AND s.user_id IS NOT NULL
    WHERE c.id IS NOT NULL
  LOOP
    FOREACH _kind IN ARRAY _kinds LOOP
      BEGIN
        _bid := public._seed_featured_battle_for_class(_cls.class_id, _kind);
        IF _bid IS NOT NULL THEN
          _seeded := _seeded + 1;
        ELSE
          _failed := _failed + 1;
        END IF;
      EXCEPTION WHEN OTHERS THEN
        _failed := _failed + 1;
        _skipped := _skipped + 1;
      END;
    END LOOP;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'closed', _closed,
    'seeded_or_ensured', _seeded,
    'failed', _failed,
    'errors_caught', _skipped,
    'at', now()
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_refresh_featured_battles() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_refresh_featured_battles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_refresh_featured_battles() TO service_role;

REVOKE ALL ON FUNCTION public._featured_system_creator(uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._fill_featured_battle_questions(uuid, int) FROM PUBLIC;
REVOKE ALL ON FUNCTION public._seed_featured_battle_for_class(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._featured_system_creator(uuid) TO service_role;
GRANT EXECUTE ON FUNCTION public._fill_featured_battle_questions(uuid, int) TO service_role;
GRANT EXECUTE ON FUNCTION public._seed_featured_battle_for_class(uuid, text) TO service_role;

-- â”€â”€ 4b. Compat: close-only rotate (no updated_at â€” battles has none) â”€â”€â”€â”€â”€â”€â”€â”€
CREATE OR REPLACE FUNCTION public.rpc_rotate_featured_battles()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _daily int := 0;
  _weekly int := 0;
  _ncert int := 0;
  _topper int := 0;
BEGIN
  UPDATE public.battles
  SET status = 'finished'
  WHERE source = 'featured_daily'
    AND status IN ('live', 'scheduled')
    AND starts_at::date < current_date;
  GET DIAGNOSTICS _daily = ROW_COUNT;

  UPDATE public.battles
  SET status = 'finished'
  WHERE source = 'featured_weekly'
    AND status IN ('live', 'scheduled')
    AND date_trunc('week', starts_at) < date_trunc('week', now());
  GET DIAGNOSTICS _weekly = ROW_COUNT;

  UPDATE public.battles
  SET status = 'finished'
  WHERE source = 'featured_ncert'
    AND status IN ('live', 'scheduled')
    AND starts_at::date < current_date;
  GET DIAGNOSTICS _ncert = ROW_COUNT;

  UPDATE public.battles
  SET status = 'cancelled'
  WHERE source = 'featured_beat_topper'
    AND status IN ('live', 'scheduled')
    AND starts_at < now() - interval '24 hours'
    AND NOT EXISTS (
      SELECT 1 FROM public.battle_participants bp
      WHERE bp.battle_id = battles.id AND bp.finished_at IS NOT NULL
    );
  GET DIAGNOSTICS _topper = ROW_COUNT;

  RETURN jsonb_build_object(
    'daily_expired', _daily,
    'weekly_expired', _weekly,
    'ncert_expired', _ncert,
    'topper_cancelled', _topper,
    'rotated_at', now()
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_rotate_featured_battles() TO authenticated;
GRANT EXECUTE ON FUNCTION public.rpc_rotate_featured_battles() TO service_role;

-- Caller-scoped ensure-all (joins auth user into Daily/Weekly/NCERT)
CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battles_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _daily uuid;
  _weekly uuid;
  _ncert uuid;
  _teacher uuid;
  _cid uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  PERFORM public.rpc_refresh_featured_battles();

  BEGIN
    _daily := public.rpc_ensure_featured_battle('daily');
  EXCEPTION WHEN OTHERS THEN
    _daily := NULL;
  END;
  BEGIN
    _weekly := public.rpc_ensure_featured_battle('weekly');
  EXCEPTION WHEN OTHERS THEN
    _weekly := NULL;
  END;
  BEGIN
    _ncert := public.rpc_ensure_featured_battle('ncert');
  EXCEPTION WHEN OTHERS THEN
    _ncert := NULL;
  END;

  _cid := public.student_class_id(_uid);
  IF _cid IS NOT NULL THEN
    SELECT id INTO _teacher
    FROM public.battles
    WHERE source = 'manual'
      AND class_id = _cid
      AND is_public = true
      AND status IN ('live', 'scheduled')
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = battles.creator_user_id AND ur.role = 'teacher'
      )
    ORDER BY starts_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'daily', _daily,
    'weekly', _weekly,
    'ncert', _ncert,
    'teacher', _teacher
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battles_all() TO authenticated;

-- â”€â”€ 5. Optional pg_cron (hourly) â€” no-op if extension unavailable â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron extension unavailable: %', SQLERRM;
END;
$$;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    BEGIN
      PERFORM cron.unschedule('refresh-featured-battles');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM cron.unschedule('rotate-featured-battles');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    PERFORM cron.schedule(
      'refresh-featured-battles',
      '5 * * * *',
      $cron$SELECT public.rpc_refresh_featured_battles();$cron$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Could not schedule featured battles cron: %', SQLERRM;
END;
$$;

-- One-shot warm-up (idempotent)
SELECT public.rpc_refresh_featured_battles();


-- >>> 20260803230000_featured_ensure_all_no_join.sql
-- Class-scoped featured warm for Battleground load (no auto-join).
-- Depends on rpc_refresh_featured_battles / _seed_featured_battle_for_class
-- from 20260803220000_featured_battles_refresh.sql.

CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battles_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid;
  _daily uuid;
  _weekly uuid;
  _ncert uuid;
  _teacher uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(_uid);
  IF _cid IS NULL THEN
    RETURN jsonb_build_object(
      'daily', null, 'weekly', null, 'ncert', null, 'teacher', null,
      'ok', false, 'reason', 'no_class'
    );
  END IF;

  -- Expire + seed current windows for all classes (idempotent)
  BEGIN
    PERFORM public.rpc_refresh_featured_battles();
  EXCEPTION WHEN OTHERS THEN
    -- Fallback: seed only this class when global refresh unavailable
    BEGIN
      _daily := public._seed_featured_battle_for_class(_cid, 'daily');
      _weekly := public._seed_featured_battle_for_class(_cid, 'weekly');
      _ncert := public._seed_featured_battle_for_class(_cid, 'ncert');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END;

  SELECT id INTO _daily FROM public.battles
  WHERE source = 'featured_daily' AND class_id = _cid
    AND starts_at::date = current_date AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  SELECT id INTO _weekly FROM public.battles
  WHERE source = 'featured_weekly' AND class_id = _cid
    AND date_trunc('week', starts_at) = date_trunc('week', now())
    AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  SELECT id INTO _ncert FROM public.battles
  WHERE source = 'featured_ncert' AND class_id = _cid
    AND starts_at::date = current_date AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  -- Teacher featured: live public battle hosted by a teacher (manual/custom/bank)
  SELECT b.id INTO _teacher
  FROM public.battles b
  WHERE b.class_id = _cid
    AND b.is_public = true
    AND b.status IN ('live', 'scheduled')
    AND coalesce(b.source, 'manual') IN ('manual', 'custom', 'bank')
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = b.creator_user_id AND ur.role = 'teacher'
    )
  ORDER BY b.starts_at DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'daily', _daily,
    'weekly', _weekly,
    'ncert', _ncert,
    'teacher', _teacher,
    'ok', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_ensure_featured_battles_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battles_all() TO authenticated;


-- >>> 20260803240000_featured_teacher_topper_warm.sql
-- Featured polish (runs after period refresh + seed refresh):
--   * Teacher Challenge → live teacher-hosted custom/manual/bank battles
--   * Beat the Topper → reuse open duel; soft unlock message
--   * ensure-all warms Daily/Weekly/NCERT without forcing join when seed exists

CREATE OR REPLACE FUNCTION public._peek_teacher_featured_battle(_class_id uuid)
RETURNS uuid
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bid uuid;
BEGIN
  IF _class_id IS NULL THEN RETURN NULL; END IF;
  SELECT b.id INTO _bid
  FROM public.battles b
  WHERE b.class_id = _class_id
    AND b.is_public = true
    AND b.status IN ('live', 'scheduled')
    AND coalesce(b.source, '') NOT LIKE 'featured_%'
    AND b.source IN ('manual', 'custom', 'bank')
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = b.creator_user_id AND ur.role = 'teacher'
    )
    AND EXISTS (
      SELECT 1 FROM public.battle_questions bq WHERE bq.battle_id = b.id LIMIT 1
    )
  ORDER BY b.starts_at DESC NULLS LAST, b.created_at DESC
  LIMIT 1;
  RETURN _bid;
END;
$$;

GRANT EXECUTE ON FUNCTION public._peek_teacher_featured_battle(uuid) TO authenticated;

-- Allow class warm path to call seed helper
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = '_seed_featured_battle_for_class'
  ) THEN
    GRANT EXECUTE ON FUNCTION public._seed_featured_battle_for_class(uuid, text) TO authenticated;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battles_all()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid;
  _daily uuid;
  _weekly uuid;
  _ncert uuid;
  _teacher uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(_uid);
  IF _cid IS NULL THEN
    RETURN jsonb_build_object(
      'daily', null, 'weekly', null, 'ncert', null, 'teacher', null,
      'ok', false, 'reason', 'no_class'
    );
  END IF;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_refresh_featured_battles') THEN
      PERFORM public.rpc_refresh_featured_battles();
    ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
      PERFORM public.rpc_rotate_featured_battles();
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_seed_featured_battle_for_class') THEN
    BEGIN
      PERFORM public._seed_featured_battle_for_class(_cid, 'daily');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM public._seed_featured_battle_for_class(_cid, 'weekly');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
    BEGIN
      PERFORM public._seed_featured_battle_for_class(_cid, 'ncert');
    EXCEPTION WHEN OTHERS THEN
      NULL;
    END;
  END IF;

  SELECT id INTO _daily FROM public.battles
  WHERE source = 'featured_daily' AND class_id = _cid
    AND starts_at::date = current_date AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  SELECT id INTO _weekly FROM public.battles
  WHERE source = 'featured_weekly' AND class_id = _cid
    AND date_trunc('week', starts_at) = date_trunc('week', now())
    AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  SELECT id INTO _ncert FROM public.battles
  WHERE source = 'featured_ncert' AND class_id = _cid
    AND starts_at::date = current_date AND status IN ('live', 'scheduled')
  ORDER BY created_at LIMIT 1;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_peek_teacher_featured_battle') THEN
    _teacher := public._peek_teacher_featured_battle(_cid);
  ELSE
    SELECT b.id INTO _teacher
    FROM public.battles b
    WHERE b.class_id = _cid
      AND b.is_public = true
      AND b.status IN ('live', 'scheduled')
      AND coalesce(b.source, 'manual') IN ('manual', 'custom', 'bank')
      AND EXISTS (
        SELECT 1 FROM public.user_roles ur
        WHERE ur.user_id = b.creator_user_id AND ur.role = 'teacher'
      )
    ORDER BY b.starts_at DESC
    LIMIT 1;
  END IF;

  RETURN jsonb_build_object(
    'daily', _daily,
    'weekly', _weekly,
    'ncert', _ncert,
    'teacher', _teacher,
    'ok', true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rpc_ensure_featured_battles_all() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battles_all() TO authenticated;

-- Patch ensure: teacher sources + graceful beat_topper (reuse open duel)
CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battle(_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _grade int; _name text; _bid uuid; _n int; _qneed int;
  _topper_uid uuid; _topper_name text; _existing uuid;
  _stu_id uuid;
  _lock_a int;
  _lock_b int;
  _subj text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  IF _kind IN ('daily', 'weekly', 'ncert') THEN
    PERFORM public.rpc_rotate_featured_battles();
  END IF;

  _cid := public.student_class_id(_uid);
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;

  IF _kind IN ('daily', 'weekly', 'ncert', 'teacher') AND _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to play this featured battle';
  END IF;

  -- Teacher peeks only — pick subject when creating Daily/Weekly/NCERT/Beat Topper.
  IF _kind IN ('daily', 'weekly', 'ncert', 'beat_topper') THEN
    _subj := public._pick_featured_subject(_cid, _grade);
  END IF;

  _lock_a := hashtext('featured:' || coalesce(_kind, '') || ':' || coalesce(_cid::text, ''));
  IF _kind = 'weekly' THEN
    _lock_b := hashtext(date_trunc('week', now())::text);
  ELSIF _kind IN ('daily', 'ncert') THEN
    _lock_b := hashtext(current_date::text);
  ELSE
    _lock_b := hashtext(_uid::text);
  END IF;
  PERFORM pg_advisory_xact_lock(_lock_a, _lock_b);

  IF _kind = 'daily' THEN
    _qneed := 10;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_daily' AND starts_at::date = current_date
        AND status IN ('live','scheduled') AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
        VALUES ('Daily Challenge', _subj, 'medium', 'mcq', 'live', _cid,
          _uid, 20, 10, 20 * 10, true, 'open', 'featured_daily', now(), _grade)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_daily' AND starts_at::date = current_date
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Daily Challenge'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for today''s Daily Challenge yet';
      END IF;
    END IF;

  ELSIF _kind = 'weekly' THEN
    _qneed := 15;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live','scheduled') AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
        VALUES ('Weekly Championship', _subj, 'hard', 'mcq', 'live', _cid,
          _uid, 25, 15, 25 * 15, true, 'open', 'featured_weekly', now(), _grade)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Weekly Championship'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for this week''s Championship yet';
      END IF;
    END IF;

  ELSIF _kind = 'ncert' THEN
    _qneed := 10;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_ncert' AND starts_at::date = current_date
        AND status IN ('live','scheduled') AND class_id = _cid
        AND (class_level IS NOT DISTINCT FROM _grade)
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      BEGIN
        INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
          creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
        VALUES ('NCERT Challenge', _subj, 'easy', 'mcq', 'live', _cid,
          _uid, 20, 10, 20 * 10, true, 'open', 'featured_ncert', now(), _grade)
        RETURNING id INTO _bid;
      EXCEPTION WHEN unique_violation THEN
        SELECT id INTO _bid FROM public.battles
          WHERE source = 'featured_ncert' AND starts_at::date = current_date
            AND status IN ('live','scheduled') AND class_id = _cid
          ORDER BY created_at LIMIT 1;
      END;
    END IF;
    IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create NCERT Challenge'; END IF;
    IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, _qneed) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available for the NCERT Challenge yet';
      END IF;
    END IF;

  ELSIF _kind = 'beat_topper' THEN
    IF _cid IS NULL THEN
      RAISE EXCEPTION 'Join a class to challenge your topper';
    END IF;

    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_beat_topper'
        AND creator_user_id = _uid
        AND class_id = _cid
        AND status IN ('live', 'scheduled')
      ORDER BY created_at DESC
      LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      SELECT s.user_id, s.full_name INTO _topper_uid, _topper_name
        FROM public.students s
        JOIN public.student_xp x ON x.user_id = s.user_id
        WHERE s.class_id = _cid AND s.user_id IS NOT NULL AND s.user_id <> _uid
        ORDER BY x.xp DESC LIMIT 1;
      IF _topper_uid IS NULL THEN
        RAISE EXCEPTION 'Beat the Topper unlocks when a classmate has XP — check back soon.';
      END IF;

      INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
        creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
      VALUES ('Beat the Topper · ' || _topper_name, _subj, 'hard', 'mcq', 'live', _cid,
        _uid, 20, 10, 20 * 10, false, 'duel', 'featured_beat_topper', now(), _grade)
      RETURNING id INTO _bid;

      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_fill_featured_battle_questions') THEN
        SELECT public._fill_featured_battle_questions(_bid, 10) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
      END IF;
      IF coalesce(_n, 0) = 0 THEN
        DELETE FROM public.battles WHERE id = _bid;
        RAISE EXCEPTION 'No questions available to challenge the topper yet';
      END IF;

      INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
      VALUES (_bid, _topper_uid, _uid)
      ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

      IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
        PERFORM public._battle_event('challenge', _uid, _name,
          'is trying to beat the topper, ' || _topper_name, _subj, _topper_name, _bid, _cid, 'crown');
      END IF;
    END IF;

  ELSIF _kind = 'teacher' THEN
    _existing := public._peek_teacher_featured_battle(_cid);
    IF _existing IS NULL THEN
      RAISE EXCEPTION 'No teacher-hosted challenge is live right now — check back soon.';
    END IF;
    _bid := _existing;

  ELSE
    RAISE EXCEPTION 'Unknown featured battle kind: %', _kind;
  END IF;

  IF _bid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.battle_participants WHERE battle_id = _bid AND user_id = _uid
  ) THEN
    INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name)
    VALUES (_bid, _uid, _stu_id, COALESCE(_name, 'Challenger'));
  END IF;

  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battle(text) TO authenticated;

