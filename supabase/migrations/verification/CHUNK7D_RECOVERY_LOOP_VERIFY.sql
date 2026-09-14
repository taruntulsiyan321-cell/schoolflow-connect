-- ---------------------------------------------------------------------
-- CHUNK 7D VERIFICATION — the recovery/revision loop, driven end to end
--
-- 7C built the tables, the constants and the session PLAN. 7D added the half
-- that was missing: the writers that record a finished recovery, decide
-- readiness from TWO rates, and walk the §5.3 revision ladder.
--
-- Those writers had never been executed. The plan side was verifiable with a
-- read; the submit side is not, and asserting that SQL is correct by reading
-- it is exactly what this repository's verification files exist to refuse.
--
-- So every item below drives the REAL rpc as the REAL student, and the whole
-- file is one implicit transaction ending in a deliberate RAISE — the session
-- rows, the chapter_state transitions and the revision rows are all created
-- and all rolled back.
--
-- The case chosen for item 3 is the one §4.2 calls "the most common real
-- result and the most useful thing this feature detects": the procedural half
-- passes and the conceptual half does not. A blended score cannot express it,
-- which is the whole reason §4.2b forbids blending.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _uid      uuid;
  _chap     uuid;
  _start    jsonb;
  _sess     uuid;
  _out      jsonb;
  _p_thr    numeric;
  _c_thr    numeric;
  _t0 int; _t1 int; _t2 int; _t3 int;
  _state    text;
  _next     timestamptz;
  _stage    int;
  _rev      jsonb;
  _days     numeric;
  _r1 text; _r2 text; _r3 text; _r4 text; _r5 text; _r6 text;
BEGIN
  ------------------------------------------------------------------
  -- 0. A student with a chapter the engine can actually build for
  ------------------------------------------------------------------
  SELECT sm.user_id, sm.chapter_id INTO _uid, _chap
    FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.chapter_id IS NOT NULL AND sm.question_id IS NOT NULL
   GROUP BY sm.user_id, sm.chapter_id
   HAVING count(*) >= public._recovery_const('RECOVERY_TRIGGER_COUNT')::int
   ORDER BY count(*) DESC
   LIMIT 1;

  IF _uid IS NULL THEN
    RAISE EXCEPTION 'CHUNK7D: no student has a chapter at the trigger. A skipped check is not a passing check.';
  END IF;

  -- Become that student. auth.uid() reads this, so every RPC below runs under
  -- the same RLS the app runs under, not as the owner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  ------------------------------------------------------------------
  -- 1. A session can be started, and is sized to what was FILLED
  ------------------------------------------------------------------
  _start := public.rpc_start_recovery_session(_chap);
  _sess  := (_start->>'session_id')::uuid;

  SELECT rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total
    INTO _t0, _t1, _t2, _t3
    FROM public.recovery_sessions rs WHERE rs.id = _sess;

  _r1 := format('started=%s size=%s tiers=%s/%s/%s/%s complete=%s shortfall=%s',
                _start->>'started', _start->>'session_size', _t0, _t1, _t2, _t3,
                _start->>'complete', _start->>'shortfall')
      || CASE WHEN (_start->>'started')::boolean
                   AND (_t0 + _t1 + _t2 + _t3) = (_start->>'session_size')::int
              THEN ' — the row is scored out of what was ASKED, never out of the full ladder (PASS)'
              ELSE ' — session_size disagrees with the stored tier totals (FAIL)' END;

  ------------------------------------------------------------------
  -- 2. Starting moves the chapter into recovery
  ------------------------------------------------------------------
  SELECT cs.state INTO _state
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

  _r2 := format('chapter_state=%s', _state)
      || CASE WHEN _state = 'in_recovery'
              THEN ' — §3.2 transition on start (PASS)'
              ELSE ' — the chapter did not enter recovery (FAIL)' END;

  ------------------------------------------------------------------
  -- 3. THE §4.2b CASE: procedural passes, conceptual fails
  ------------------------------------------------------------------
  -- Every procedural question right, every conceptual one wrong. A blended
  -- score would land mid-range and say nothing; the two rates must diverge and
  -- the outcome must be not_ready off the conceptual half alone.
  _p_thr := public._recovery_const('RECOVERY_PROCEDURAL_THRESHOLD')::numeric;
  _c_thr := public._recovery_const('RECOVERY_CONCEPTUAL_THRESHOLD')::numeric;

  _out := public.rpc_submit_recovery_session(_sess, _t0, _t1, 0, 0);

  _r3 := format('procedural=%s (bar %s, passed=%s) conceptual=%s (bar %s, passed=%s) outcome=%s readiness=%s',
                _out->>'procedural_rate', _p_thr, _out->>'procedural_passed',
                _out->>'conceptual_rate', _c_thr, _out->>'conceptual_passed',
                _out->>'outcome', _out->>'readiness')
      || CASE WHEN (_out->>'procedural_passed')::boolean
                   AND NOT (_out->>'conceptual_passed')::boolean
                   AND _out->>'outcome' = 'not_ready'
                   AND (_out->>'procedural_rate')::numeric IS DISTINCT FROM (_out->>'conceptual_rate')::numeric
              THEN ' — the two rates diverge and the failing half is named; a single number could not say this (PASS)'
              ELSE ' — the halves were blended or the outcome ignored one of them (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. A full pass recovers the chapter and starts the clock at interval 1
  ------------------------------------------------------------------
  _start := public.rpc_start_recovery_session(_chap);
  _sess  := (_start->>'session_id')::uuid;
  SELECT rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total
    INTO _t0, _t1, _t2, _t3
    FROM public.recovery_sessions rs WHERE rs.id = _sess;

  _out := public.rpc_submit_recovery_session(_sess, _t0, _t1, _t2, _t3);

  SELECT cs.state, cs.next_revision_at, cs.revision_stage
    INTO _state, _next, _stage
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

  _days := EXTRACT(EPOCH FROM (_next - now())) / 86400.0;

  _r4 := format('outcome=%s state=%s stage=%s next_revision_in=%s days',
                _out->>'outcome', _state, _stage, round(_days, 2))
      || CASE WHEN _out->>'outcome' = 'ready' AND _state = 'recovered' AND _stage = 1
                   AND _days BETWEEN 6.9 AND 7.1
              THEN ' — §5.1/§5.3: recovery starts the clock at REVISION_INTERVAL_1 (PASS)'
              ELSE ' — a full pass did not recover the chapter or did not schedule at 7 days (FAIL)' END;

  ------------------------------------------------------------------
  -- 5. Passing a revision check advances the ladder to interval 2
  ------------------------------------------------------------------
  -- Scored above REVISION_PASS_THRESHOLD, so the stage moves 1 -> 2 and the
  -- next date moves 7 -> 21. A ladder that repeated its first interval would
  -- pass a naive "was it rescheduled" check and fail here.
  _rev := public.rpc_submit_revision_session(_chap, 8, 8);

  SELECT cs.next_revision_at, cs.revision_stage, cs.consecutive_revision_passes
    INTO _next, _stage, _t0
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

  _days := EXTRACT(EPOCH FROM (_next - now())) / 86400.0;

  _r5 := format('passed=%s stage_now=%s consecutive=%s next_in=%s days',
                _rev->>'passed', _stage, _t0, round(_days, 2))
      || CASE WHEN (_rev->>'passed')::boolean AND _stage = 2 AND _t0 = 1
                   AND _days BETWEEN 20.9 AND 21.1
              THEN ' — the ladder advanced 7 -> 21, it did not repeat (PASS)'
              ELSE ' — the ladder did not advance to REVISION_INTERVAL_2 (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. A failed check resets the streak to ZERO, not to one
  ------------------------------------------------------------------
  -- §5.5 requires three CONSECUTIVE passes. A reset to 1 would let a student
  -- reach "solid" having failed in the middle of the run.
  _rev := public.rpc_submit_revision_session(_chap, 0, 8);

  SELECT cs.state, cs.revision_stage, cs.consecutive_revision_passes
    INTO _state, _stage, _t0
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

  _r6 := format('passed=%s state=%s stage=%s consecutive=%s',
                _rev->>'passed', _state, _stage, _t0)
      || CASE WHEN NOT (_rev->>'passed')::boolean AND _state = 'revision_failed'
                   AND _stage = 1 AND _t0 = 0
              THEN ' — a failure restarts the ladder and zeroes the streak (PASS)'
              ELSE ' — a failed check did not reset the run (FAIL)' END;

  RAISE EXCEPTION E'CHUNK7D\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n [all rolled back — sessions, states and revision rows]',
    _r1, _r2, _r3, _r4, _r5, _r6;
END $verify$;
