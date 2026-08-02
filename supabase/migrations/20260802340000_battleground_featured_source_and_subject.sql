-- Battleground: preserve featured_* source after question generation;
-- pick featured battle subject from school stream + question bank (not always Mathematics).

-- 1) Never wipe featured_/template/manual sources when filling questions
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
      -- Preserve featured_*, template, manual, etc. — only default empty → bank
      source = CASE
        WHEN nullif(trim(source), '') IS NULL THEN 'bank'
        ELSE source
      END,
      question_count = _inserted,
      duration_sec = per_question_sec * _inserted
    WHERE id = _battle_id;
  RETURN _inserted;
END $$;

-- Repair live featured rows already wiped to source='bank'
UPDATE public.battles
SET source = CASE
  WHEN title ILIKE 'Daily Challenge%' THEN 'featured_daily'
  WHEN title ILIKE 'Weekly Championship%' THEN 'featured_weekly'
  WHEN title ILIKE 'NCERT Challenge%' THEN 'featured_ncert'
  WHEN title ILIKE 'Beat the Topper%' THEN 'featured_beat_topper'
  ELSE source
END
WHERE source = 'bank'
  AND status IN ('live', 'scheduled')
  AND (
    title ILIKE 'Daily Challenge%'
    OR title ILIKE 'Weekly Championship%'
    OR title ILIKE 'NCERT Challenge%'
    OR title ILIKE 'Beat the Topper%'
  );

-- 2) Stream-aware subject for new featured battles
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
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
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
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_daily' AND starts_at::date = current_date
        AND status IN ('live','scheduled')
        AND class_id = _cid
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
      IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Daily Challenge'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
        SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
        IF _n = 0 THEN
          DELETE FROM public.battles WHERE id = _bid;
          RAISE EXCEPTION 'No questions available for today''s Daily Challenge yet';
        END IF;
      END IF;
    END IF;

  ELSIF _kind = 'weekly' THEN
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_weekly' AND date_trunc('week', starts_at) = date_trunc('week', now())
        AND status IN ('live','scheduled')
        AND class_id = _cid
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
      IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create Weekly Championship'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
        SELECT public.rpc_generate_battle(_bid, 15) INTO _n;
        IF _n = 0 THEN
          DELETE FROM public.battles WHERE id = _bid;
          RAISE EXCEPTION 'No questions available for this week''s Championship yet';
        END IF;
      END IF;
    END IF;

  ELSIF _kind = 'ncert' THEN
    SELECT id INTO _existing FROM public.battles
      WHERE source = 'featured_ncert' AND starts_at::date = current_date
        AND status IN ('live','scheduled')
        AND class_id = _cid
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
      IF _bid IS NULL THEN RAISE EXCEPTION 'Could not create NCERT Challenge'; END IF;
      IF NOT EXISTS (SELECT 1 FROM public.battle_questions WHERE battle_id = _bid LIMIT 1) THEN
        SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
        IF _n = 0 THEN
          DELETE FROM public.battles WHERE id = _bid;
          RAISE EXCEPTION 'No questions available for the NCERT Challenge yet';
        END IF;
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
    SELECT public.rpc_generate_battle(_bid, 10) INTO _n;
    IF _n = 0 THEN DELETE FROM public.battles WHERE id = _bid; RAISE EXCEPTION 'No questions available to challenge the topper yet'; END IF;

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
GRANT EXECUTE ON FUNCTION public._pick_featured_subject(uuid, int) TO authenticated;
