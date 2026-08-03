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
  _subj := public._pick_featured_subject(_cid, _grade);

  IF _kind IN ('daily', 'weekly', 'ncert', 'teacher') AND _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to play this featured battle';
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
