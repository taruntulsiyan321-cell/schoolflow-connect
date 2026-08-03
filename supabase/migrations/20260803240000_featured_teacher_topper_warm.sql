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

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
    PERFORM public.rpc_rotate_featured_battles();
  ELSIF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_refresh_featured_battles') THEN
    PERFORM public.rpc_refresh_featured_battles();
  END IF;

  _cid := public.student_class_id(_uid);

  IF _cid IS NOT NULL AND EXISTS (
    SELECT 1 FROM pg_proc WHERE proname = '_seed_featured_battle_for_class'
  ) THEN
    BEGIN
      _daily := public._seed_featured_battle_for_class(_cid, 'daily');
    EXCEPTION WHEN OTHERS THEN
      _daily := NULL;
    END;
    BEGIN
      _weekly := public._seed_featured_battle_for_class(_cid, 'weekly');
    EXCEPTION WHEN OTHERS THEN
      _weekly := NULL;
    END;
    BEGIN
      _ncert := public._seed_featured_battle_for_class(_cid, 'ncert');
    EXCEPTION WHEN OTHERS THEN
      _ncert := NULL;
    END;
  ELSE
    -- Fallback: ensure (joins caller) so cards still populate
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
  END IF;

  _teacher := public._peek_teacher_featured_battle(_cid);

  RETURN jsonb_build_object(
    'daily', _daily,
    'weekly', _weekly,
    'ncert', _ncert,
    'teacher', _teacher
  );
END;
$$;

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
