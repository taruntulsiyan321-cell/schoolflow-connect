-- =========================================================
-- Featured battles: class-scope lookup + auto-join caller
-- Fixes school-wide daily/weekly reuse that RLS blocks for
-- other classes ("battle not found").
-- =========================================================

CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battle(_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _grade int; _name text; _bid uuid; _n int;
  _topper_uid uuid; _topper_name text; _existing uuid;
  _stu_id uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(_uid);
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;

  IF _kind = 'daily' THEN
    IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to play the Daily Challenge'; END IF;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_daily' AND starts_at::date = current_date
        AND status IN ('live','scheduled')
        AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
        creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
      VALUES ('Daily Challenge', 'Mathematics', 'medium', 'mcq', 'live', _cid,
        _uid, 20, 10, 20 * 10, true, 'open', 'featured_daily', now(), _grade)
      RETURNING id INTO _bid;
      SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
      IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available for today''s Daily Challenge yet'; END IF;
    END IF;

  ELSIF _kind = 'weekly' THEN
    IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to play the Weekly Championship'; END IF;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live','scheduled')
        AND class_id = _cid
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
        creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
      VALUES ('Weekly Championship', 'Mathematics', 'hard', 'mcq', 'live', _cid,
        _uid, 25, 15, 25 * 15, true, 'open', 'featured_weekly', now(), _grade)
      RETURNING id INTO _bid;
      SELECT public.rpc_generate_battle(_bid, 15) INTO _n;
      IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available for this week''s Championship yet'; END IF;
    END IF;

  ELSIF _kind = 'ncert' THEN
    IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to play the NCERT Challenge'; END IF;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_ncert' AND starts_at::date = current_date
        AND status IN ('live','scheduled')
        AND class_id = _cid
        AND (class_level IS NOT DISTINCT FROM _grade)
      ORDER BY created_at LIMIT 1;
    IF _existing IS NOT NULL THEN
      _bid := _existing;
    ELSE
      INSERT INTO public.battles (title, subject, difficulty, type, status, class_id,
        creator_user_id, per_question_sec, question_count, duration_sec, is_public, mode, source, starts_at, class_level)
      VALUES ('NCERT Challenge', 'Mathematics', 'easy', 'mcq', 'live', _cid,
        _uid, 20, 10, 20 * 10, true, 'open', 'featured_ncert', now(), _grade)
      RETURNING id INTO _bid;
      SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
      IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available for the NCERT Challenge yet'; END IF;
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
    VALUES ('Beat the Topper · ' || _topper_name, 'Mathematics', 'hard', 'mcq', 'live', _cid,
      _uid, 20, 10, 20 * 10, false, 'duel', 'featured_beat_topper', now(), _grade)
    RETURNING id INTO _bid;
    SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
    IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available to challenge the topper yet'; END IF;

    INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id)
    VALUES (_bid, _topper_uid, _uid)
    ON CONFLICT (battle_id, invited_user_id) DO NOTHING;

    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
      PERFORM public._battle_event('challenge', _uid, _name,
        'is trying to beat the topper, ' || _topper_name, 'Mathematics', _topper_name, _bid, _cid, 'crown');
    END IF;

  ELSIF _kind = 'teacher' THEN
    IF _cid IS NULL THEN RAISE EXCEPTION 'Join a class to see teacher challenges'; END IF;
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'manual' AND class_id = _cid AND is_public = true
        AND status IN ('live','scheduled')
        AND EXISTS (SELECT 1 FROM public.user_roles ur WHERE ur.user_id = battles.creator_user_id AND ur.role = 'teacher')
      ORDER BY starts_at DESC LIMIT 1;
    IF _existing IS NULL THEN
      RAISE EXCEPTION 'No teacher-hosted challenge is live right now — check back soon.';
    END IF;
    _bid := _existing;

  ELSE
    RAISE EXCEPTION 'Unknown featured battle kind: %', _kind;
  END IF;

  -- Ensure caller can read/play under participant RLS
  IF _bid IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.battle_participants WHERE battle_id = _bid AND user_id = _uid
  ) THEN
    INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name)
    VALUES (_bid, _uid, _stu_id, COALESCE(_name, 'Challenger'));
  END IF;

  RETURN _bid;
END; $$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battle(text) TO authenticated;
