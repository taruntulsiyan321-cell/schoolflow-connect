-- Gap closure, 2026-08-22: rpc_finish_battle wraps 8 separate side-effect
-- blocks (mistake-history capture, XP counters, win/streak attribution,
-- badge awards, mistake capture, progression awards, activity bump) each in
-- its own `EXCEPTION WHEN OTHERS THEN NULL` -- flagged earlier this session
-- as a "noted concern, not yet verified whether it masks anything real."
-- Investigated concretely this pass: read every protected block again,
-- checked student_xp for any CHECK constraint that could reject the writes
-- (none), and re-confirmed the standing student_xp.level ==
-- progression_level_for_xp(xp) integrity check has shown zero drift on
-- every run this entire session -- no live evidence any of these blocks is
-- actually failing today.
--
-- The granular, block-per-side-effect design itself is sound and
-- deliberate: it's why a badge-award glitch can't also block the activity
-- bump or the progression award in the same call, and none of it can ever
-- block the actual scoring/rank write that happens earlier, unprotected,
-- in the same function -- that's correct: an ancillary counter should not
-- be able to fail an already-graded battle result. What was genuinely
-- missing is that "swallow the error" also meant "make it permanently
-- invisible" -- if any of these ever does start failing (a schema change,
-- a bad migration, a new edge case), there was no way to ever find out.
-- Fixed by keeping the exact same non-blocking behavior but making every
-- swallowed error visible via RAISE WARNING (goes to the Postgres log,
-- inspectable, and costs nothing when nothing is actually failing).
CREATE OR REPLACE FUNCTION public.rpc_finish_battle(_participant_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  _battle_status text;
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

  SELECT status INTO _battle_status FROM public.battles WHERE id = _battle;

  SELECT MAX(score), count(*),
         count(*) FILTER (WHERE score = (SELECT MAX(score) FROM public.battle_participants WHERE battle_id = _battle))
    INTO _max_score, _participants, _tied_at_max
  FROM public.battle_participants
  WHERE battle_id = _battle;

  -- Win only when battle is closed (all done) — avoids premature sole-max lock.
  -- Only the last finisher reaches this block (earlier finishers return on _already),
  -- so we attribute the win once to the sole top scorer (may not be the caller).
  _won := (
    COALESCE(_battle_status, '') = 'finished'
    AND _participants > 1
    AND COALESCE(_max_score, 0) > 0
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
    RAISE WARNING 'rpc_finish_battle(%): student_question_history capture failed: %', _participant_id, SQLERRM;
  END;

  -- Battle counters only — do NOT add score into student_xp.xp or rewrite level (/100).
  BEGIN
    INSERT INTO public.student_xp(user_id, xp, level, total_battles, wins, last_battle_at,
      best_score, total_correct, total_answered, win_streak, best_win_streak, current_streak, longest_streak)
    VALUES (
      _user, 0, 1, 1, 0, now(),
      COALESCE(_score, 0), COALESCE(_correct, 0), COALESCE(_answered, 0),
      0, 0, 0, 0
    )
    ON CONFLICT (user_id) DO UPDATE SET
      total_battles   = student_xp.total_battles + 1,
      last_battle_at  = now(),
      best_score      = GREATEST(student_xp.best_score, COALESCE(_score, 0)),
      total_correct   = student_xp.total_correct + COALESCE(_correct, 0),
      total_answered  = student_xp.total_answered + COALESCE(_answered, 0),
      updated_at      = now();
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_finish_battle(%): student_xp counters update failed: %', _participant_id, SQLERRM;
  END;

  -- Attribute win / streaks once when the battle closes
  IF _won THEN
    BEGIN
      UPDATE public.student_xp sx
      SET
        wins = sx.wins + 1,
        win_streak = sx.win_streak + 1,
        best_win_streak = GREATEST(sx.best_win_streak, sx.win_streak + 1),
        current_streak = COALESCE(sx.current_streak, 0) + 1,
        longest_streak = GREATEST(COALESCE(sx.longest_streak, 0), COALESCE(sx.current_streak, 0) + 1),
        updated_at = now()
      WHERE sx.user_id = (
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle AND bp.score = _max_score
        ORDER BY bp.total_time_ms ASC, bp.joined_at ASC
        LIMIT 1
      );

      UPDATE public.student_xp sx
      SET win_streak = 0, current_streak = 0, updated_at = now()
      WHERE sx.user_id IN (
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle
          AND bp.finished_at IS NOT NULL
          AND bp.user_id <> (
            SELECT bp2.user_id FROM public.battle_participants bp2
            WHERE bp2.battle_id = _battle AND bp2.score = _max_score
            ORDER BY bp2.total_time_ms ASC, bp2.joined_at ASC
            LIMIT 1
          )
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rpc_finish_battle(%): win/streak attribution failed: %', _participant_id, SQLERRM;
    END;
  ELSIF COALESCE(_battle_status, '') = 'finished' THEN
    -- Draw / multi-tie: clear win streaks for all finishers
    BEGIN
      UPDATE public.student_xp sx
      SET win_streak = 0, current_streak = 0, updated_at = now()
      WHERE sx.user_id IN (
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle AND bp.finished_at IS NOT NULL
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rpc_finish_battle(%): draw streak-reset failed: %', _participant_id, SQLERRM;
    END;
  END IF;

  BEGIN
    IF _won THEN
      PERFORM public._award_badge((
        SELECT bp.user_id FROM public.battle_participants bp
        WHERE bp.battle_id = _battle AND bp.score = _max_score
        ORDER BY bp.total_time_ms ASC, bp.joined_at ASC
        LIMIT 1
      ), 'first_win', 'bronze');
    END IF;
    IF _correct >= 5 THEN PERFORM public._award_badge(_user, 'sharp_shooter', 'silver'); END IF;
    IF _answered >= 5 AND _correct = _answered THEN PERFORM public._award_badge(_user, 'flawless', 'gold'); END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_finish_battle(%): badge award failed: %', _participant_id, SQLERRM;
  END;

  BEGIN
    IF EXISTS (SELECT 1 FROM pg_proc WHERE proname = '_capture_battle_mistakes') THEN
      PERFORM public._capture_battle_mistakes(_participant_id);
    END IF;
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_finish_battle(%): mistake capture failed: %', _participant_id, SQLERRM;
  END;

  -- Progression win/top when battle closes (idempotent; works even if winner finished first)
  IF COALESCE(_battle_status, '') = 'finished'
     AND EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'rpc_apply_progression') THEN
    DECLARE
      _bp record;
    BEGIN
      FOR _bp IN
        SELECT id, user_id, rank
        FROM public.battle_participants
        WHERE battle_id = _battle
          AND finished_at IS NOT NULL
          AND rank IS NOT NULL
          AND rank BETWEEN 1 AND 3
      LOOP
        BEGIN
          PERFORM public.rpc_apply_progression(
            CASE WHEN _bp.rank = 1 THEN 'battle.win' ELSE 'battle.top_finish' END,
            'battle',
            _battle::text,
            CASE WHEN _bp.rank = 1 THEN 'battle.win:' ELSE 'battle.top:' END || _bp.id::text,
            NULL,
            jsonb_build_object('via', 'rpc_finish_battle'),
            _bp.user_id
          );
        EXCEPTION WHEN OTHERS THEN
          RAISE WARNING 'rpc_finish_battle(%): progression award failed for participant %: %', _participant_id, _bp.id, SQLERRM;
        END;
      END LOOP;
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'rpc_finish_battle(%): progression award loop failed: %', _participant_id, SQLERRM;
    END;
  END IF;

  BEGIN
    PERFORM public._bump_academic_activity(_user, 0, 1, CASE WHEN _won THEN 1 ELSE 0 END, GREATEST(COALESCE(_time,0) / 60000, 1));
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'rpc_finish_battle(%): activity bump failed: %', _participant_id, SQLERRM;
  END;
END; $function$;
