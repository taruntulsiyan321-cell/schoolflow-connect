-- ═══════════════════════════════════════════════════════════════════════════
-- A reservation that fails must be given back
--
-- ── THE DEFECT (KNOWN_ISSUES 14) ─────────────────────────────────────────
--
-- `ai_budget_check_and_reserve` writes the units into `ai_budget_usage` BEFORE
-- the work is attempted, which is correct — it is what makes the admission
-- check race-free under the advisory lock. But nothing ever gives them back.
-- `dpp-generate-questions` reserves 2 units and then calls a provider; when the
-- provider is down, returns unparseable JSON, or the request throws, the school
-- has paid 2 units for nothing. A morning of provider trouble can consume a
-- school's whole daily allowance without producing one question, and the only
-- symptom the teacher sees is "come back tomorrow".
--
-- The entry left it alone because "there is no `ai_budget_release`-shaped
-- function to call, so fixing it means adding one." This is that function.
--
-- ── WHAT IT DOES, AND THE THREE THINGS IT REFUSES TO DO ──────────────────
--
-- It is the exact inverse of the reservation and nothing more: subtract the
-- same units from the same two rows, under the same advisory lock so a release
-- cannot interleave with a concurrent reservation's read-then-write.
--
--   1. IT NEVER INSERTS. A release for a school/day with no usage row is a
--      release of something that was never reserved. Creating the row would
--      manufacture a negative balance out of a bug elsewhere; instead nothing
--      happens and the return says so (`released: false`).
--
--   2. IT NEVER GOES BELOW ZERO. `GREATEST(units_used - p_units, 0)`. A double
--      release — a retry, a duplicated failure path — must not mint credit that
--      lets a school exceed its hard limit. Clamping makes the operation
--      idempotent in the direction that matters.
--
--   3. IT IS NOT A CALLER-FACING RPC. `authenticated` and `anon` get no EXECUTE,
--      exactly as `ai_budget_check_and_reserve` has none. A function that lowers
--      your own bill is not something a browser may call. Only the edge
--      functions, which hold service_role, may release — and only what they
--      themselves reserved.
--
-- SECURITY DEFINER matches the reservation: `ai_budget_usage` is not writable
-- by the roles that would otherwise be calling, and the pair has to run under
-- the same authority or the release could fail where the reserve succeeded.
--
-- ── WHAT THIS MIGRATION DELIBERATELY DOES NOT DO ─────────────────────────
--
-- It does not touch `ai_budget_check_and_reserve`, and it does not retro-credit
-- any past failure. There is no record of which historical reservations failed,
-- so any correction would be invented. From here forward the release is called
-- on the failure paths; behind it, the numbers stay as they are.
--
-- §10.9 governs the bank this budget feeds; the budget itself is infrastructure
-- and has no spec clause of its own. The rule being applied is the ordinary one
-- a reservation implies: what you take and do not use, you return.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.ai_budget_release(
  p_school_id  uuid,
  p_feature_id text,
  p_units      numeric DEFAULT 1
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_day          text := to_char((now() AT TIME ZONE 'utc'), 'YYYY-MM-DD');
  v_school_after numeric;
  v_feature_after numeric;
BEGIN
  IF p_school_id IS NULL OR p_feature_id IS NULL OR coalesce(p_units, 0) <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error_code', 'invalid_args');
  END IF;

  -- The SAME lock key the reservation takes. Without it a release could read
  -- between a concurrent reservation's admission check and its write.
  PERFORM pg_advisory_xact_lock(hashtext('ai_budget:' || p_school_id::text));

  -- School-level row. No INSERT: nothing to give back if nothing was taken.
  UPDATE public.ai_budget_usage
     SET units_used = GREATEST(units_used - p_units, 0),
         updated_at = now()
   WHERE school_id = p_school_id
     AND period = 'daily'
     AND period_key = v_day
     AND feature_id IS NULL
  RETURNING units_used INTO v_school_after;

  UPDATE public.ai_budget_usage
     SET units_used = GREATEST(units_used - p_units, 0),
         updated_at = now()
   WHERE school_id = p_school_id
     AND period = 'daily'
     AND period_key = v_day
     AND feature_id = p_feature_id
  RETURNING units_used INTO v_feature_after;

  RETURN jsonb_build_object(
    'ok', true,
    -- FALSE when there was no usage row to decrement. The caller cannot treat
    -- "released" as "the reservation definitely existed" unless this says so.
    'released', (v_school_after IS NOT NULL OR v_feature_after IS NOT NULL),
    'units_used', v_school_after,
    'feature_units_used', v_feature_after
  );
END;
$function$;

-- The grant is the point of this block, not a formality: PUBLIC keeps nothing,
-- and the two browser roles are named only to be excluded by omission — the
-- same shape `ai_budget_check_and_reserve` already has.
REVOKE ALL ON FUNCTION public.ai_budget_release(uuid, text, numeric) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_budget_release(uuid, text, numeric) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_budget_release(uuid, text, numeric) TO service_role;

COMMENT ON FUNCTION public.ai_budget_release(uuid, text, numeric) IS
  'Inverse of ai_budget_check_and_reserve: returns units a caller reserved and '
  'then could not use. Never inserts a usage row, never lets units_used go '
  'below zero, and takes the same advisory lock as the reservation. '
  'service_role only -- a function that lowers a school''s own bill is not '
  'callable from a browser. KNOWN_ISSUES 14.';

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only. This block runs as postgres, which holds EXECUTE
-- on everything, so it cannot prove who is refused (rule 6). probe27 asserts
-- the behaviour and the privilege as the caller (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _def text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _def
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'ai_budget_release';
  IF _def IS NULL THEN
    RAISE EXCEPTION 'ABORT: ai_budget_release was not created';
  END IF;
  IF _def !~ 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'ABORT: ai_budget_release is not SECURITY DEFINER';
  END IF;
  IF _def !~ 'GREATEST' THEN
    RAISE EXCEPTION 'ABORT: the zero clamp is gone -- a double release could mint credit';
  END IF;
  IF _def !~ 'pg_advisory_xact_lock' THEN
    RAISE EXCEPTION 'ABORT: the release does not take the reservation lock';
  END IF;
  IF _def ~* 'INSERT\s+INTO\s+public\.ai_budget_usage' THEN
    RAISE EXCEPTION 'ABORT: the release inserts a usage row -- it must only decrement existing ones';
  END IF;

  IF has_function_privilege('authenticated',
       'public.ai_budget_release(uuid,text,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated can execute ai_budget_release';
  END IF;
  IF has_function_privilege('anon',
       'public.ai_budget_release(uuid,text,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: anon can execute ai_budget_release';
  END IF;
  IF NOT has_function_privilege('service_role',
       'public.ai_budget_release(uuid,text,numeric)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: service_role cannot execute ai_budget_release -- the edge functions could not call it';
  END IF;

  RAISE NOTICE 'ai_budget_release exists with the right shape; behaviour is asserted in probe27.';
END $verify$;
