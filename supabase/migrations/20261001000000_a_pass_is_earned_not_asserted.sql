-- ═══════════════════════════════════════════════════════════════════════════
-- A pass is earned, not asserted
--
-- Both submit RPCs took the SCORE as a parameter and are granted to
-- `authenticated`. Driven as an ordinary student — a real minted session, the
-- anon key, supabase-js, no privileged credential — this is what that allowed,
-- measured before this migration:
--
--   started a recovery session, answered ZERO questions, submitted full marks
--     -> outcome=ready, readiness=1.0, chapter RECOVERED, revision scheduled
--   submitted 8/8 with no session id and no attempt rows
--     -> passed=true
--   three asserted passes in a row
--     -> solid=true, the chapter left the revision queue entirely, never
--        having been asked a question
--
-- §7 permits a student to clear without learning — "it does not block them; it
-- catches them" — and the catches it names are "no readiness recorded" and
-- "last_recovery_readiness stored and later shown". Those catches are signals.
-- A forgeable signal catches nobody, so the section had no teeth at all.
--
-- THE FIX IS NOT A BLOCK. §7 says "No blocking anywhere", and nothing here
-- blocks: a student may still take a session and do badly, still clear their
-- own mistake book, still walk away. What changes is that the number the
-- engine RECORDS is the number the student EARNED, so the honest signal §7
-- relies on is honest.
--
-- ── WHY question_attempts IS A SOUND FOUNDATION ─────────────────────────────
--
-- rpc_record_question_attempt does not trust the client's `_is_correct`
-- either: for a bank question it re-grades through _practice_grade_from_bank
-- against the answer key. Swept across the whole table before writing this,
-- 0 of 4,841 attempts disagree with the bank. That is the evidence both
-- functions now read.
--
-- ── WHAT EACH CALL MUST NOW HAND OVER ───────────────────────────────────────
--
-- The practice session the check was actually sat in. Both sessions already
-- run inside the practice runner, so the client has that id; it simply was not
-- being sent. Handing a DIFFERENT session does not help:
--
--   recovery  the per-tier counts are joined to the plan's own question ids,
--             so attempts from another session match nothing and score zero.
--   revision  the attempts must be on questions whose chapter IS the chapter
--             being revised, and a practice session may be spent only once.
--
-- Reverse: supabase/migrations/rollback/20261001000000_a_pass_is_earned_not_asserted.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. The evidence each session is scored from ─────────────────────────────
ALTER TABLE public.recovery_sessions
  ADD COLUMN IF NOT EXISTS plan jsonb,
  ADD COLUMN IF NOT EXISTS practice_session_id uuid
    REFERENCES public.practice_sessions(id) ON DELETE SET NULL;

ALTER TABLE public.revision_sessions
  ADD COLUMN IF NOT EXISTS practice_session_id uuid
    REFERENCES public.practice_sessions(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.recovery_sessions.plan IS
  'The §4.2 ladder as built: tiers.{0..3}.from_bank holds the exact question ids asked at each tier. Scoring joins to this, so a score cannot be claimed for questions that were never in the session.';
COMMENT ON COLUMN public.recovery_sessions.practice_session_id IS
  'The practice session this recovery was sat in. The per-tier counts are derived from its question_attempts rows.';
COMMENT ON COLUMN public.revision_sessions.practice_session_id IS
  'The practice session this check was sat in. correct/total are derived from its question_attempts rows; one session may be spent on one check.';

-- One practice session cannot be handed in twice.
CREATE UNIQUE INDEX IF NOT EXISTS revision_sessions_one_per_practice_session
  ON public.revision_sessions (practice_session_id)
  WHERE practice_session_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS recovery_sessions_one_per_practice_session
  ON public.recovery_sessions (practice_session_id)
  WHERE practice_session_id IS NOT NULL;

-- ── 2. The ladder is remembered, so it can be scored against ────────────────
DO $start$
DECLARE _def text; _new text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.prokind = 'f' AND p.proname = 'rpc_start_recovery_session';
  IF _def IS NULL THEN RAISE EXCEPTION 'rpc_start_recovery_session not found'; END IF;
  IF md5(_def) <> 'c3de693fb100dab280096147c47609b3' THEN
    RAISE EXCEPTION 'rpc_start_recovery_session has changed since this was written (live md5 %)', md5(_def);
  END IF;
  _def := replace(_def, E'\r\n', E'\n');

  _new := replace(_def,
$old$  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total
  ) VALUES (
    _uid, _sid, _school, _chapter_id, _round,
    _tot[1], _tot[2], _tot[3], _tot[4]
  ) RETURNING id INTO _rid;$old$,
$new$  -- The plan is STORED, not just returned. Scoring joins the answers back to
  -- these exact question ids, so a tier can only be credited for questions
  -- that were really in the session.
  INSERT INTO public.recovery_sessions (
    user_id, student_id, school_id, chapter_id, round,
    tier0_total, tier1_total, tier2_total, tier3_total, plan
  ) VALUES (
    _uid, _sid, _school, _chapter_id, _round,
    _tot[1], _tot[2], _tot[3], _tot[4], _plan
  ) RETURNING id INTO _rid;$new$);
  IF _new = _def THEN RAISE EXCEPTION 'could not find the recovery_sessions INSERT'; END IF;

  EXECUTE _new;
  RAISE NOTICE 'rpc_start_recovery_session now stores the ladder it built';
END
$start$;

-- ── 3. Recovery is scored from the answers, per tier ────────────────────────
DROP FUNCTION IF EXISTS public.rpc_submit_recovery_session(uuid, integer, integer, integer, integer);

CREATE FUNCTION public.rpc_submit_recovery_session(_session_id uuid, _practice_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid       uuid := auth.uid();
  _rs        public.recovery_sessions%ROWTYPE;
  _corr      int[] := ARRAY[0,0,0,0];
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
      CASE _i WHEN 0 THEN _rs.tier0_total WHEN 1 THEN _rs.tier1_total
              WHEN 2 THEN _rs.tier2_total ELSE _rs.tier3_total END);
  END LOOP;

  _proc_n := _corr[1] + _corr[2];
  _proc_d := _rs.tier0_total + _rs.tier1_total;
  _conc_n := _corr[3] + _corr[4];
  _conc_d := _rs.tier2_total + _rs.tier3_total;

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
    tier0_correct = _corr[1], tier1_correct = _corr[2],
    tier2_correct = _corr[3], tier3_correct = _corr[4],
    procedural_rate = _proc, conceptual_rate = _conc,
    readiness = _ready, outcome = _outcome,
    practice_session_id = _practice_session_id,
    completed_at = now()
  WHERE id = _session_id;

  _interval := public._revision_interval_days(1);

  IF _outcome = 'ready' THEN
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
$fn$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_recovery_session(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_recovery_session(uuid, uuid) TO authenticated;

-- ── 4. A revision check is scored from the answers too ──────────────────────
DROP FUNCTION IF EXISTS public.rpc_submit_revision_session(uuid, integer, integer);

CREATE FUNCTION public.rpc_submit_revision_session(_chapter_id uuid, _practice_session_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $fn$
DECLARE
  _uid      uuid := auth.uid();
  _sid      uuid;
  _school   uuid;
  _cs       public.chapter_state%ROWTYPE;
  _correct  int;
  _total    int;
  _stage    int;
  _pass_thr numeric;
  _rate     numeric;
  _passed   boolean;
  _stages   int;
  _next     int;
  _trigger  text;
  _solid    boolean := false;
  _next_at  timestamptz;
  _state    text;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT * INTO _cs FROM public.chapter_state
   WHERE user_id = _uid AND chapter_id = _chapter_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'this chapter has no revision scheduled'; END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.practice_sessions ps
     WHERE ps.id = _practice_session_id AND ps.user_id = _uid
  ) THEN
    RAISE EXCEPTION 'practice session not found';
  END IF;

  -- One sitting, one check. Without this a single good session could be handed
  -- in again and again to walk the whole ladder.
  IF EXISTS (
    SELECT 1 FROM public.revision_sessions vs
     WHERE vs.practice_session_id = _practice_session_id
  ) THEN
    RAISE EXCEPTION 'that practice session has already been recorded as a revision check';
  END IF;

  ------------------------------------------------------------------
  -- The score, from the answers, bound to THIS chapter
  ------------------------------------------------------------------
  -- Joined through question_bank rather than trusting question_attempts.chapter,
  -- which is free text copied from the session. A session spent on another
  -- chapter contributes nothing here.
  SELECT count(*)::int,
         count(*) FILTER (WHERE qa.is_correct AND NOT COALESCE(qa.skipped, false))::int
    INTO _total, _correct
    FROM public.question_attempts qa
    JOIN public.question_bank qb ON qb.id = qa.bank_question_id
   WHERE qa.session_id = _practice_session_id
     AND qa.user_id = _uid
     AND qb.chapter_id = _chapter_id;

  IF _total IS NULL OR _total = 0 THEN
    RAISE EXCEPTION 'that session answered no question in this chapter — a check with no questions is not a result';
  END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;

  _stage    := GREATEST(_cs.revision_stage, 1);
  _pass_thr := public._recovery_const('REVISION_PASS_THRESHOLD')::numeric;
  _stages   := public._recovery_const('REVISION_STAGES_TO_SOLID')::int;
  _rate     := round(_correct::numeric / _total, 4);
  _passed   := _rate >= _pass_thr;

  -- §5.2 vs §5.1: a chapter that has been through recovery is revising
  -- because of it; one that only met the engagement floor is not.
  _trigger := CASE WHEN _cs.recovered_at IS NOT NULL THEN 'recovery' ELSE 'engagement' END;

  INSERT INTO public.revision_sessions (
    user_id, student_id, school_id, chapter_id, stage,
    correct, total, passed, completed_at, triggered_by, practice_session_id
  ) VALUES (
    _uid, COALESCE(_sid, _cs.student_id), COALESCE(_school, _cs.school_id),
    _chapter_id, _stage, _correct, _total, _passed, now(), _trigger, _practice_session_id
  );

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
    -- §5.5: a failure restarts the ladder and zeroes the streak — three
    -- CONSECUTIVE passes means what it says.
    _next := public._revision_interval_days(1);
    UPDATE public.chapter_state SET
      state = 'revision_failed', consecutive_revision_passes = 0, revision_stage = 1,
      next_revision_at = now() + (_next || ' days')::interval, updated_at = now()
    WHERE user_id = _uid AND chapter_id = _chapter_id;
  END IF;

  SELECT cs.next_revision_at, cs.state INTO _next_at, _state
    FROM public.chapter_state cs
   WHERE cs.user_id = _uid AND cs.chapter_id = _chapter_id;

  RETURN jsonb_build_object(
    'passed', _passed,
    'rate', _rate,
    'correct', _correct,
    'total', _total,
    'stage', _stage,
    'solid', _solid,
    'consecutive_passes', CASE WHEN _passed THEN _cs.consecutive_revision_passes + 1 ELSE 0 END,
    'stages_to_solid', _stages,
    'next_revision_at', _next_at,
    'state', _state);
END;
$fn$;

REVOKE EXECUTE ON FUNCTION public.rpc_submit_revision_session(uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.rpc_submit_revision_session(uuid, uuid) TO authenticated;

COMMIT;
