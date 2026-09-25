-- ROLLBACK of 20261101000000_a_recovery_is_startable_by_one_rule: the three
-- functions as they stood, each with its own copy of the rule and the queue
-- computed in place; the two helpers dropped.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_student_recovery_queue()
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid           uuid := auth.uid();
  _trigger       int;
  _deep_max      int;
  _relearn_above int;
  _out           jsonb := '[]'::jsonb;
  _m             record;
  _plan          jsonb;
  _size          int;
  _startable     boolean;
  _why           text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  _trigger       := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;
  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;

  FOR _m IN
    SELECT m.chapter_id, m.open_mistakes, c.name AS chapter, sub.name AS subject,
           cs.state, cs.last_recovery_readiness, cs.recovered_at, COALESCE(rs.rounds, 0) AS rounds,
           (m.open_mistakes >= _trigger AND m.open_mistakes <= _relearn_above) AS ready
      FROM (
        SELECT sm.chapter_id, count(*)::int AS open_mistakes
          FROM public.student_mistakes sm
         WHERE sm.user_id = _uid
           AND sm.status = 'open'
           AND sm.chapter_id IS NOT NULL
           AND (sm.question_id IS NOT NULL OR sm.upload_question_id IS NOT NULL OR sm.capture_question_id IS NOT NULL)
         GROUP BY sm.chapter_id
      ) m
      LEFT JOIN public.chapters c ON c.id = m.chapter_id
      LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
      LEFT JOIN public.chapter_state cs ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
      LEFT JOIN (
        SELECT chapter_id, count(*)::int AS rounds
          FROM public.recovery_sessions
         WHERE user_id = _uid AND completed_at IS NOT NULL
         GROUP BY chapter_id
      ) rs ON rs.chapter_id = m.chapter_id
  LOOP
    _size := 0; _startable := false; _why := NULL;
    IF _m.ready THEN
      BEGIN
        _plan := public._recovery_session_plan_for(_uid, _m.chapter_id);
        SELECT COALESCE(sum((t.value->>'filled')::int), 0)::int INTO _size
          FROM jsonb_each(COALESCE(_plan->'tiers', '{}'::jsonb)) t;
        _startable := COALESCE((_plan->>'complete')::boolean, false)
                   OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false);
        IF NOT _startable THEN
          _why := COALESCE(_plan->>'not_offerable_reason',
                           'not enough material to produce a diagnosis for this chapter yet');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        _why := SQLERRM;
      END;
    END IF;

    _out := _out || jsonb_build_array(jsonb_build_object(
      'chapter_id',     _m.chapter_id,
      'chapter',        _m.chapter,
      'subject',        _m.subject,
      'open_mistakes',  _m.open_mistakes,
      'trigger_count',  _trigger,
      'ready',          _m.ready,
      'mode',           CASE
                          WHEN _m.open_mistakes > _relearn_above THEN 'relearn'
                          WHEN _m.open_mistakes < _trigger       THEN 'none'
                          WHEN _m.open_mistakes <= _deep_max     THEN 'deep'
                          ELSE 'wide' END,
      'planned_size',   _size,
      'startable',      _startable,
      'blocked_reason', _why,
      'relearn_above',  _relearn_above,
      'state',          COALESCE(_m.state, 'has_mistakes'),
      'in_recovery',    (_m.state = 'in_recovery'),
      'last_recovery_readiness', _m.last_recovery_readiness,
      'recovered_at',   _m.recovered_at,
      'rounds_taken',   _m.rounds
    ));
  END LOOP;

  SELECT COALESCE(jsonb_agg(r ORDER BY (r->>'ready')::boolean DESC, (r->>'open_mistakes')::int DESC), '[]'::jsonb)
    INTO _out FROM jsonb_array_elements(_out) r;
  RETURN _out;
END;
$function$;

CREATE OR REPLACE FUNCTION public._ensure_recovery_session(_uid uuid, _student_id uuid, _school_id uuid, _chapter_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _plan  jsonb;
  _round int;
  _rid   uuid;
  _tot   int[] := ARRAY[0,0,0,0];
  _i     int;
BEGIN
  SELECT rs.id INTO _rid
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id
     AND rs.completed_at IS NULL AND rs.plan IS NOT NULL
   LIMIT 1;
  IF _rid IS NOT NULL THEN RETURN _rid; END IF;

  _plan := public._recovery_session_plan_for(_uid, _chapter_id);

  IF _plan->>'mode' IN ('relearn', 'none') THEN RETURN NULL; END IF;

  -- QUEUE THE MISSING RUNGS BEFORE DECIDING WHETHER TO OFFER THE SESSION.
  --
  -- Order matters and this is the whole point of the change. A plan too thin
  -- to diagnose is precisely the plan whose missing questions most need
  -- writing: refusing to offer it AND refusing to queue anything is how a
  -- chapter stays unofferable for ever. §4.1a says an incomplete session is
  -- not offered and that generation RETRIES IN THE BACKGROUND — the retry has
  -- to be queued from somewhere, and this is it.
  PERFORM public._enqueue_variant_generation(_plan);

  IF NOT (COALESCE((_plan->>'complete')::boolean, false)
          OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false)) THEN
    RETURN NULL;
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
  VALUES (_uid, _student_id, _school_id, _chapter_id, _round,
          _tot[1], _tot[2], _tot[3], _tot[4], _plan)
  RETURNING id INTO _rid;

  RETURN _rid;
END;
$function$;

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

DROP FUNCTION public._recovery_queue_for(uuid);
DROP FUNCTION public._recovery_plan_startable(jsonb);

DELETE FROM public.schema_migrations WHERE version = '20261101000000_a_recovery_is_startable_by_one_rule';

COMMIT;
