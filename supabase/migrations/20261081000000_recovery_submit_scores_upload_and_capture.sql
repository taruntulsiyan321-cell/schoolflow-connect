-- ===========================================================================
-- RECOVERY SUBMIT SCORES from_upload + from_capture
--
-- Binding: docs/custom-practice-upload-spec.md §9 / §5.1
--          docs/screen-capture-mistakes-spec.md §7.4
--          migrations 710 (from_upload) + 770 (from_capture)
--
-- Measured defect: rpc_submit_recovery_session (§4.2b evidence scoring, 010)
-- only joined plan.tiers[n].from_bank to question_attempts.bank_question_id.
-- Tier 0 now also carries private originals in from_upload / from_capture
-- (710/770). Those attempts write bank_question_id NULL and put the private
-- id on generated_question — so a correct answer on an upload/capture
-- original never counted, while tier0_total still included them in the
-- denominator. A student who only recovered their own uploads could never
-- clear procedural readiness.
--
-- Fix: union from_bank + from_upload + from_capture per tier; match attempts
-- by bank_question_id OR generated_question upload/capture id.
-- Keeps §4.5 mistake clear on ready (030), and keeps #17 (20261054000000):
-- each tier counts only the planned questions the student could still be
-- shown — an approved bank row, or an upload/capture original that still
-- exists — for the numerator AND the denominator, and the stored tierN_total
-- is what could actually be asked. (This file was first written from a body
-- that predated #17 and would have put it back.)
--
-- ROLLBACK: rollback/20261081000000_recovery_submit_scores_upload_and_capture.rollback.sql
-- ===========================================================================

BEGIN;

CREATE OR REPLACE FUNCTION public.rpc_submit_recovery_session(
  _session_id uuid,
  _practice_session_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $fn$
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
      FROM public.question_bank q WHERE q.id = ANY(_ids_bank) AND q.is_approved;
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

  FOR _i IN 0..3 LOOP
    _corr[_i + 1] := LEAST(_corr[_i + 1], _tot[_i + 1]);
  END LOOP;

  _proc_n := _corr[1] + _corr[2];
  _proc_d := _tot[1] + _tot[2];
  _conc_n := _corr[3] + _corr[4];
  _conc_d := _tot[3] + _tot[4];

  _proc := CASE WHEN _proc_d > 0 THEN round(_proc_n::numeric / _proc_d, 4) END;
  _conc := CASE WHEN _conc_d > 0 THEN round(_conc_n::numeric / _conc_d, 4) END;
  _ready := CASE WHEN (_proc_d + _conc_d) > 0
                 THEN round((_proc_n + _conc_n)::numeric / (_proc_d + _conc_d), 4) END;

  _p_thr := public._recovery_const('RECOVERY_PROCEDURAL_THRESHOLD')::numeric;
  _c_thr := public._recovery_const('RECOVERY_CONCEPTUAL_THRESHOLD')::numeric;

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
    -- §4.5 — clear this chapter's open mistakes on a pass (030).
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

DO $verify$
DECLARE
  _src text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'rpc_submit_recovery_session'
     AND pg_get_function_identity_arguments(p.oid) = '_session_id uuid, _practice_session_id uuid';
  IF _src IS NULL THEN
    RAISE EXCEPTION 'VERIFY FAILED: rpc_submit_recovery_session(uuid,uuid) missing';
  END IF;
  IF position('from_upload' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: submit still ignores from_upload';
  END IF;
  IF position('from_capture' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: submit still ignores from_capture';
  END IF;
  IF position('upload_question_id' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: submit does not match upload attempts';
  END IF;
  IF position('capture_question_id' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: submit does not match capture attempts';
  END IF;
  -- Positive control: bank-only path must remain.
  IF position('from_bank' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: submit lost from_bank';
  END IF;
  -- #17 must survive: only what could be shown is counted.
  IF position('q.is_approved' IN _src) = 0 OR position('tier0_total = _tot[1]' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: #17 (a question nobody could see is not a wrong answer) lost';
  END IF;
  -- §4.5 clear must still run on ready.
  IF position('status = ''cleared''' IN _src) = 0 THEN
    RAISE EXCEPTION 'VERIFY FAILED: §4.5 mistake clear missing';
  END IF;
END;
$verify$;

COMMIT;
