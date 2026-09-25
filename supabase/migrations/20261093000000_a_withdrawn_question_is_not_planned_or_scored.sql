-- ===========================================================================
-- A WITHDRAWN QUESTION IS NOT PLANNED, AND NOT SCORED
--
-- The CUET bank repair (20261084000000) withdrew questions (is_active = false)
-- whose copies disagree on the key or that cannot be answered as stored; the
-- mistakes students had made on them stay open in their mistake books.
-- Measured 2026-09-25 on the CUET audit account: a Principles of Management
-- recovery planned 7 questions and the session showed 6 — its tier 0 held
-- "Fayol's principle of Equity", withdrawn for a disputed key, which the app
-- does not serve.
--
--   _recovery_session_plan_for   checked that an upload or capture original
--                                still exists before planning it, but planned
--                                a bank original unconditionally. Now only an
--                                active, approved bank question is planned.
--   rpc_submit_recovery_session  #17: "a planned question the student can no
--                                longer be shown is neither right nor wrong"
--                                tested is_approved only; a withdrawn question
--                                is still approved, so it counted as wrong.
--                                Now is_active too.
--
-- Both bodies are otherwise exactly as live.
--
-- ROLLBACK: rollback/20261093000000_a_withdrawn_question_is_not_planned_or_scored.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public._recovery_session_plan_for(_uid uuid, _chapter_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO 'public'
AS $function$
DECLARE
  _n             int;
  _deep_max      int;
  _wide_max      int;
  _relearn_above int;
  _mode          text;
  _per           int[] := ARRAY[0, 0, 0, 0];
  _sources       jsonb := '[]'::jsonb;
  _tiers         jsonb := '{}'::jsonb;
  _used          uuid[] := ARRAY[]::uuid[];
  _used_upload   uuid[] := ARRAY[]::uuid[];
  _used_capture  uuid[] := ARRAY[]::uuid[];
  _m             record;
  _src           record;
  _tier          smallint;
  _need          int;
  _got           uuid[];
  _ids           uuid[];
  _short         int;
  _total_short   int := 0;
  _proc_filled   int := 0;
  _conc_filled   int := 0;
  _min_proc      int;
  _min_conc      int;
  _filled        int;
  _offerable     boolean;
  _qid_text      text;
  _up_ok         boolean;
  _cap_ok        boolean;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'auth required';
  END IF;

  IF NOT public._recovery_chapter_is_for(_uid, _chapter_id) THEN
    RAISE EXCEPTION 'chapter % is not taught to this student''s section', _chapter_id
      USING HINT = 'The curriculum filter is enforced here, in the query layer, not in the UI.';
  END IF;

  _deep_max      := public._recovery_const('RECOVERY_DEEP_MAX_MISTAKES')::int;
  _wide_max      := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _relearn_above := public._recovery_const('RECOVERY_WIDE_MAX_MISTAKES')::int;
  _min_proc      := public._recovery_const('RECOVERY_MIN_PROCEDURAL_TO_OFFER')::int;
  _min_conc      := public._recovery_const('RECOVERY_MIN_CONCEPTUAL_TO_OFFER')::int;

  SELECT count(*)::int INTO _n
    FROM public.student_mistakes sm
   WHERE sm.user_id = _uid
     AND sm.chapter_id = _chapter_id
     AND sm.status = 'open'
     AND (sm.question_id IS NOT NULL
          OR sm.upload_question_id IS NOT NULL
          OR sm.capture_question_id IS NOT NULL);

  IF _n = 0 THEN
    RETURN jsonb_build_object(
      'mode', 'none', 'open_mistakes', 0,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        'nothing is open in this chapter — there is no mistake to build a session from');
  END IF;

  IF _n > _relearn_above THEN
    RETURN jsonb_build_object(
      'mode', 'relearn', 'open_mistakes', _n, 'relearn_above', _relearn_above,
      'sources', '[]'::jsonb, 'tiers', '{}'::jsonb,
      'shortfall', 0, 'complete', false,
      'offerable_if_generation_exhausted', false,
      'not_offerable_reason',
        format('%s open mistakes in one chapter is not a set of slips to drill away. '
               'Practising %s variant questions would not teach the chapter. '
               'Work through the material again first.', _n, _n * 3));
  END IF;

  IF _n <= _deep_max THEN
    _mode := 'deep';
    _per := ARRAY[
      public._recovery_const('RECOVERY_DEEP_TIER0')::int,
      public._recovery_const('RECOVERY_DEEP_TIER1')::int,
      public._recovery_const('RECOVERY_DEEP_TIER2')::int,
      public._recovery_const('RECOVERY_DEEP_TIER3')::int];
  ELSE
    _mode := 'wide';
    _per := ARRAY[
      public._recovery_const('RECOVERY_WIDE_TIER0')::int,
      public._recovery_const('RECOVERY_WIDE_TIER1')::int,
      public._recovery_const('RECOVERY_WIDE_TIER2')::int,
      public._recovery_const('RECOVERY_WIDE_TIER3')::int];
  END IF;

  FOR _m IN
    SELECT sm.question_id, sm.upload_question_id, sm.capture_question_id,
           sm.difficulty, sm.times_wrong
      FROM public.student_mistakes sm
     WHERE sm.user_id = _uid AND sm.chapter_id = _chapter_id
       AND sm.status = 'open'
       AND (sm.question_id IS NOT NULL
            OR sm.upload_question_id IS NOT NULL
            OR sm.capture_question_id IS NOT NULL)
     ORDER BY sm.times_wrong DESC, sm.last_wrong_at DESC
  LOOP
    _sources := _sources || jsonb_build_object(
      'question_id', _m.question_id,
      'upload_question_id', _m.upload_question_id,
      'capture_question_id', _m.capture_question_id,
      'difficulty', _m.difficulty,
      'times_wrong', _m.times_wrong);

    IF _per[1] <= 0 THEN
      CONTINUE;
    END IF;

    IF _m.question_id IS NOT NULL THEN
      -- Only a question the student can be shown: a bank question withdrawn
      -- after the mistake (retired, or its key disputed) is not an original
      -- that can be asked again (20261093000000).
      IF NOT (_m.question_id = ANY (_used)) AND EXISTS (
           SELECT 1 FROM public.question_bank q
            WHERE q.id = _m.question_id AND q.is_active AND q.is_approved) THEN
        _used := _used || _m.question_id;
      END IF;
    ELSIF _m.upload_question_id IS NOT NULL
          AND NOT (_m.upload_question_id = ANY (_used_upload)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_upload_questions uq
         WHERE uq.id = _m.upload_question_id
           AND uq.owner_id = _uid
      ) INTO _up_ok;
      IF _up_ok THEN
        _used_upload := _used_upload || _m.upload_question_id;
      END IF;
    ELSIF _m.capture_question_id IS NOT NULL
          AND NOT (_m.capture_question_id = ANY (_used_capture)) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.student_capture_questions cq
         WHERE cq.id = _m.capture_question_id
           AND cq.owner_id = _uid
      ) INTO _cap_ok;
      IF _cap_ok THEN
        _used_capture := _used_capture || _m.capture_question_id;
      END IF;
    END IF;
  END LOOP;

  _need := _n * _per[1];
  _filled := COALESCE(array_length(_used, 1), 0)
           + COALESCE(array_length(_used_upload, 1), 0)
           + COALESCE(array_length(_used_capture, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _proc_filled := _proc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{0}', jsonb_build_object(
    'needed', _need,
    'from_bank', to_jsonb(COALESCE(_used, ARRAY[]::uuid[])),
    'from_upload', to_jsonb(COALESCE(_used_upload, ARRAY[]::uuid[])),
    'from_capture', to_jsonb(COALESCE(_used_capture, ARRAY[]::uuid[])),
    'filled', _filled,
    'shortfall', _short,
    'note',
      'own wrongs: bank in from_bank, uploads in from_upload, captures in from_capture'));

  FOREACH _tier IN ARRAY ARRAY[1::smallint, 2::smallint] LOOP
    _need := _n * _per[_tier + 1];
    _got  := ARRAY[]::uuid[];

    IF _need > 0 THEN
      FOR _src IN SELECT value AS v FROM jsonb_array_elements(_sources) LOOP
        _qid_text := _src.v->>'question_id';
        IF _qid_text IS NULL OR _qid_text = '' THEN
          CONTINUE;
        END IF;
        SELECT array_agg(t.qid) INTO _ids
          FROM (
            SELECT qid
              FROM public._recovery_variant_pool(
                     _qid_text::uuid, _tier, _src.v->>'difficulty') AS pool(qid)
             WHERE NOT (qid = ANY (_used))
             LIMIT _per[_tier + 1]
          ) t;
        IF _ids IS NOT NULL THEN
          _got  := _got || _ids;
          _used := _used || _ids;
        END IF;
      END LOOP;
    END IF;

    _filled := COALESCE(array_length(_got, 1), 0);
    _short  := greatest(0, _need - _filled);
    _total_short := _total_short + _short;
    IF _tier = 1 THEN _proc_filled := _proc_filled + _filled;
                 ELSE _conc_filled := _conc_filled + _filled; END IF;

    _tiers := jsonb_set(_tiers, ARRAY[_tier::text], jsonb_build_object(
      'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
      'filled', _filled, 'shortfall', _short,
      'note', 'bank checked first; the shortfall is what generation must supply'));
  END LOOP;

  _need := _n * _per[4];
  _got  := ARRAY[]::uuid[];

  IF _need > 0 THEN
    SELECT array_agg(id) INTO _got
      FROM (
        SELECT qb.id FROM public.question_bank qb
         WHERE qb.chapter_id = _chapter_id
           AND qb.is_active
           AND qb.source_question_id IS NULL
           AND qb.replaced_by_question_id IS NULL
           AND NOT (qb.id = ANY (_used))
           AND NOT EXISTS (SELECT 1 FROM public.student_mistakes sm
                            WHERE sm.user_id = _uid AND sm.question_id = qb.id)
         ORDER BY qb.created_at LIMIT _need
      ) t;
    IF _got IS NOT NULL THEN _used := _used || _got; END IF;
  END IF;

  _filled := COALESCE(array_length(_got, 1), 0);
  _short  := greatest(0, _need - _filled);
  _total_short := _total_short + _short;
  _conc_filled := _conc_filled + _filled;

  _tiers := jsonb_set(_tiers, '{3}', jsonb_build_object(
    'needed', _need, 'from_bank', to_jsonb(COALESCE(_got, ARRAY[]::uuid[])),
    'filled', _filled, 'shortfall', _short,
    'note', CASE WHEN _need = 0 THEN 'not asked for in wide mode'
                 ELSE 'bank where coverage allows; AI otherwise' END));

  _offerable := (_proc_filled >= _min_proc) AND (_conc_filled >= _min_conc);

  RETURN jsonb_build_object(
    'mode', _mode, 'open_mistakes', _n, 'sources', _sources, 'tiers', _tiers,
    'shortfall', _total_short, 'complete', (_total_short = 0),
    'procedural_filled', _proc_filled, 'conceptual_filled', _conc_filled,
    'offerable_if_generation_exhausted', _offerable,
    'not_offerable_reason',
      CASE WHEN _offerable THEN NULL
           WHEN _conc_filled < _min_conc AND _proc_filled < _min_proc THEN
             'the bank holds neither enough procedural nor enough conceptual material for this chapter yet'
           WHEN _conc_filled < _min_conc THEN
             'no conceptual questions exist for these mistakes yet, so the session could not tell you whether you understand it or merely remember the steps'
           ELSE
             'not enough procedural questions exist for these mistakes yet'
      END);
END;
$function$;

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
  _ids_bank  uuid[];
  _ids_up    uuid[];
  _ids_cap   uuid[];
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
  -- §4.2b — each tier counted from the answers given to ITS questions.
  -- Tier 0 may mix bank (from_bank), private uploads (from_upload) and
  -- captures (from_capture). Higher tiers stay bank-only variants.
  -- A skipped question counts as not-correct for its tier: it was asked and
  -- not answered, which is the same evidence as answering it wrongly for the
  -- purpose of "is this idea solid".
  ------------------------------------------------------------------
  FOR _i IN 0..3 LOOP
    SELECT COALESCE(array_agg((v)::uuid), ARRAY[]::uuid[]) INTO _ids_bank
      FROM jsonb_array_elements_text(
             COALESCE(_rs.plan->'tiers'->(_i::text)->'from_bank', '[]'::jsonb)) AS v;

    SELECT COALESCE(array_agg((v)::uuid), ARRAY[]::uuid[]) INTO _ids_up
      FROM jsonb_array_elements_text(
             COALESCE(_rs.plan->'tiers'->(_i::text)->'from_upload', '[]'::jsonb)) AS v;

    SELECT COALESCE(array_agg((v)::uuid), ARRAY[]::uuid[]) INTO _ids_cap
      FROM jsonb_array_elements_text(
             COALESCE(_rs.plan->'tiers'->(_i::text)->'from_capture', '[]'::jsonb)) AS v;

    -- #17: a planned question the student can no longer be shown — a bank row
    -- withdrawn after planning, an upload or capture since deleted — is
    -- neither right nor wrong. It leaves the tier.
    SELECT COALESCE(array_agg(q.id), ARRAY[]::uuid[]) INTO _ids_bank
      FROM public.question_bank q WHERE q.id = ANY(_ids_bank) AND q.is_approved AND q.is_active;
    SELECT COALESCE(array_agg(u.id), ARRAY[]::uuid[]) INTO _ids_up
      FROM public.student_upload_questions u WHERE u.id = ANY(_ids_up) AND u.owner_id = _uid;
    SELECT COALESCE(array_agg(c.id), ARRAY[]::uuid[]) INTO _ids_cap
      FROM public.student_capture_questions c WHERE c.id = ANY(_ids_cap) AND c.owner_id = _uid;
    _tot[_i + 1] := cardinality(_ids_bank) + cardinality(_ids_up) + cardinality(_ids_cap);

    SELECT count(*)::int INTO _n
      FROM public.question_attempts qa
     WHERE qa.session_id = _practice_session_id
       AND qa.user_id = _uid
       AND qa.is_correct
       AND NOT COALESCE(qa.skipped, false)
       AND (
         (cardinality(_ids_bank) > 0 AND qa.bank_question_id = ANY (_ids_bank))
         OR (
           cardinality(_ids_up) > 0
           AND NULLIF(qa.generated_question->>'upload_question_id', '') IS NOT NULL
           AND (qa.generated_question->>'upload_question_id')::uuid = ANY (_ids_up)
         )
         OR (
           cardinality(_ids_cap) > 0
           AND NULLIF(qa.generated_question->>'capture_question_id', '') IS NOT NULL
           AND (qa.generated_question->>'capture_question_id')::uuid = ANY (_ids_cap)
         )
       );
    _corr[_i + 1] := _n;
  END LOOP;

  -- Still clamped to what was ASKED. The counts are derived now, so this can
  -- only fire if a tier's stored total disagrees with its own question list.
  FOR _i IN 0..3 LOOP
    _corr[_i + 1] := LEAST(_corr[_i + 1], _tot[_i + 1]);
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
    -- §4.5: "Those rows -> status = 'cleared', cleared_at set." Without it the
    -- chapter stays above RECOVERY_TRIGGER_COUNT after being recovered, so it
    -- is offered for recovery again immediately and for ever, and
    -- recovery_pending never falls. Only the chapter's OWN open rows, and only
    -- on a pass. §5.5 keeps previously cleared entries cleared; this is the
    -- other half of that sentence.
    UPDATE public.student_mistakes SET
      status = 'cleared', cleared_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id AND status = 'open';

    -- upload §5.1 / recovery §5.1: recovery starts the revision clock.
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

DO $proof$
BEGIN
  IF position('q.is_active AND q.is_approved' IN pg_get_functiondef('public._recovery_session_plan_for(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'the plan still plans withdrawn bank originals';
  END IF;
  IF position('q.is_approved AND q.is_active' IN pg_get_functiondef('public.rpc_submit_recovery_session(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'submit still scores withdrawn questions';
  END IF;
END
$proof$;

COMMIT;
