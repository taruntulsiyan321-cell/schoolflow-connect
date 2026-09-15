-- Rollback for 20261001000000.
--
-- Puts both submit RPCs back to taking the SCORE as a parameter.
--
-- READ THIS FIRST, because this rollback re-opens a hole that was measured,
-- not theorised. As an ordinary authenticated student, with the anon key and
-- no privileged credential, the old signatures allowed:
--
--   a chapter marked RECOVERED at readiness 1.0 with zero questions answered
--   a revision rung cleared by posting 8/8 with no session and no attempts
--   the whole three-check ladder walked to "solid", never having been asked
--   a question
--
-- §7 permits a student to clear without learning and catches them with an
-- honest readiness. With these signatures the readiness is whatever the
-- browser says, so nothing catches anything.
--
-- The client is changed in the same commit and must be rolled back with it:
-- Practice.tsx sends this session's id, and RecoveryEngineService no longer
-- computes a score to send.
--
-- The added columns are deliberately NOT dropped. recovery_sessions.plan,
-- recovery_sessions.practice_session_id and revision_sessions.practice_session_id
-- are the record of which sitting each result came from; dropping them would
-- destroy the evidence for sessions already scored honestly, and they are
-- harmless to leave.

BEGIN;

DROP FUNCTION IF EXISTS public.rpc_submit_recovery_session(uuid, uuid);
DROP FUNCTION IF EXISTS public.rpc_submit_revision_session(uuid, uuid);

CREATE FUNCTION public.rpc_submit_recovery_session(
  _session_id uuid, _tier0_correct integer, _tier1_correct integer,
  _tier2_correct integer, _tier3_correct integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid(); _rs public.recovery_sessions%ROWTYPE;
  _proc_n int; _proc_d int; _conc_n int; _conc_d int;
  _proc numeric; _conc numeric; _ready numeric;
  _p_thr numeric; _c_thr numeric; _outcome text; _interval int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT * INTO _rs FROM public.recovery_sessions WHERE id = _session_id AND user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery session not found'; END IF;
  IF _rs.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('already', true, 'session_id', _rs.id, 'outcome', _rs.outcome);
  END IF;

  _tier0_correct := LEAST(GREATEST(COALESCE(_tier0_correct, 0), 0), _rs.tier0_total);
  _tier1_correct := LEAST(GREATEST(COALESCE(_tier1_correct, 0), 0), _rs.tier1_total);
  _tier2_correct := LEAST(GREATEST(COALESCE(_tier2_correct, 0), 0), _rs.tier2_total);
  _tier3_correct := LEAST(GREATEST(COALESCE(_tier3_correct, 0), 0), _rs.tier3_total);

  _proc_n := _tier0_correct + _tier1_correct;
  _proc_d := _rs.tier0_total + _rs.tier1_total;
  _conc_n := _tier2_correct + _tier3_correct;
  _conc_d := _rs.tier2_total + _rs.tier3_total;

  _proc := CASE WHEN _proc_d > 0 THEN round(_proc_n::numeric / _proc_d, 4) END;
  _conc := CASE WHEN _conc_d > 0 THEN round(_conc_n::numeric / _conc_d, 4) END;
  _ready := CASE WHEN (_proc_d + _conc_d) > 0
                 THEN round((_proc_n + _conc_n)::numeric / (_proc_d + _conc_d), 4) END;

  _p_thr := public._recovery_const('RECOVERY_PROCEDURAL_THRESHOLD')::numeric;
  _c_thr := public._recovery_const('RECOVERY_CONCEPTUAL_THRESHOLD')::numeric;

  _outcome := CASE
    WHEN _proc IS NOT NULL AND _conc IS NOT NULL
     AND _proc >= _p_thr AND _conc >= _c_thr THEN 'ready' ELSE 'not_ready' END;

  UPDATE public.recovery_sessions SET
    tier0_correct = _tier0_correct, tier1_correct = _tier1_correct,
    tier2_correct = _tier2_correct, tier3_correct = _tier3_correct,
    procedural_rate = _proc, conceptual_rate = _conc,
    readiness = _ready, outcome = _outcome, completed_at = now()
  WHERE id = _session_id;

  _interval := public._revision_interval_days(1);

  IF _outcome = 'ready' THEN
    UPDATE public.chapter_state SET
      state = 'recovered', recovered_at = now(),
      next_revision_at = now() + (_interval || ' days')::interval,
      revision_stage = 1, consecutive_revision_passes = 0,
      last_recovery_readiness = _ready, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id;
  ELSE
    UPDATE public.chapter_state SET
      state = 'in_recovery', last_recovery_readiness = _ready, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id;
  END IF;

  RETURN jsonb_build_object(
    'session_id', _rs.id, 'outcome', _outcome,
    'procedural_rate', _proc, 'conceptual_rate', _conc, 'readiness', _ready,
    'procedural_passed', _proc IS NOT NULL AND _proc >= _p_thr,
    'conceptual_passed', _conc IS NOT NULL AND _conc >= _c_thr,
    'next_revision_at', CASE WHEN _outcome = 'ready'
                             THEN (now() + (_interval || ' days')::interval) END);
END;
$fn$;

CREATE FUNCTION public.rpc_submit_revision_session(_chapter_id uuid, _correct integer, _total integer)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid(); _sid uuid; _school uuid;
  _cs public.chapter_state%ROWTYPE;
  _stage int; _pass_thr numeric; _rate numeric; _passed boolean;
  _stages int; _next int; _trigger text; _solid boolean := false;
  _next_at timestamptz; _state text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _total IS NULL OR _total <= 0 THEN
    RAISE EXCEPTION 'a revision check with no questions is not a result';
  END IF;
  _correct := LEAST(GREATEST(COALESCE(_correct, 0), 0), _total);

  SELECT * INTO _cs FROM public.chapter_state WHERE user_id = _uid AND chapter_id = _chapter_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'this chapter has no revision scheduled'; END IF;

  SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  _stage    := GREATEST(_cs.revision_stage, 1);
  _pass_thr := public._recovery_const('REVISION_PASS_THRESHOLD')::numeric;
  _stages   := public._recovery_const('REVISION_STAGES_TO_SOLID')::int;
  _rate     := round(_correct::numeric / _total, 4);
  _passed   := _rate >= _pass_thr;
  _trigger  := CASE WHEN _cs.recovered_at IS NOT NULL THEN 'recovery' ELSE 'engagement' END;

  INSERT INTO public.revision_sessions (
    user_id, student_id, school_id, chapter_id, stage,
    correct, total, passed, completed_at, triggered_by
  ) VALUES (
    _uid, COALESCE(_sid, _cs.student_id), COALESCE(_school, _cs.school_id),
    _chapter_id, _stage, _correct, _total, _passed, now(), _trigger);

  IF _passed THEN
    IF (_cs.consecutive_revision_passes + 1) >= _stages THEN
      _solid := true;
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage, next_revision_at = NULL,
        state = 'recovered', updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    ELSE
      _next := public._revision_interval_days(_stage + 1);
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage + 1,
        next_revision_at = now() + (_next || ' days')::interval,
        state = 'recovered', updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    END IF;
  ELSE
    _next := public._revision_interval_days(1);
    UPDATE public.chapter_state SET
      state = 'revision_failed', consecutive_revision_passes = 0, revision_stage = 1,
      next_revision_at = now() + (_next || ' days')::interval, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _chapter_id;
  END IF;

  SELECT cs.next_revision_at, cs.state INTO _next_at, _state
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chapter_id;

  RETURN jsonb_build_object(
    'passed', _passed, 'rate', _rate, 'stage', _stage, 'solid', _solid,
    'consecutive_passes', CASE WHEN _passed THEN _cs.consecutive_revision_passes + 1 ELSE 0 END,
    'stages_to_solid', _stages, 'next_revision_at', _next_at, 'state', _state);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_recovery_session(uuid, integer, integer, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_session(uuid, integer, integer, integer, integer) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.rpc_submit_revision_session(uuid, integer, integer) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_revision_session(uuid, integer, integer) TO authenticated;

COMMIT;
