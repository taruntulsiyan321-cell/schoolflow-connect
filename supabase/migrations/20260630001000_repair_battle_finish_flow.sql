-- Make Battleground completion reliable.
-- The participant is marked finished first; optional analytics/report helpers cannot block completion.

CREATE OR REPLACE FUNCTION public._maybe_finish_battle(_battle_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _b record;
  _total int;
  _done int;
BEGIN
  SELECT * INTO _b FROM public.battles WHERE id = _battle_id;
  IF _b IS NULL OR _b.status = 'finished' THEN
    RETURN;
  END IF;

  SELECT count(*), count(*) FILTER (WHERE finished_at IS NOT NULL)
    INTO _total, _done
  FROM public.battle_participants
  WHERE battle_id = _battle_id;

  IF _done > 0 AND _done = _total THEN
    UPDATE public.battles SET status = 'finished' WHERE id = _battle_id;
  END IF;
END;
$$;

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

  SELECT MAX(score), count(*)
    INTO _max_score, _participants
  FROM public.battle_participants
  WHERE battle_id = _battle;

  _won := (_score = _max_score AND _score > 0 AND _participants > 1);

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
