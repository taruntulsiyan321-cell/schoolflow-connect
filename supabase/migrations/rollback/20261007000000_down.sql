-- Rollback for 20261007000000_the_session_is_sized_by_the_mistakes.sql
--
-- Restores the fixed 2/3/3/2 ladder, its four constants, and the three
-- function bodies that read them.
--
-- Worth being explicit about what this rollback RE-INTRODUCES, because it is
-- not a neutral undo: with tier 0 capped at two, a student with six open
-- mistakes in a chapter again gets a session containing two of them, and the
-- other four are dropped with no record anywhere that they were.
--
-- recovery_sessions rows written while the forward migration was in force are
-- left alone. Their stored `plan` carries a `mode` key the restored functions
-- do not write, which the restored rpc_start_recovery_session ignores when
-- resuming; nothing reads it and nothing breaks.

BEGIN;

INSERT INTO public.recovery_constants (key, value, spec_ref, rationale) VALUES
  ('RECOVERY_TIER0', 2, '§4.2', 'Tier 0 — the exact questions they got wrong.'),
  ('RECOVERY_TIER1', 3, '§4.2', 'Tier 1 — same question, different values.'),
  ('RECOVERY_TIER2', 3, '§4.2', 'Tier 2 — same concept, different framing.'),
  ('RECOVERY_TIER3', 2, '§4.2', 'Tier 3 — same topic, different application.')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

CREATE OR REPLACE FUNCTION public.rpc_recovery_session_plan(_chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid      uuid := auth.uid();
  _t0 int; _t1 int; _t2 int; _t3 int;
  _sources  jsonb := '[]'::jsonb;
  _tiers    jsonb := '{}'::jsonb;
  _m record; _src record;
  _ids uuid[]; _got uuid[];
  _need int; _tier smallint; _short int; _total_short int := 0;
  _proc int := 0; _conc int := 0;
  _min_proc int; _min_conc int; _offerable boolean; _filled int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF NOT public._recovery_chapter_is_mine(_chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id;
  END IF;

  _t0 := public._recovery_const('RECOVERY_TIER0')::int;
  _t1 := public._recovery_const('RECOVERY_TIER1')::int;
  _t2 := public._recovery_const('RECOVERY_TIER2')::int;
  _t3 := public._recovery_const('RECOVERY_TIER3')::int;
  _min_proc := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_conc := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;

  FOR _m IN
    SELECT sm.question_id, sm.difficulty, sm.times_wrong
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open' AND sm.question_id IS NOT NULL
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
     LIMIT _t0
  LOOP
    _sources := _sources || jsonb_build_object(
      'question_id', _m.question_id, 'difficulty', _m.difficulty, 'times_wrong', _m.times_wrong);
  END LOOP;

  _filled := jsonb_array_length(_sources);
  _proc := _proc + _filled;
  _total_short := _total_short + greatest(0, _t0 - _filled);
  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed', _t0,
    'from_bank', (SELECT COALESCE(jsonb_agg(s->'question_id'), '[]'::jsonb) FROM jsonb_array_elements(_sources) s),
    'filled', _filled,
    'shortfall', greatest(0, _t0 - _filled),
    'note', 'the student''s own wrong questions; nothing to generate'));

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := CASE _tier WHEN 1 THEN _t1 ELSE _t2 END;
    _got  := ARRAY[]::uuid[];
    FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
      EXIT WHEN COALESCE(array_length(_got, 1), 0) >= _need;
      SELECT array_agg(t.qid) INTO _ids
        FROM (
          SELECT qid FROM public._recovery_variant_pool(
                   (_src.v->>'question_id')::uuid, _tier, _src.v->>'difficulty') AS pool(qid)
           WHERE NOT (qid = ANY (_got))
           LIMIT _need - COALESCE(array_length(_got, 1), 0)
        ) t;
      IF _ids IS NOT NULL THEN _got := _got || _ids; END IF;
    END LOOP;
    _filled := COALESCE(array_length(_got, 1), 0);
    _short := greatest(0, _need - _filled);
    _total_short := _total_short + _short;
    IF _tier = 1 THEN _proc := _proc + _filled; ELSE _conc := _conc + _filled; END IF;
    _tiers := jsonb_set(_tiers, ARRAY[_tier::text], jsonb_build_object(
      'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
      'filled', _filled, 'shortfall', _short,
      'note', 'bank checked first; the shortfall is what generation must supply'));
  END LOOP;

  SELECT array_agg(id) INTO _got
    FROM (
      SELECT qb.id FROM public.question_bank qb
       WHERE qb.chapter_id = _chapter_id AND qb.is_active
         AND qb.source_question_id IS NULL AND qb.replaced_by_question_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                          WHERE sm.user_id = _uid AND sm.question_id = qb.id)
       ORDER BY qb.created_at LIMIT _t3
    ) t;
  _filled := COALESCE(array_length(_got, 1), 0);
  _short := greatest(0, _t3 - _filled);
  _total_short := _total_short + _short;
  _conc := _conc + _filled;
  _tiers := jsonb_set(_tiers, '{3}', jsonb_build_object(
    'needed', _t3, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
    'filled', _filled, 'shortfall', _short,
    'note', 'bank where coverage allows; AI otherwise'));

  _offerable := (_proc >= _min_proc) AND (_conc >= _min_conc);

  RETURN jsonb_build_object(
    'sources', _sources, 'tiers', _tiers, 'shortfall', _total_short,
    'complete', (_total_short = 0),
    'procedural_filled', _proc, 'conceptual_filled', _conc,
    'offerable_if_generation_exhausted', _offerable,
    'not_offerable_reason', CASE WHEN _offerable THEN NULL
      ELSE 'not enough material to produce a diagnosis for this chapter yet' END);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_start_recovery_session(_chapter_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE
  _uid uuid := auth.uid();
  _sid uuid; _school uuid; _plan jsonb; _round int; _rid uuid; _t jsonb;
  _tot int[] := ARRAY[0,0,0,0]; _i int; _ok boolean;
  _r0 int; _r1 int; _r2 int; _r3 int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id = _uid LIMIT 1;
  IF _school IS NULL THEN RAISE EXCEPTION 'no student record for this user'; END IF;

  SELECT rs.id INTO _rid FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id
     AND rs.completed_at IS NULL AND rs.plan IS NOT NULL
   ORDER BY rs.started_at DESC LIMIT 1;

  IF _rid IS NOT NULL THEN
    SELECT rs.round, rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total, rs.plan
      INTO _round, _r0, _r1, _r2, _r3, _plan
      FROM public.recovery_sessions rs WHERE rs.id = _rid;
    _tot[1] := _r0; _tot[2] := _r1; _tot[3] := _r2; _tot[4] := _r3;
    RETURN jsonb_build_object('started', true, 'resumed', true, 'session_id', _rid,
      'round', _round, 'complete', COALESCE((_plan->>'complete')::boolean, false),
      'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
      'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4], 'plan', _plan);
  END IF;

  _plan := public.rpc_recovery_session_plan(_chapter_id);
  _ok := COALESCE((_plan->>'complete')::boolean, false)
      OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false);

  IF NOT _ok THEN
    RETURN jsonb_build_object('started', false,
      'reason', COALESCE(_plan->>'not_offerable_reason',
        'not enough material to produce a diagnosis for this chapter yet'),
      'plan', _plan);
  END IF;

  FOR _i IN 0..3 LOOP
    _t := _plan->'tiers'->(_i::text);
    _tot[_i + 1] := COALESCE((_t->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan)
  VALUES (_uid, _sid, _school, _chapter_id, _round,
    _tot[1], _tot[2], _tot[3], _tot[4], _plan) RETURNING id INTO _rid;

  INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
  VALUES (_uid, _sid, _school, _chapter_id, 'in_recovery')
  ON CONFLICT (user_id, chapter_id) DO UPDATE SET state = 'in_recovery', updated_at = now();

  RETURN jsonb_build_object('started', true, 'session_id', _rid, 'round', _round,
    'complete', COALESCE((_plan->>'complete')::boolean, false),
    'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
    'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4], 'plan', _plan);
END;
$fn$;

CREATE OR REPLACE FUNCTION public.rpc_student_recovery_queue()
RETURNS jsonb
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
DECLARE _uid uuid := auth.uid(); _trigger int; _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  _trigger := public._recovery_const('RECOVERY_TRIGGER_COUNT')::int;

  SELECT COALESCE(jsonb_agg(row ORDER BY (row->>'ready')::boolean DESC,
                                         (row->>'open_mistakes')::int DESC), '[]'::jsonb)
    INTO _out
    FROM (
      SELECT jsonb_build_object(
               'chapter_id', m.chapter_id, 'chapter', c.name, 'subject', sub.name,
               'open_mistakes', m.open_mistakes, 'trigger_count', _trigger,
               'ready', (m.open_mistakes >= _trigger),
               'state', COALESCE(cs.state, 'has_mistakes'),
               'in_recovery', (cs.state = 'in_recovery'),
               'last_recovery_readiness', cs.last_recovery_readiness,
               'recovered_at', cs.recovered_at,
               'rounds_taken', COALESCE(rs.rounds, 0)) AS row
        FROM (
          SELECT sm.chapter_id, count(*)::int AS open_mistakes
            FROM public.student_mistakes sm
           WHERE sm.user_id = _uid AND sm.status = 'open' AND sm.chapter_id IS NOT NULL
           GROUP BY sm.chapter_id
        ) m
        LEFT JOIN public.chapters c ON c.id = m.chapter_id
        LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
        LEFT JOIN public.chapter_state cs ON cs.user_id = _uid AND cs.chapter_id = m.chapter_id
        LEFT JOIN (SELECT chapter_id, count(*)::int AS rounds FROM public.recovery_sessions
                    WHERE user_id = _uid GROUP BY chapter_id) rs ON rs.chapter_id = m.chapter_id
    ) t;
  RETURN _out;
END;
$fn$;

COMMIT;
