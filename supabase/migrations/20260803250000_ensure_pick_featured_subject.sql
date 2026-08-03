-- Ensure stream-aware subject helper exists for featured Daily/Weekly/NCERT/Beat Topper.
-- Live DBs that applied refresh APPLY without 20260802340000 were missing this function.
-- Also: teacher ensure must not require subject pick (peek-only path).

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

REVOKE ALL ON FUNCTION public._pick_featured_subject(uuid, int) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public._pick_featured_subject(uuid, int) TO authenticated;

-- Teacher Join peeks live teacher battles; do not call pick until needed.
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
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_rotate_featured_battles') THEN
      PERFORM public.rpc_rotate_featured_battles();
    END IF;
  END IF;

  _cid := public.student_class_id(_uid);
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;

  IF _kind IN ('daily', 'weekly', 'ncert', 'teacher') AND _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to play this featured battle';
  END IF;

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
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_peek_teacher_featured_battle') THEN
      _existing := public._peek_teacher_featured_battle(_cid);
    END IF;
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
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_ensure_featured_battle(text) TO authenticated;
