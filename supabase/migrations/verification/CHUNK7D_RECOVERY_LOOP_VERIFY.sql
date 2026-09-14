-- ---------------------------------------------------------------------
-- CHUNK 7D VERIFICATION — the recovery/revision loop, ANSWERED end to end
--
-- This file used to hand the engine a score: rpc_submit_recovery_session(sess,
-- t0, t1, 0, 0) and rpc_submit_revision_session(chap, 8, 8). It passed, and it
-- was checking the wrong thing — an engine that took the score on trust was
-- exactly the §7 defect 20261001000000 closed, and a verification written in
-- the same shape could never have caught it.
--
-- So every item below now ANSWERS. It opens a real practice sitting, drives
-- rpc_record_question_attempt for each question, and lets the server grade
-- against the bank — which it does for real: a wrong index is wrong however
-- the caller labels it. The score is then derived from those answers, which is
-- the whole point.
--
-- The case chosen for item 3 is the one §4.2 calls "the most common real
-- result and the most useful thing this feature detects": the procedural half
-- passes and the conceptual half does not. A blended score cannot express it,
-- which is why §4.2b forbids blending.
--
-- Self-rolling-back: one implicit transaction ending in a deliberate RAISE.
-- Every sitting, attempt, session, chapter_state transition and revision row
-- is created and discarded.
-- ---------------------------------------------------------------------

DO $verify$
DECLARE
  _uid      uuid;
  _sid      uuid;
  _school   uuid;
  _chap     uuid;
  _start    jsonb;
  _sess     uuid;
  _sitting  uuid;
  _out      jsonb;
  _p_thr    numeric;
  _c_thr    numeric;
  _t0 int; _t1 int; _t2 int; _t3 int;
  _state    text;
  _next     timestamptz;
  _stage    int;
  _rev      jsonb;
  _days     numeric;
  _q        record;
  _tier     int;
  _want_ok  boolean;
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

  SELECT s.id, s.school_id INTO _sid, _school FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  -- Become that student. auth.uid() reads this, so every RPC below runs under
  -- the same RLS the app runs under, not as the owner.
  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid)::text, true);

  _p_thr := public._recovery_const('RECOVERY_PROCEDURAL_THRESHOLD')::numeric;
  _c_thr := public._recovery_const('RECOVERY_CONCEPTUAL_THRESHOLD')::numeric;

  ------------------------------------------------------------------
  -- 1. A session can be started, and is sized to what was FILLED
  ------------------------------------------------------------------
  _start := public.rpc_start_recovery_session(_chap);
  _sess  := (_start->>'session_id')::uuid;

  SELECT rs.tier0_total, rs.tier1_total, rs.tier2_total, rs.tier3_total
    INTO _t0, _t1, _t2, _t3
    FROM public.recovery_sessions rs WHERE rs.id = _sess;

  _r1 := format('started=%s size=%s tiers=%s/%s/%s/%s complete=%s shortfall=%s plan_stored=%s',
                _start->>'started', _start->>'session_size', _t0, _t1, _t2, _t3,
                _start->>'complete', _start->>'shortfall',
                (SELECT plan IS NOT NULL FROM public.recovery_sessions WHERE id = _sess))
      || CASE WHEN (_start->>'started')::boolean
                   AND (_t0 + _t1 + _t2 + _t3) = (_start->>'session_size')::int
                   AND (SELECT plan IS NOT NULL FROM public.recovery_sessions WHERE id = _sess)
              THEN ' — scored out of what was ASKED, and the ladder is stored so it can be scored against (PASS)'
              ELSE ' — session_size disagrees with the stored tiers, or the ladder was not kept (FAIL)' END;

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
  -- 3. THE §4.2b CASE: procedural answered right, conceptual answered wrong
  ------------------------------------------------------------------
  _sitting := public.rpc_start_practice_session('Mathematics', NULL, 20, 'recovery', NULL, NULL);

  FOR _tier IN 0..3 LOOP
    _want_ok := (_tier <= 1);   -- tiers 0 and 1 right, 2 and 3 wrong
    FOR _q IN
      SELECT qb.id, qb.question, qb.correct_index,
             COALESCE(jsonb_array_length(qb.options), 4) AS n_opts
        FROM public.recovery_sessions rs
        CROSS JOIN LATERAL jsonb_array_elements_text(
          COALESCE(rs.plan->'tiers'->(_tier::text)->'from_bank', '[]'::jsonb)) AS v(qid)
        JOIN public.question_bank qb ON qb.id = v.qid::uuid
       WHERE rs.id = _sess
    LOOP
      PERFORM public.rpc_record_question_attempt(
        _correct_answer     => jsonb_build_object('index', _q.correct_index),
        _generated_question => jsonb_build_object('question', COALESCE(_q.question, 'q'),
                                                  'bank_question_id', _q.id),
        -- Deliberately TRUE for every answer. The server re-grades against the
        -- bank, so this flag is ignored; if it were ever trusted, item 3 would
        -- report a conceptual pass and fail.
        _is_correct         => true,
        _selected_answer    => jsonb_build_object('index',
                                 CASE WHEN _want_ok THEN _q.correct_index
                                      ELSE (_q.correct_index + 1) % _q.n_opts END),
        _session_id         => _sitting,
        _bank_question_id   => _q.id,
        _time_taken_ms      => 30000,
        _source             => 'practice');
    END LOOP;
  END LOOP;

  PERFORM public.rpc_finish_practice_session(_sitting, NULL, true, true);
  _out := public.rpc_submit_recovery_session(_sess, _sitting);

  _r3 := format('procedural=%s (bar %s, passed=%s) conceptual=%s (bar %s, passed=%s) outcome=%s readiness=%s',
                _out->>'procedural_rate', _p_thr, _out->>'procedural_passed',
                _out->>'conceptual_rate', _c_thr, _out->>'conceptual_passed',
                _out->>'outcome', _out->>'readiness')
      || CASE WHEN (_out->>'procedural_passed')::boolean
                   AND NOT (_out->>'conceptual_passed')::boolean
                   AND _out->>'outcome' = 'not_ready'
                   AND (_out->>'procedural_rate')::numeric IS DISTINCT FROM (_out->>'conceptual_rate')::numeric
              THEN ' — the two rates diverge from the ANSWERS and the failing half is named (PASS)'
              ELSE ' — the halves were blended, or the client''s is_correct was believed (FAIL)' END;

  ------------------------------------------------------------------
  -- 4. A full pass recovers the chapter and starts the clock at interval 1
  ------------------------------------------------------------------
  _start := public.rpc_start_recovery_session(_chap);
  _sess  := (_start->>'session_id')::uuid;
  _sitting := public.rpc_start_practice_session('Mathematics', NULL, 20, 'recovery', NULL, NULL);

  FOR _q IN
    SELECT qb.id, qb.question, qb.correct_index
      FROM public.recovery_sessions rs
      CROSS JOIN LATERAL jsonb_array_elements_text(
        COALESCE(rs.plan->'tiers'->'0'->'from_bank', '[]'::jsonb)
        || COALESCE(rs.plan->'tiers'->'1'->'from_bank', '[]'::jsonb)
        || COALESCE(rs.plan->'tiers'->'2'->'from_bank', '[]'::jsonb)
        || COALESCE(rs.plan->'tiers'->'3'->'from_bank', '[]'::jsonb)) AS v(qid)
      JOIN public.question_bank qb ON qb.id = v.qid::uuid
     WHERE rs.id = _sess
  LOOP
    PERFORM public.rpc_record_question_attempt(
      _correct_answer     => jsonb_build_object('index', _q.correct_index),
      _generated_question => jsonb_build_object('question', COALESCE(_q.question, 'q'),
                                                'bank_question_id', _q.id),
      _is_correct         => true,
      _selected_answer    => jsonb_build_object('index', _q.correct_index),
      _session_id         => _sitting,
      _bank_question_id   => _q.id,
      _time_taken_ms      => 30000,
      _source             => 'practice');
  END LOOP;

  PERFORM public.rpc_finish_practice_session(_sitting, NULL, true, true);
  _out := public.rpc_submit_recovery_session(_sess, _sitting);

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
  _sitting := public.rpc_start_practice_session('Mathematics', NULL,
                public._recovery_const('REVISION_COUNT')::int, 'chapter', NULL, NULL);

  FOR _q IN
    SELECT qb.id, qb.question, qb.correct_index
      FROM public.question_bank qb
     WHERE qb.chapter_id = _chap AND qb.is_active AND qb.is_approved
       AND qb.correct_index IS NOT NULL
     ORDER BY qb.id
     LIMIT public._recovery_const('REVISION_COUNT')::int
  LOOP
    PERFORM public.rpc_record_question_attempt(
      _correct_answer     => jsonb_build_object('index', _q.correct_index),
      _generated_question => jsonb_build_object('question', COALESCE(_q.question, 'q'),
                                                'bank_question_id', _q.id),
      _is_correct         => true,
      _selected_answer    => jsonb_build_object('index', _q.correct_index),
      _session_id         => _sitting,
      _bank_question_id   => _q.id,
      _time_taken_ms      => 30000,
      _source             => 'practice');
  END LOOP;

  PERFORM public.rpc_finish_practice_session(_sitting, NULL, true, true);
  _rev := public.rpc_submit_revision_session(_chap, _sitting);

  SELECT cs.next_revision_at, cs.revision_stage, cs.consecutive_revision_passes
    INTO _next, _stage, _t0
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

  _days := EXTRACT(EPOCH FROM (_next - now())) / 86400.0;

  _r5 := format('passed=%s scored %s/%s stage_now=%s consecutive=%s next_in=%s days',
                _rev->>'passed', _rev->>'correct', _rev->>'total', _stage, _t0, round(_days, 2))
      || CASE WHEN (_rev->>'passed')::boolean AND _stage = 2 AND _t0 = 1
                   AND _days BETWEEN 20.9 AND 21.1
              THEN ' — the ladder advanced 7 -> 21 on ANSWERS, it did not repeat (PASS)'
              ELSE ' — the ladder did not advance to REVISION_INTERVAL_2 (FAIL)' END;

  ------------------------------------------------------------------
  -- 6. A failed check resets the streak to ZERO, not to one
  ------------------------------------------------------------------
  -- §5.5 requires three CONSECUTIVE passes. A reset to 1 would let a student
  -- reach "solid" having failed in the middle of the run.
  _sitting := public.rpc_start_practice_session('Mathematics', NULL,
                public._recovery_const('REVISION_COUNT')::int, 'chapter', NULL, NULL);

  FOR _q IN
    SELECT qb.id, qb.question, qb.correct_index,
           COALESCE(jsonb_array_length(qb.options), 4) AS n_opts
      FROM public.question_bank qb
     WHERE qb.chapter_id = _chap AND qb.is_active AND qb.is_approved
       AND qb.correct_index IS NOT NULL
     ORDER BY qb.id
     LIMIT public._recovery_const('REVISION_COUNT')::int
  LOOP
    PERFORM public.rpc_record_question_attempt(
      _correct_answer     => jsonb_build_object('index', _q.correct_index),
      _generated_question => jsonb_build_object('question', COALESCE(_q.question, 'q'),
                                                'bank_question_id', _q.id),
      _is_correct         => true,
      _selected_answer    => jsonb_build_object('index', (_q.correct_index + 1) % _q.n_opts),
      _session_id         => _sitting,
      _bank_question_id   => _q.id,
      _time_taken_ms      => 30000,
      _source             => 'practice');
  END LOOP;

  PERFORM public.rpc_finish_practice_session(_sitting, NULL, true, true);
  _rev := public.rpc_submit_revision_session(_chap, _sitting);

  SELECT cs.state, cs.revision_stage, cs.consecutive_revision_passes
    INTO _state, _stage, _t0
    FROM public.chapter_state cs WHERE cs.user_id = _uid AND cs.chapter_id = _chap;

  _r6 := format('passed=%s scored %s/%s state=%s stage=%s consecutive=%s',
                _rev->>'passed', _rev->>'correct', _rev->>'total', _state, _stage, _t0)
      || CASE WHEN NOT (_rev->>'passed')::boolean AND _state = 'revision_failed'
                   AND _stage = 1 AND _t0 = 0
              THEN ' — a failure restarts the ladder and zeroes the streak (PASS)'
              ELSE ' — a failed check did not reset the run (FAIL)' END;

  RAISE EXCEPTION E'CHUNK7D\n 1) %\n 2) %\n 3) %\n 4) %\n 5) %\n 6) %\n [all rolled back — sittings, attempts, sessions, states and revision rows]',
    _r1, _r2, _r3, _r4, _r5, _r6;
END $verify$;
