-- ===========================================================================
-- A WAITING RECOVERY SESSION IS REBUILT WHEN ITS QUESTIONS CHANGE
--
-- rpc_start_recovery_session hands over a session prepared at the end of
-- practice, rebuilding its plan only when the NUMBER of open mistakes in the
-- chapter had changed. The questions can change at the same count — a mistake
-- cleared and another made, a planned bank question withdrawn by the CUET bank
-- repair, a captured question deleted by the student, a variant generated
-- since — and the stale plan was served: measured 2026-09-25 on the CUET audit
-- account, a Principles of Management card said 7 questions and the session
-- showed 6, one of its planned originals withdrawn.
--
-- Now the plan is built fresh at start and replaces the waiting one whenever
-- their tiers differ. Rebuilding at start is safe for the reason the function
-- already gives: nothing has been answered against the old ids yet. The body
-- is otherwise exactly as live.
--
-- ROLLBACK: rollback/20261094000000_a_waiting_recovery_is_rebuilt_when_its_questions_change.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_start_recovery_session(_chapter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid    uuid := auth.uid();
  _sid    uuid;
  _school uuid;
  _plan   jsonb;
  _round  int;
  _rid    uuid;
  _tot    int[] := ARRAY[0,0,0,0];
  _i      int;
  _ok     boolean;
  _mode   text;
  _stale  boolean := false;
  _fresh  jsonb;
  _now_n  int;
  _r0 int; _r1 int; _r2 int; _r3 int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'no student record for this user';
  END IF;

  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id AND rs.completed_at IS NULL
     AND rs.plan IS NOT NULL
   ORDER BY rs.started_at DESC
   LIMIT 1;

  IF _rid IS NOT NULL THEN
    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _r0, _r1, _r2, _r3, _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;

    -- IS THE WAITING PLAN STILL ABOUT THE RIGHT MISTAKES?
    --
    -- Sessions are now prepared at the end of practice, so one can sit unopened
    -- while the student gets three more questions wrong in that chapter. A
    -- plan built against four mistakes and handed over when there are seven
    -- drops three of them — exactly the defect the per-mistake ladder removed,
    -- reintroduced by timing rather than by a cap.
    --
    -- Rebuilding is safe HERE and nowhere later: start runs before the runner
    -- loads a question, so nothing has been answered against the old ids yet.
    SELECT count(*)::int INTO _now_n
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL OR sm.capture_question_id IS NOT NULL);

    -- Stale when the questions differ, not only the count: one mistake cleared
    -- and another made, a planned question withdrawn, a capture deleted, or a
    -- variant generated since — all leave the count where it was (measured
    -- 2026-09-25: a waiting plan kept a withdrawn question and a deleted
    -- capture at the same count, and the session showed fewer than it said).
    _fresh := public._recovery_session_plan_for(_uid, _chapter_id);
    _stale := COALESCE((_plan->>'open_mistakes')::int, -1) <> _now_n
           OR (_fresh->'tiers') IS DISTINCT FROM (_plan->'tiers');

    IF _stale THEN
      _plan := _fresh;
      _mode := _plan->>'mode';

      IF _mode IN ('relearn', 'none') THEN
        -- The chapter has moved out of drilling range since this was prepared.
        -- The waiting session is deleted rather than handed over: it is a
        -- session nobody should sit, and leaving it would have the resume
        -- branch offer it again on every future visit.
        DELETE FROM public.recovery_sessions WHERE id = _rid;
        RETURN jsonb_build_object(
          'started', false, 'mode', _mode,
          'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
          'reason', _plan->>'not_offerable_reason', 'plan', _plan);
      END IF;

      FOR _i IN 0..3 LOOP
        _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
      END LOOP;

      -- The totals are rewritten with the plan. Leaving them would score the
      -- student out of a denominator from the old ladder.
      UPDATE public.recovery_sessions SET
        plan = _plan,
        tier0_total = _tot[1], tier1_total = _tot[2],
        tier2_total = _tot[3], tier3_total = _tot[4]
      WHERE id = _rid;
      _r0 := _tot[1]; _r1 := _tot[2]; _r2 := _tot[3]; _r3 := _tot[4];
    END IF;

    _tot[1] := _r0; _tot[2] := _r1; _tot[3] := _r2; _tot[4] := _r3;

    INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
    VALUES (_uid, _sid, _school, _chapter_id, 'in_recovery')
    ON CONFLICT (user_id, chapter_id) DO UPDATE
      SET state = 'in_recovery', updated_at = now();

    RETURN jsonb_build_object(
      'started', true,
      'resumed', true,
      'refreshed', _stale,
      'session_id', _rid,
      'round', _round,
      'mode', COALESCE(_plan->>'mode', 'deep'),
      'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
      'complete', COALESCE((_plan->>'complete')::boolean, false),
      'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
      'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
      'plan', _plan);
  END IF;

  -- Nothing waiting: build it here. Reached when the chapter crossed the
  -- trigger through a path that does not end a practice session — a battle, a
  -- test — or for a session prepared before this migration existed.
  _plan := public._recovery_session_plan_for(_uid, _chapter_id);
  _mode := _plan->>'mode';

  IF _mode = 'relearn' OR _mode = 'none' THEN
    RETURN jsonb_build_object(
      'started', false, 'mode', _mode,
      'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
      'reason', _plan->>'not_offerable_reason', 'plan', _plan);
  END IF;

  _ok := COALESCE((_plan->>'complete')::boolean, false)
      OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false);

  IF NOT _ok THEN
    RETURN jsonb_build_object(
      'started', false, 'mode', _mode,
      'reason', COALESCE(_plan->>'not_offerable_reason',
        'not enough material to produce a diagnosis for this chapter yet'),
      'plan', _plan);
  END IF;

  FOR _i IN 0..3 LOOP
    _tot[_i + 1] := COALESCE((_plan->'tiers'->(_i::text)->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan)
  VALUES (_uid, _sid, _school, _chapter_id, _round,
          _tot[1], _tot[2], _tot[3], _tot[4], _plan)
  RETURNING id INTO _rid;

  INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
  VALUES (_uid, _sid, _school, _chapter_id, 'in_recovery')
  ON CONFLICT (user_id, chapter_id) DO UPDATE
    SET state = 'in_recovery', updated_at = now();

  RETURN jsonb_build_object(
    'started', true, 'session_id', _rid, 'round', _round, 'mode', _mode,
    'open_mistakes', COALESCE((_plan->>'open_mistakes')::int, 0),
    'complete', COALESCE((_plan->>'complete')::boolean, false),
    'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
    'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
    'plan', _plan);
END;
$function$;

DO $proof$
BEGIN
  IF position('(_fresh->''tiers'') IS DISTINCT FROM (_plan->''tiers'')' IN pg_get_functiondef('public.rpc_start_recovery_session(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'start still judges a waiting plan by its count alone';
  END IF;
END
$proof$;

COMMIT;
