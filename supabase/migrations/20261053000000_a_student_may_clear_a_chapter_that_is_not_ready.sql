-- §4.4 — "the student decides, the app advises".
--
-- "If not ready, marking the chapter recovered requires an extra confirm —
--  not a block, a speed bump. Whatever they choose, revision will catch it."
--
-- rpc_submit_recovery_session clears the chapter only on 'ready'. On
-- 'not_ready' it leaves the chapter in_recovery, and nothing let the student
-- clear it — the speed bump had become a wall, which §4.4 names as the thing
-- that makes a student stop using the book.
--
-- This is the one door through the bump. It does exactly §4.5, the same
-- writes the 'ready' path makes, and nothing the student can inflate:
--   * it needs a COMPLETED recovery session of the caller's, scored by the
--     server as not_ready — it cannot be used to skip recovery altogether;
--   * it must be the chapter's LATEST completed session, so an old low score
--     cannot be replayed after a newer one;
--   * last_recovery_readiness keeps the SERVER's readiness for that session
--     (already written by rpc_submit_recovery_session), so analysis can say
--     "cleared at 52% readiness" — §4.4 point 4;
--   * the 7-day revision clock starts, stage 1: §4.4 point 3, revision
--     catches a premature clear.
-- The extra confirm itself is the client's; the server records the choice.

CREATE OR REPLACE FUNCTION public.rpc_clear_chapter_after_recovery(_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid      uuid := auth.uid();
  _rs       public.recovery_sessions%ROWTYPE;
  _state    text;
  _interval int;
  _cleared  int;
  _next     timestamptz;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _rs FROM public.recovery_sessions
   WHERE id = _session_id AND user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery session not found'; END IF;
  IF _rs.completed_at IS NULL THEN
    RAISE EXCEPTION 'finish the recovery session before clearing the chapter';
  END IF;
  IF _rs.outcome IS DISTINCT FROM 'not_ready' THEN
    RAISE EXCEPTION 'this session was not scored not ready — nothing to clear anyway';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.recovery_sessions r
     WHERE r.user_id = _uid AND r.chapter_id = _rs.chapter_id
       AND r.completed_at > _rs.completed_at
  ) THEN
    RAISE EXCEPTION 'a newer recovery session exists for this chapter';
  END IF;

  SELECT cs.state INTO _state FROM public.chapter_state cs
   WHERE cs.user_id = _uid AND cs.chapter_id = _rs.chapter_id;
  IF _state = 'recovered' THEN
    RETURN jsonb_build_object('already', true, 'chapter_id', _rs.chapter_id);
  END IF;
  IF _state IS DISTINCT FROM 'in_recovery' THEN
    RAISE EXCEPTION 'this chapter is not in recovery';
  END IF;

  _interval := public._revision_interval_days(1);
  _next := now() + (_interval || ' days')::interval;

  -- §4.5, identical to the 'ready' path in rpc_submit_recovery_session.
  UPDATE public.student_mistakes SET status = 'cleared', cleared_at = now()
   WHERE user_id = _uid AND chapter_id = _rs.chapter_id AND status = 'open';
  GET DIAGNOSTICS _cleared = ROW_COUNT;

  UPDATE public.chapter_state SET
    state = 'recovered', recovered_at = now(),
    next_revision_at = _next,
    revision_stage = 1, consecutive_revision_passes = 0,
    last_recovery_readiness = _rs.readiness, updated_at = now()
  WHERE user_id = _uid AND chapter_id = _rs.chapter_id;

  RETURN jsonb_build_object(
    'chapter_id', _rs.chapter_id,
    'cleared', _cleared,
    'readiness', _rs.readiness,
    'next_revision_at', _next);
END;
$function$;

REVOKE ALL ON FUNCTION public.rpc_clear_chapter_after_recovery(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_clear_chapter_after_recovery(uuid) TO authenticated;
