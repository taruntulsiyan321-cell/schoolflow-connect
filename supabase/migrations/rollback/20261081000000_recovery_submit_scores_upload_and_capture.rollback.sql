-- Rollback 20261081000000 — restore bank-only tier scoring: the definition
-- live before 20261081000000 (010 + §4.5 clear from 030 + #17 from
-- 20261054000000), copied from pg_get_functiondef on 2026-09-24. It used to
-- restore a body that predated #17, which would have undone it.

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_submit_recovery_session(_session_id uuid, _practice_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _uid       uuid := auth.uid();
  _rs        public.recovery_sessions%ROWTYPE;
  _corr      int[] := ARRAY[0,0,0,0];
  _tot       int[] := ARRAY[0,0,0,0];
  _i         int;
  _n         int;
  _ids       uuid[];
  _proc_n    int; _proc_d int;
  _conc_n    int; _conc_d int;
  _proc      numeric; _conc numeric; _ready numeric;
  _p_thr     numeric; _c_thr numeric;
  _outcome   text;
  _interval  int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _rs FROM public.recovery_sessions
   WHERE id = _session_id AND user_id = _uid;
  IF NOT FOUND THEN RAISE EXCEPTION 'recovery session not found'; END IF;

  IF _rs.completed_at IS NOT NULL THEN
    RETURN jsonb_build_object('already', true, 'session_id', _rs.id, 'outcome', _rs.outcome);
  END IF;

  -- A session started before the ladder was stored cannot be scored from
  -- evidence, and guessing is exactly what this function exists to stop.
  IF _rs.plan IS NULL THEN
    RAISE EXCEPTION 'this recovery session predates evidence-based scoring; start a new one';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.practice_sessions ps
     WHERE ps.id = _practice_session_id AND ps.user_id = _uid
  ) THEN
    RAISE EXCEPTION 'practice session not found';
  END IF;

  ------------------------------------------------------------------
  -- §4.2b — each tier counted from the answers given to ITS questions
  ------------------------------------------------------------------
  -- A skipped question counts as not-correct for its tier: it was asked and
  -- not answered, which is the same evidence as answering it wrongly for the
  -- purpose of "is this idea solid".
  FOR _i IN 0..3 LOOP
    SELECT COALESCE(array_agg((v)::uuid), ARRAY[]::uuid[]) INTO _ids
      FROM jsonb_array_elements_text(
             COALESCE(_rs.plan->'tiers'->(_i::text)->'from_bank', '[]'::jsonb)) AS v;

    -- #17: a question withdrawn from the bank after planning could never be
    -- shown, so it is neither right nor wrong — it leaves the tier.
    SELECT COALESCE(array_agg(q.id), ARRAY[]::uuid[]) INTO _ids
      FROM public.question_bank q
     WHERE q.id = ANY(_ids) AND q.is_approved;
    _tot[_i + 1] := COALESCE(array_length(_ids, 1), 0);

    SELECT count(*)::int INTO _n
      FROM public.question_attempts qa
     WHERE qa.session_id = _practice_session_id
       AND qa.user_id = _uid
       AND qa.bank_question_id = ANY(_ids)
       AND qa.is_correct
       AND NOT COALESCE(qa.skipped, false);
    _corr[_i + 1] := _n;
  END LOOP;

  -- Still clamped to what was ASKED. The counts are derived now, so this can
  -- only fire if a tier's stored total disagrees with its own question list.
  FOR _i IN 0..3 LOOP
    _corr[_i + 1] := LEAST(_corr[_i + 1],
      _tot[_i + 1]);
  END LOOP;

  _proc_n := _corr[1] + _corr[2];
  _proc_d := _tot[1] + _tot[2];
  _conc_n := _corr[3] + _corr[4];
  _conc_d := _tot[3] + _tot[4];

  -- A rate over zero questions is not 0, it is absent.
  _proc := CASE WHEN _proc_d > 0 THEN round(_proc_n::numeric / _proc_d, 4) END;
  _conc := CASE WHEN _conc_d > 0 THEN round(_conc_n::numeric / _conc_d, 4) END;
  _ready := CASE WHEN (_proc_d + _conc_d) > 0
                 THEN round((_proc_n + _conc_n)::numeric / (_proc_d + _conc_d), 4) END;

  _p_thr := public._recovery_const('RECOVERY_PROCEDURAL_THRESHOLD')::numeric;
  _c_thr := public._recovery_const('RECOVERY_CONCEPTUAL_THRESHOLD')::numeric;

  -- §4.2b: both, independently. Never a blend, never one standing in for the
  -- other.
  _outcome := CASE
    WHEN _proc IS NOT NULL AND _conc IS NOT NULL
     AND _proc >= _p_thr AND _conc >= _c_thr THEN 'ready'
    ELSE 'not_ready'
  END;

  UPDATE public.recovery_sessions SET
    tier0_total = _tot[1], tier1_total = _tot[2], tier2_total = _tot[3], tier3_total = _tot[4],
    tier0_correct = _corr[1], tier1_correct = _corr[2],
    tier2_correct = _corr[3], tier3_correct = _corr[4],
    procedural_rate = _proc, conceptual_rate = _conc,
    readiness = _ready, outcome = _outcome,
    practice_session_id = _practice_session_id,
    completed_at = now()
  WHERE id = _session_id;

  _interval := public._revision_interval_days(1);

  IF _outcome = 'ready' THEN
    -- §4.5, which nothing implemented: "Those rows -> status = 'cleared',
    -- cleared_at set." Without it the chapter stays above
    -- RECOVERY_TRIGGER_COUNT after being recovered, so it is offered for
    -- recovery again immediately and for ever, and recovery_pending never
    -- falls. Measured before this: 6 open mistakes before a successful
    -- recovery, 6 after, chapter still listed as ready.
    --
    -- Only the chapter's OWN open rows, and only on a pass. §5.5 keeps
    -- previously cleared entries cleared; this is the other half of that
    -- sentence.
    UPDATE public.student_mistakes SET
      status = 'cleared', cleared_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id AND status = 'open';

    -- §5.1: recovery is what starts the revision clock.
    UPDATE public.chapter_state SET
      state = 'recovered', recovered_at = now(),
      next_revision_at = now() + (_interval || ' days')::interval,
      revision_stage = 1, consecutive_revision_passes = 0,
      last_recovery_readiness = _ready, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id;
  ELSE
    -- §4.6 lets them go again; the round counter records the repeat.
    UPDATE public.chapter_state SET
      state = 'in_recovery', last_recovery_readiness = _ready, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id;
  END IF;

  RETURN jsonb_build_object(
    'session_id', _rs.id,
    'outcome', _outcome,
    'procedural_rate', _proc,
    'conceptual_rate', _conc,
    'readiness', _ready,
    'procedural_passed', _proc IS NOT NULL AND _proc >= _p_thr,
    'conceptual_passed', _conc IS NOT NULL AND _conc >= _c_thr,
    'next_revision_at', CASE WHEN _outcome = 'ready'
                             THEN (now() + (_interval || ' days')::interval) END);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_recovery_session(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_session(uuid, uuid) TO authenticated;

COMMIT;
