-- =========================================================
-- Battleground defect fixes (audit High + Medium + P1)
--   1. Duel capacity BEFORE INSERT trigger
--   2. Featured daily/weekly/ncert uniqueness + locked ensure RPC
--   3. Atomic accept-invite + join RPC
--   4. is_battle_participant: auth.uid() only (no uid oracle)
--   5. rpc_finish_battle: tied max score → draw (no XP win)
--   6. rpc_challenge_student: ensure creator is a participant
-- =========================================================

-- ---------------------------------------------------------
-- 1. Duel capacity — hard stop at 2 participants
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public._enforce_duel_capacity()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _mode text;
  _count int;
BEGIN
  SELECT mode INTO _mode FROM public.battles WHERE id = NEW.battle_id;
  IF _mode = 'duel' THEN
    SELECT count(*) INTO _count
    FROM public.battle_participants
    WHERE battle_id = NEW.battle_id;
    IF _count >= 2 THEN
      RAISE EXCEPTION 'This duel is already full.';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_enforce_duel_capacity ON public.battle_participants;
CREATE TRIGGER trg_enforce_duel_capacity
BEFORE INSERT ON public.battle_participants
FOR EACH ROW EXECUTE FUNCTION public._enforce_duel_capacity();

-- ---------------------------------------------------------
-- 4. is_battle_participant — drop arbitrary uid param
-- ---------------------------------------------------------
DROP FUNCTION IF EXISTS public.is_battle_participant(uuid, uuid);

CREATE OR REPLACE FUNCTION public.is_battle_participant(_battle_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.battle_participants
    WHERE battle_id = _battle_id
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_battle_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_battle_participant(uuid) TO authenticated;

-- Recreate policies that call the helper (idempotent)
DROP POLICY IF EXISTS "battles read participant" ON public.battles;
CREATE POLICY "battles read participant" ON public.battles
FOR SELECT TO authenticated
USING (public.is_battle_participant(id));

DROP POLICY IF EXISTS "bp read as participant" ON public.battle_participants;
CREATE POLICY "bp read as participant" ON public.battle_participants
FOR SELECT TO authenticated
USING (public.is_battle_participant(battle_id));

DROP POLICY IF EXISTS "bq read participant" ON public.battle_questions;
CREATE POLICY "bq read participant" ON public.battle_questions
FOR SELECT TO authenticated
USING (public.is_battle_participant(battle_id));

-- ---------------------------------------------------------
-- 2. Featured uniqueness (class-scoped day / week)
-- ---------------------------------------------------------
-- Clean duplicates keeping earliest row so indexes can apply
WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY class_id, (starts_at::date)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.battles
  WHERE source = 'featured_daily'
    AND status IN ('live', 'scheduled')
    AND class_id IS NOT NULL
)
UPDATE public.battles b
SET status = 'cancelled'
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY class_id, date_trunc('week', starts_at)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.battles
  WHERE source = 'featured_weekly'
    AND status IN ('live', 'scheduled')
    AND class_id IS NOT NULL
)
UPDATE public.battles b
SET status = 'cancelled'
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

WITH ranked AS (
  SELECT id,
    ROW_NUMBER() OVER (
      PARTITION BY class_id, (starts_at::date)
      ORDER BY created_at ASC, id ASC
    ) AS rn
  FROM public.battles
  WHERE source = 'featured_ncert'
    AND status IN ('live', 'scheduled')
    AND class_id IS NOT NULL
)
UPDATE public.battles b
SET status = 'cancelled'
FROM ranked r
WHERE b.id = r.id AND r.rn > 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_daily_class_day
  ON public.battles (class_id, ((starts_at)::date))
  WHERE source = 'featured_daily' AND status IN ('live', 'scheduled') AND class_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_weekly_class_week
  ON public.battles (class_id, (date_trunc('week', starts_at)))
  WHERE source = 'featured_weekly' AND status IN ('live', 'scheduled') AND class_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_featured_ncert_class_day
  ON public.battles (class_id, ((starts_at)::date))
  WHERE source = 'featured_ncert' AND status IN ('live', 'scheduled') AND class_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.rpc_ensure_featured_battle(_kind text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  _uid uuid := auth.uid();
  _cid uuid; _grade int; _name text; _bid uuid; _n int;
  _topper_uid uuid; _topper_name text; _existing uuid;
  _stu_id uuid;
  _lock_a int;
  _lock_b int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _cid := public.student_class_id(_uid);
  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger') INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;

  IF _kind IN ('daily', 'weekly', 'ncert', 'teacher') AND _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to play this featured battle';
  END IF;

  -- Serialize create-or-return per class+kind+day/week
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
        VALUES ('Daily Challenge', 'Mathematics', 'medium', 'mcq', 'live', _cid,
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
        VALUES ('Weekly Championship', 'Mathematics', 'hard', 'mcq', 'live', _cid,
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
        VALUES ('NCERT Challenge', 'Mathematics', 'easy', 'mcq', 'live', _cid,
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

-- ---------------------------------------------------------
-- 3. Atomic accept invite + join
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_accept_battle_invite(_invite_id uuid)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
  _inv record;
  _b record;
  _name text;
  _stu_id uuid;
  _count int;
  _existing uuid;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _invite_id IS NULL THEN RAISE EXCEPTION 'Invite required'; END IF;

  SELECT * INTO _inv FROM public.battle_invites WHERE id = _invite_id;
  IF _inv IS NULL THEN RAISE EXCEPTION 'Invite not found'; END IF;
  IF _inv.invited_user_id <> _uid THEN RAISE EXCEPTION 'Not your invite'; END IF;

  SELECT * INTO _b FROM public.battles WHERE id = _inv.battle_id;
  IF _b IS NULL THEN RAISE EXCEPTION 'Battle not found'; END IF;
  IF _b.status = 'finished' THEN RAISE EXCEPTION 'This battle has already finished.'; END IF;
  IF _b.status = 'cancelled' THEN RAISE EXCEPTION 'This battle was cancelled.'; END IF;

  SELECT id INTO _existing FROM public.battle_participants
    WHERE battle_id = _b.id AND user_id = _uid;
  IF _existing IS NOT NULL THEN
    IF _inv.status <> 'accepted' THEN
      UPDATE public.battle_invites SET status = 'accepted' WHERE id = _invite_id;
    END IF;
    RETURN _b.id;
  END IF;

  IF _inv.status NOT IN ('pending', 'accepted') THEN
    RAISE EXCEPTION 'This invite is no longer available.';
  END IF;

  IF _b.mode = 'duel' THEN
    SELECT count(*) INTO _count FROM public.battle_participants WHERE battle_id = _b.id;
    IF _count >= 2 THEN
      RAISE EXCEPTION 'This duel is already full.';
    END IF;
  END IF;

  SELECT full_name INTO _name FROM public.students WHERE user_id = _uid LIMIT 1;
  IF _name IS NULL THEN
    SELECT full_name INTO _name FROM public.profiles WHERE id = _uid LIMIT 1;
  END IF;
  SELECT id INTO _stu_id FROM public.students WHERE user_id = _uid LIMIT 1;

  INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name)
  VALUES (_b.id, _uid, _stu_id, COALESCE(_name, 'Challenger'));

  UPDATE public.battle_invites SET status = 'accepted' WHERE id = _invite_id;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
    PERFORM public._battle_event('join', _uid, COALESCE(_name, 'A challenger'),
      'accepted a ' || _b.subject || ' challenge',
      _b.subject, NULL, _b.id, _b.class_id, 'users');
  END IF;

  RETURN _b.id;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_accept_battle_invite(uuid) TO authenticated;

-- ---------------------------------------------------------
-- 5. Tie = draw for XP (sole top score only wins)
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _user uuid;
  _battle uuid;
  _score int;
  _correct int;
  _answered int;
  _time int;
  _name text;
  _already timestamptz;
  _won boolean := false;
  _max_score int;
  _participants int;
  _tied_at_max int;
  _mins int;
BEGIN
  SELECT user_id, battle_id, score, correct_count, answered_count, total_time_ms, display_name, finished_at
    INTO _user, _battle, _score, _correct, _answered, _time, _name, _already
  FROM public.battle_participants
  WHERE id = _participant_id;

  IF _user IS NULL OR _user <> auth.uid() THEN
    RAISE EXCEPTION 'Not your participation';
  END IF;

  IF _already IS NULL THEN
    UPDATE public.battle_participants
    SET finished_at = now()
    WHERE id = _participant_id;
  END IF;

  WITH ranked AS (
    SELECT id, RANK() OVER (ORDER BY score DESC, total_time_ms ASC, joined_at ASC) AS r
    FROM public.battle_participants
    WHERE battle_id = _battle
  )
  UPDATE public.battle_participants p
  SET rank = r.r
  FROM ranked r
  WHERE p.id = r.id;

  PERFORM public._maybe_finish_battle(_battle);

  IF _already IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT MAX(score), count(*),
         count(*) FILTER (WHERE score = (SELECT MAX(score) FROM public.battle_participants WHERE battle_id = _battle))
    INTO _max_score, _participants, _tied_at_max
  FROM public.battle_participants
  WHERE battle_id = _battle;

  -- Sole top scorer wins; equal max scores among 2+ → draw (no XP win)
  _won := (
    _participants > 1
    AND COALESCE(_score, 0) > 0
    AND _score = _max_score
    AND COALESCE(_tied_at_max, 0) = 1
  );

  BEGIN
    INSERT INTO public.student_question_history (user_id, question_id, times_seen, last_seen_at)
    SELECT _user, bq.bank_question_id, 1, now()
    FROM public.battle_answers ba
    JOIN public.battle_questions bq ON bq.id = ba.question_id
    WHERE ba.participant_id = _participant_id
      AND bq.bank_question_id IS NOT NULL
    ON CONFLICT (user_id, question_id) DO UPDATE
      SET times_seen = student_question_history.times_seen + 1,
          last_seen_at = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at,
      best_score, total_correct, total_answered, win_streak, best_win_streak, current_streak, longest_streak)
    VALUES (_user, _score, 1 + (_score / 100), 1, CASE WHEN _won THEN 1 ELSE 0 END, now(),
      _score, _correct, _answered, CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END,
      CASE WHEN _won THEN 1 ELSE 0 END, CASE WHEN _won THEN 1 ELSE 0 END)
    ON CONFLICT (user_id) DO UPDATE SET
      xp              = student_xp.xp + EXCLUDED.xp,
      level           = 1 + ((student_xp.xp + EXCLUDED.xp) / 100),
      total_battles   = student_xp.total_battles + 1,
      wins            = student_xp.wins + CASE WHEN _won THEN 1 ELSE 0 END,
      last_battle_at  = now(),
      best_score      = GREATEST(student_xp.best_score, _score),
      total_correct   = student_xp.total_correct + _correct,
      total_answered  = student_xp.total_answered + _answered,
      win_streak      = CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END,
      best_win_streak = GREATEST(student_xp.best_win_streak,
                         CASE WHEN _won THEN student_xp.win_streak + 1 ELSE 0 END),
      current_streak  = CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1 ELSE 0 END,
      longest_streak  = GREATEST(COALESCE(student_xp.longest_streak, 0),
                         CASE WHEN _won THEN COALESCE(student_xp.current_streak, 0) + 1 ELSE 0 END),
      updated_at      = now();
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    IF _won THEN PERFORM public._award_badge(_user, 'first_win', 'bronze'); END IF;
    IF _correct >= 5 THEN PERFORM public._award_badge(_user, 'sharp_shooter', 'silver'); END IF;
    IF _answered >= 5 AND _correct = _answered THEN PERFORM public._award_badge(_user, 'flawless', 'gold'); END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_capture_battle_mistakes') THEN
      PERFORM public._capture_battle_mistakes(_participant_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_bump_academic_activity') THEN
      _mins := GREATEST(COALESCE(_time / 60000, 1), 1);
      PERFORM public._bump_academic_activity(_user, 0, 0, 1, _mins);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_award_engagement_badges') THEN
      PERFORM public._award_engagement_badges(_user);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_snapshot_battle_report') THEN
      PERFORM public._snapshot_battle_report(_participant_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    NULL;
  END;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_finish_battle(uuid) TO authenticated;

-- ---------------------------------------------------------
-- 6. Challenge creator must be a participant
-- ---------------------------------------------------------
CREATE OR REPLACE FUNCTION public.rpc_challenge_student(
  _opponent_user_id uuid,
  _subject text,
  _difficulty text DEFAULT 'medium',
  _count int DEFAULT 5,
  _per_q int DEFAULT 20,
  _chapter text DEFAULT NULL,
  _topic text DEFAULT NULL
) RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _bid uuid;
  _cid uuid;
  _n int;
  _name text;
  _grade int;
  _stu_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF _opponent_user_id IS NULL OR _opponent_user_id = auth.uid() THEN
    RAISE EXCEPTION 'Pick a valid classmate to challenge';
  END IF;

  _cid := public.student_class_id(auth.uid());
  IF _cid IS NULL THEN
    RAISE EXCEPTION 'Join a class to challenge classmates';
  END IF;

  IF public.student_class_id(_opponent_user_id) IS DISTINCT FROM _cid THEN
    RAISE EXCEPTION 'You can only challenge classmates from your class';
  END IF;

  _grade := public._class_grade(_cid);
  SELECT COALESCE(full_name, 'A challenger'), id
    INTO _name, _stu_id
  FROM public.students
  WHERE user_id = auth.uid()
  LIMIT 1;

  INSERT INTO public.battles (
    title, subject, chapter, topic, difficulty, type, status, class_id,
    creator_user_id, per_question_sec, question_count, duration_sec,
    is_public, mode, source, starts_at, class_level
  )
  VALUES (
    _name || ' challenges you · ' || _subject,
    _subject, _chapter, _topic, _difficulty, 'mcq', 'live', _cid,
    auth.uid(), _per_q, _count, _per_q * _count,
    false, 'duel', 'bank', now(), _grade
  )
  RETURNING id INTO _bid;

  SELECT public.rpc_generate_battle(_bid, _count) INTO _n;
  IF _n = 0 THEN
    DELETE FROM public.battles WHERE id = _bid;
    RAISE EXCEPTION 'No questions available for this subject yet';
  END IF;

  -- Creator joins immediately so capacity + room access work
  INSERT INTO public.battle_participants (battle_id, user_id, student_id, display_name)
  VALUES (_bid, auth.uid(), _stu_id, COALESCE(_name, 'Challenger'))
  ON CONFLICT (battle_id, user_id) DO NOTHING;

  INSERT INTO public.battle_invites (battle_id, invited_user_id, inviter_user_id, status)
  VALUES (_bid, _opponent_user_id, auth.uid(), 'pending')
  ON CONFLICT (battle_id, invited_user_id) DO UPDATE SET
    status = 'pending',
    inviter_user_id = EXCLUDED.inviter_user_id,
    created_at = now();

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_notify') THEN
    PERFORM public._notify(
      _opponent_user_id,
      'invite',
      'Battle challenge!',
      _name || ' challenged you to a ' || _subject || ' battle.',
      'swords',
      '/student/battleground/battle/' || _bid::text
    );
  END IF;

  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_battle_event') THEN
    PERFORM public._battle_event(
      'challenge',
      auth.uid(),
      _name,
      'threw down a ' || _subject || ' challenge',
      _subject,
      NULL,
      _bid,
      _cid,
      'swords'
    );
  END IF;

  RETURN _bid;
END;
$$;

GRANT EXECUTE ON FUNCTION public.rpc_challenge_student(uuid, text, text, int, int, text, text) TO authenticated;
