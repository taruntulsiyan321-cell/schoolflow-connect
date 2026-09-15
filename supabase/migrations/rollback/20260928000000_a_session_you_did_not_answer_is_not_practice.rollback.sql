-- Rollback for 20260928000000.
--
-- Puts rpc_finish_practice_session back to paying for a session nobody
-- answered: the 25-point completion bonus, a practice session on the counter,
-- a day on the activity heatmap with at least a minute of "study time", a
-- streak day, and a progression award — all of it for a finish with zero
-- attempts. It also puts the activity bump back OUTSIDE the first-finish
-- guard, so a second finish of the same session counts again.
--
-- READ THIS FIRST: only run this if something depends on those counts being
-- inflated. Nothing in this repository does. The measurement that prompted the
-- fix was 14 zero-attempt sessions on one account worth 350 XP, and the same
-- account's Analysis heatmap reading 16 sessions and 20 minutes against two
-- sessions actually sat and 0.54 minutes of question time.
--
-- The repaired counters are NOT put back. academic_daily_activity and the
-- practice-session counter on student_xp were recomputed from
-- practice_sessions, which is their source; restoring the old values would
-- mean writing back numbers that never matched the sessions behind them, and
-- the pre-repair values are not recorded anywhere to restore from. If this
-- rollback is applied, those two counters simply stay correct while the
-- function starts inflating them again.
--
-- The edits are undone the same way they were made — by substitution against
-- the live body, with a guard so a failed match is fatal rather than silent.

BEGIN;

DO $undo$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f'
     AND p.proname = 'rpc_finish_practice_session';

  IF _def IS NULL THEN
    RAISE EXCEPTION 'rpc_finish_practice_session not found';
  END IF;

  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
    '_xp := CASE WHEN _total > 0'
      || E'\n              THEN GREATEST(_correct, 0) * 5 + CASE WHEN NOT _already THEN 25 ELSE 0 END'
      || E'\n              ELSE 0 END;',
    '_xp := GREATEST(_correct, 0) * 5 + CASE WHEN NOT _already THEN 25 ELSE 0 END;');
  IF _new = _def THEN RAISE EXCEPTION 'the XP expression is not the one 20260928000000 wrote'; END IF;
  _def := _new;

  _new := replace(_def,
$old$  -- A session with no attempts is not a session. It is not a day of
  -- activity, it is not a minute of study, it is not a practice session on
  -- the counter, it is not a streak day and it is not worth XP. `_total` is
  -- the attempt count this function has just measured from question_attempts
  -- — the same rule the client calls sessionWasAttempted.
  IF NOT _already AND _total > 0 THEN
    -- The time actually spent on the questions, not the clock on the wall.
    -- Wall clock is the fallback for a session with no per-question timing,
    -- and the one-minute floor stays: a session that was sat is not zero.
    _mins := GREATEST(
      CASE WHEN _time_ms > 0
           THEN round(_time_ms / 60000.0)::int
           ELSE COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1)
      END,
      1
    );
    PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);
  END IF;

  IF NOT _already AND _total > 0 THEN$old$,
$new$  _mins := GREATEST(
    COALESCE(extract(epoch FROM (_s.finished_at - _s.created_at))::int / 60, 1),
    1
  );
  PERFORM public._bump_academic_activity(_s.user_id, 0, 0, 0, _mins, 1);

  IF NOT _already THEN$new$);
  IF _new = _def THEN RAISE EXCEPTION 'the activity bump is not the one 20260928000000 wrote'; END IF;

  EXECUTE _new;
  RAISE NOTICE 'rpc_finish_practice_session pays for an unanswered session again';
END
$undo$;

COMMIT;
