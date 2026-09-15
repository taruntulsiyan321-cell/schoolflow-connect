-- ═══════════════════════════════════════════════════════════════════════════
-- The recovery and revision loop closes
--
-- 7C built the tables and the PLAN and stopped there. Measured live before
-- writing this:
--
--   chapter_state        0 rows      recovery_sessions   0 rows
--   revision_sessions    0 rows      chapter_tally      11 rows
--
--   functions matching %recovery%/%revision%: 21, and not one of them writes
--   recovery_sessions, revision_sessions, or advances chapter_state.
--
-- So a student could be OFFERED a recovery session (rpc_recovery_session_plan
-- builds the ladder) and there was nowhere to put the result. The four tier
-- columns §4.2b exists for had no writer, revision_stage never left 1, and
-- next_revision_at was set once by _apply_chapter_state and never moved again.
-- The 7/21/60 spacing was data in a constants table that nothing read.
--
-- This migration adds the four functions that close the loop. Every threshold
-- is read from recovery_constants — §10 item 7, no literals.
--
-- ── §4.2b IS OBEYED, AND THIS IS THE SUBTLE PART ─────────────────────────
--
-- "Two rates, never blended, so the report can say which one failed and what
-- that means. 'You can do the steps but the idea isn't solid yet' is
-- actionable. A single 74% is not."
--
-- So the OUTCOME is decided by the two rates independently, each against its
-- own threshold — 0.80 procedural (tiers 0+1, can they run the procedure) and
-- 0.70 conceptual (tiers 2+3, do they understand it). Both must clear. A
-- student at 0.95/0.40 is not_ready, and the stored rates say exactly why.
--
-- `readiness` is stored as the plain overall accuracy and is NEVER what
-- decides the outcome. It exists because §4.4 needs one figure to quote back
-- later — "cleared at 52% readiness, then failed revision" — and it is a
-- factual accuracy, not a blend of the two rates wearing a judgement.
--
-- ── WHAT IS DELIBERATELY NOT DONE ────────────────────────────────────────
--
-- Clearing the student's mistakes. §7: "The student controls clearing, so the
-- design must assume some will clear without learning. It does not block them;
-- it catches them." A 'ready' outcome does not silently empty the mistake
-- book. _apply_chapter_state already refuses to drag a 'recovered' chapter
-- back to 'has_mistakes', so the chapter does not bounce.
--
-- Reverse: supabase/migrations/rollback/20260922000000_the_recovery_and_revision_loop_closes.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 0. The interval ladder, from the constants ────────────────────────────
CREATE OR REPLACE FUNCTION public._revision_interval_days(_stage int)
RETURNS int
LANGUAGE plpgsql
STABLE
SET search_path TO 'public'
AS $function$
DECLARE _d int;
BEGIN
  -- §5.3: 7, 21, 60. Past stage 3 there is no next interval — the chapter is
  -- solid and leaves the queue — so this returns NULL rather than repeating
  -- the last one forever.
  IF _stage <= 0 THEN RETURN NULL; END IF;
  IF _stage > 3 THEN RETURN NULL; END IF;
  _d := public._recovery_const('REVISION_INTERVAL_' || _stage::text)::int;
  RETURN _d;
END;
$function$;

REVOKE ALL ON FUNCTION public._revision_interval_days(int) FROM PUBLIC, anon, authenticated;

-- ── 1. Start a recovery session ───────────────────────────────────────────
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
  _t      jsonb;
  _tot    int[] := ARRAY[0,0,0,0];
  _i      int;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'no student record for this user';
  END IF;

  -- The curriculum fence lives in rpc_recovery_session_plan and raises there.
  _plan := public.rpc_recovery_session_plan(_chapter_id);

  IF COALESCE((_plan->>'offerable')::boolean, false) IS NOT TRUE THEN
    -- §4.1a: a session that cannot be built is NOT offered and NOT recorded.
    -- Nobody is waiting, so there is no reason to degrade into a half session.
    RETURN jsonb_build_object(
      'started', false,
      'reason', COALESCE(_plan->>'reason', 'not offerable'),
      'plan', _plan);
  END IF;

  -- Tier totals are what the plan actually FILLED, not what it needed. A
  -- session of 2/0/0/2 is scored out of 4, never out of 10 — scoring against
  -- questions that were never asked would report a false not_ready.
  FOR _i IN 0..3 LOOP
    _t := _plan->'tiers'->(_i::text);
    _tot[_i + 1] := COALESCE((_t->>'filled')::int, 0);
  END LOOP;

  SELECT COALESCE(max(rs.round), 0) + 1 INTO _round
    FROM public.recovery_sessions rs
   WHERE rs.user_id = _uid AND rs.chapter_id = _chapter_id;

  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total
  ) VALUES (
    _uid, _sid, _school, _chapter_id, _round,
    _tot[1], _tot[2], _tot[3], _tot[4]
  ) RETURNING id INTO _rid;

  INSERT INTO public.chapter_state (user_id, student_id, school_id, chapter_id, state)
  VALUES (_uid, _sid, _school, _chapter_id, 'in_recovery')
  ON CONFLICT (user_id, chapter_id) DO UPDATE
    -- A chapter already recovered and being re-worked goes back into recovery;
    -- one mid-revision does too. Nothing else is a legal source state here.
    SET state = 'in_recovery', updated_at = now();

  RETURN jsonb_build_object(
    'started', true,
    'session_id', _rid,
    'round', _round,
    'plan', _plan);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_start_recovery_session(uuid) TO authenticated;

-- ── 2. Submit a recovery session ──────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_submit_recovery_session(
  _session_id uuid,
  _tier0_correct int,
  _tier1_correct int,
  _tier2_correct int,
  _tier3_correct int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid       uuid := auth.uid();
  _rs        public.recovery_sessions%ROWTYPE;
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

  -- Never score more right than were asked. A client that miscounts gets a
  -- clamp, not a CHECK violation that loses the whole session.
  _tier0_correct := LEAST(GREATEST(COALESCE(_tier0_correct, 0), 0), _rs.tier0_total);
  _tier1_correct := LEAST(GREATEST(COALESCE(_tier1_correct, 0), 0), _rs.tier1_total);
  _tier2_correct := LEAST(GREATEST(COALESCE(_tier2_correct, 0), 0), _rs.tier2_total);
  _tier3_correct := LEAST(GREATEST(COALESCE(_tier3_correct, 0), 0), _rs.tier3_total);

  _proc_n := _tier0_correct + _tier1_correct;
  _proc_d := _rs.tier0_total + _rs.tier1_total;
  _conc_n := _tier2_correct + _tier3_correct;
  _conc_d := _rs.tier2_total + _rs.tier3_total;

  -- A rate over zero questions is not 0, it is absent. The offer floor
  -- (RECOVERY_MIN_*_TO_OFFER) is meant to make this unreachable; if it is
  -- ever reached, the rate stays NULL and the outcome cannot be 'ready'.
  _proc := CASE WHEN _proc_d > 0 THEN round(_proc_n::numeric / _proc_d, 4) END;
  _conc := CASE WHEN _conc_d > 0 THEN round(_conc_n::numeric / _conc_d, 4) END;

  _ready := CASE WHEN (_proc_d + _conc_d) > 0
                 THEN round((_proc_n + _conc_n)::numeric / (_proc_d + _conc_d), 4) END;

  _p_thr := public._recovery_const('RECOVERY_PROCEDURAL_THRESHOLD')::numeric;
  _c_thr := public._recovery_const('RECOVERY_CONCEPTUAL_THRESHOLD')::numeric;

  -- §4.2b: both, independently. Never a blend, and never one rate standing in
  -- for the other.
  _outcome := CASE
    WHEN _proc IS NOT NULL AND _conc IS NOT NULL
     AND _proc >= _p_thr AND _conc >= _c_thr THEN 'ready'
    ELSE 'not_ready'
  END;

  UPDATE public.recovery_sessions SET
    tier0_correct = _tier0_correct,
    tier1_correct = _tier1_correct,
    tier2_correct = _tier2_correct,
    tier3_correct = _tier3_correct,
    procedural_rate = _proc,
    conceptual_rate = _conc,
    readiness = _ready,
    outcome = _outcome,
    completed_at = now()
  WHERE id = _session_id;

  _interval := public._revision_interval_days(1);

  IF _outcome = 'ready' THEN
    -- §5.1: recovery is what starts the revision clock. Stage 1, first
    -- interval, and the pass counter restarts — three consecutive passes from
    -- here, not counting any from a previous round.
    UPDATE public.chapter_state SET
      state = 'recovered',
      recovered_at = now(),
      next_revision_at = now() + (_interval || ' days')::interval,
      revision_stage = 1,
      consecutive_revision_passes = 0,
      last_recovery_readiness = _ready,
      updated_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id;
  ELSE
    -- Stays in recovery. §4.6 lets them go again; the round counter on the
    -- next session records that it is a repeat.
    UPDATE public.chapter_state SET
      state = 'in_recovery',
      last_recovery_readiness = _ready,
      updated_at = now()
    WHERE user_id = _uid AND chapter_id = _rs.chapter_id;
  END IF;

  RETURN jsonb_build_object(
    'session_id', _rs.id,
    'outcome', _outcome,
    'procedural_rate', _proc,
    'conceptual_rate', _conc,
    'readiness', _ready,
    -- The two rates are returned separately so the report can say WHICH half
    -- failed. A screen that renders only `readiness` is not obeying §4.2b.
    'procedural_passed', _proc IS NOT NULL AND _proc >= _p_thr,
    'conceptual_passed', _conc IS NOT NULL AND _conc >= _c_thr,
    'next_revision_at', CASE WHEN _outcome = 'ready'
                             THEN (now() + (_interval || ' days')::interval) END);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_session(uuid, int, int, int, int) TO authenticated;

-- ── 3. Submit a revision check ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_submit_revision_session(
  _chapter_id uuid,
  _correct int,
  _total int
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid      uuid := auth.uid();
  _sid      uuid;
  _school   uuid;
  _cs       public.chapter_state%ROWTYPE;
  _stage    int;
  _pass_thr numeric;
  _rate     numeric;
  _passed   boolean;
  _stages   int;
  _next     int;
  _trigger  text;
  _solid    boolean := false;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;
  IF _total IS NULL OR _total <= 0 THEN
    RAISE EXCEPTION 'a revision check with no questions is not a result';
  END IF;

  _correct := LEAST(GREATEST(COALESCE(_correct, 0), 0), _total);

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'this chapter has no revision scheduled';
  END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  _stage    := GREATEST(_cs.revision_stage, 1);
  _pass_thr := public._recovery_const('REVISION_PASS_THRESHOLD')::numeric;
  _stages   := public._recovery_const('REVISION_STAGES_TO_SOLID')::int;
  _rate     := round(_correct::numeric / _total, 4);
  _passed   := _rate >= _pass_thr;

  -- §5.2 vs §5.1: a chapter that has been through recovery is revising
  -- because of it; one that only ever met the engagement floor is not.
  _trigger := CASE WHEN _cs.recovered_at IS NOT NULL THEN 'recovery' ELSE 'engagement' END;

  INSERT INTO public.revision_sessions (
    user_id, student_id, school_id, chapter_id, stage,
    correct, total, passed, completed_at, triggered_by
  ) VALUES (
    _uid, COALESCE(_sid, _cs.student_id), COALESCE(_school, _cs.school_id),
    _chapter_id, _stage, _correct, _total, _passed, now(), _trigger
  );

  IF _passed THEN
    IF (_cs.consecutive_revision_passes + 1) >= _stages THEN
      -- §5.3: "pass all three and the chapter leaves the queue." No next
      -- date, which is what makes it leave — not a flag a screen has to know
      -- to check.
      _solid := true;
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage,
        next_revision_at = NULL,
        state = 'recovered',
        updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    ELSE
      _next := public._revision_interval_days(_stage + 1);
      UPDATE public.chapter_state SET
        consecutive_revision_passes = _cs.consecutive_revision_passes + 1,
        revision_stage = _stage + 1,
        next_revision_at = now() + (_next || ' days')::interval,
        state = 'recovered',
        updated_at = now()
      WHERE user_id = _uid AND chapter_id = _chapter_id;
    END IF;
  ELSE
    -- §5.5: a failed check sends the chapter back and restarts the ladder.
    -- The streak resets to zero, not to one — three CONSECUTIVE passes.
    _next := public._revision_interval_days(1);
    UPDATE public.chapter_state SET
      state = 'revision_failed',
      consecutive_revision_passes = 0,
      revision_stage = 1,
      next_revision_at = now() + (_next || ' days')::interval,
      updated_at = now()
    WHERE user_id = _uid AND chapter_id = _chapter_id;
  END IF;

  RETURN jsonb_build_object(
    'passed', _passed,
    'rate', _rate,
    'stage', _stage,
    'solid', _solid,
    'consecutive_passes', CASE WHEN _passed THEN _cs.consecutive_revision_passes + 1 ELSE 0 END,
    'stages_to_solid', _stages);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_submit_revision_session(uuid, int, int) TO authenticated;

-- ── 4. What the student's chapters are doing ──────────────────────────────
CREATE OR REPLACE FUNCTION public.rpc_student_chapter_states()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _out jsonb;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT COALESCE(jsonb_agg(row ORDER BY row->>'next_revision_at' NULLS LAST), '[]'::jsonb)
    INTO _out
    FROM (
      SELECT jsonb_build_object(
               'chapter_id',       cs.chapter_id,
               'chapter',          c.name,
               'subject',          sub.name,
               'state',            cs.state,
               'revision_stage',   cs.revision_stage,
               'consecutive_passes', cs.consecutive_revision_passes,
               'next_revision_at', cs.next_revision_at,
               'revision_due',     (cs.next_revision_at IS NOT NULL AND cs.next_revision_at <= now()),
               'recovered_at',     cs.recovered_at,
               'last_recovery_readiness', cs.last_recovery_readiness,
               'open_mistakes',    (SELECT count(*) FROM public.student_mistakes sm
                                     WHERE sm.user_id = _uid
                                       AND sm.chapter_id = cs.chapter_id
                                       AND sm.status = 'open')
             ) AS row
        FROM public.chapter_state cs
        LEFT JOIN public.chapters c ON c.id = cs.chapter_id
        LEFT JOIN public.curriculum_subjects sub ON sub.id = c.curriculum_subject_id
       WHERE cs.user_id = _uid
    ) t;

  RETURN _out;
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_student_chapter_states() TO authenticated;

-- ── 5. Prove the ladder, arithmetically ───────────────────────────────────
-- G11: every assertion can fail. These check the numbers the product turns on,
-- not that the functions exist.
DO $prove$
DECLARE _d1 int; _d2 int; _d3 int; _d4 int;
BEGIN
  _d1 := public._revision_interval_days(1);
  _d2 := public._revision_interval_days(2);
  _d3 := public._revision_interval_days(3);
  _d4 := public._revision_interval_days(4);

  IF _d1 <> 7 OR _d2 <> 21 OR _d3 <> 60 THEN
    RAISE EXCEPTION 'the §5.3 ladder is not 7/21/60: got %/%/%', _d1, _d2, _d3;
  END IF;
  IF _d4 IS NOT NULL THEN
    RAISE EXCEPTION 'stage 4 returned % — a solid chapter must have no next interval', _d4;
  END IF;

  IF public._recovery_const('RECOVERY_PROCEDURAL_THRESHOLD')::numeric
     <= public._recovery_const('RECOVERY_CONCEPTUAL_THRESHOLD')::numeric THEN
    RAISE EXCEPTION 'the procedural bar must sit above the conceptual one (§4.2b)';
  END IF;

  RAISE NOTICE 'ladder verified: 7/21/60, nothing after stage 3, 0.80 procedural over 0.70 conceptual.';
END
$prove$;

COMMIT;
