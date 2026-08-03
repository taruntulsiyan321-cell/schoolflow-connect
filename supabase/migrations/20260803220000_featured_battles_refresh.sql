-- =============================================================================
-- APPLY_FEATURED_BATTLES_REFRESH.sql
-- Idempotent featured battle rotation for Battleground.
--
-- Paste into Supabase SQL editor (or apply via migration
-- 20260803200000_featured_battles_refresh.sql).
--
-- Provides:
--   * rpc_refresh_featured_battles() — close expired daily/ncert/weekly,
--     seed current-window challenges per class (safe to run often)
--   * Optional pg_cron hourly job when extension is available
--
-- Wire: existing battles.source featured_daily | featured_weekly | featured_ncert
-- (from 20260801120000_battle_codes_and_featured.sql and later).
-- beat_topper / teacher remain on-demand via rpc_ensure_featured_battle.
-- =============================================================================

-- ── 1. System creator for class-scoped featured inserts ─────────────────────
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

-- ── 2. Fill questions without auth.uid() (cron / refresh path) ──────────────
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

-- ── 3. Seed one featured kind for a class (current window) ──────────────────
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

-- ── 4. rpc_refresh_featured_battles — close expired + seed current ──────────
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

-- ── 4b. Compat: close-only rotate (no updated_at — battles has none) ────────
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

-- ── 5. Optional pg_cron (hourly) — no-op if extension unavailable ───────────
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
