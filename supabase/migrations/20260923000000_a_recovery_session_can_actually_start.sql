-- ═══════════════════════════════════════════════════════════════════════════
-- A recovery session can actually start
--
-- 20260922000000 shipped rpc_start_recovery_session reading a key that does
-- not exist:
--
--     IF COALESCE((_plan->>'offerable')::boolean, false) IS NOT TRUE THEN
--                            ^^^^^^^^^
--
-- rpc_recovery_session_plan (7C-C2) returns none. Its contract is:
--
--     complete                            every tier filled, no generation needed
--     generation_required / shortfall     how far short, and by how many
--     offerable_if_generation_exhausted   is what we have worth giving
--     not_offerable_reason                if not, which rate could not be computed
--
-- `->>` on an absent key is NULL, COALESCE makes it false, and the guard fires
-- every time — so every call returned started:false and no recovery session
-- could ever be created. Caught by reading the plan's own return contract, not
-- by a test, because nothing calls it yet.
--
-- ── AND THE §4.1a QUESTION THAT FIELD NAME RAISES ────────────────────────
--
-- "offerable IF generation is exhausted" is a question, not an answer. §4.1a
-- says that while generation can still supply the shortfall, nothing is
-- offered at all — the session retries rather than degrading.
--
-- Measured on the live bank, 2026-09-13:
--
--     question_bank rows with source_question_id (variants):  0 of 21,696
--     rows with variant_tier set:                             0
--
-- There are no variants and nothing producing them: the DPP generator was
-- repurposed into ai-recovery-variants in 7f9142b and is not running. Tiers 1
-- and 2 therefore cannot be filled from the bank for ANY chapter, generation
-- is exhausted by the plain fact that it is not happening, and the honest
-- reading of §4.1a is to offer what exists once the floor is met.
--
-- That is a real product limit and it is reported, not hidden: `complete` and
-- `shortfall` come back on every start so the screen can say the session is
-- running short and why. §4.2a: "A variant that cannot be generated is
-- skipped, not faked. The session runs short and says so."
--
-- Reverse: supabase/migrations/rollback/20260923000000_a_recovery_session_can_actually_start.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

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
  _ok     boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required'; END IF;

  SELECT s.id, s.school_id INTO _sid, _school
    FROM public.students s WHERE s.user_id = _uid LIMIT 1;
  IF _school IS NULL THEN
    RAISE EXCEPTION 'no student record for this user';
  END IF;

  -- The curriculum fence lives in the plan and raises there.
  _plan := public.rpc_recovery_session_plan(_chapter_id);

  -- The plan's real contract. A complete ladder is always offerable; a short
  -- one only once it clears the two floors, which is what this field answers.
  _ok := COALESCE((_plan->>'complete')::boolean, false)
      OR COALESCE((_plan->>'offerable_if_generation_exhausted')::boolean, false);

  IF NOT _ok THEN
    RETURN jsonb_build_object(
      'started', false,
      'reason', COALESCE(
        _plan->>'not_offerable_reason',
        'not enough material to produce a diagnosis for this chapter yet'),
      'plan', _plan);
  END IF;

  -- Tier totals are what the plan FILLED, not what it needed. A 2/0/0/2
  -- session is scored out of 4, never out of 10 — scoring against questions
  -- that were never asked would report a false not_ready.
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
    SET state = 'in_recovery', updated_at = now();

  RETURN jsonb_build_object(
    'started', true,
    'session_id', _rid,
    'round', _round,
    -- Surfaced so the screen can say the session is short and why, rather
    -- than the student silently getting four questions where the design says
    -- ten. §4.2a: it runs short and SAYS SO.
    'complete', COALESCE((_plan->>'complete')::boolean, false),
    'shortfall', COALESCE((_plan->>'shortfall')::int, 0),
    'session_size', _tot[1] + _tot[2] + _tot[3] + _tot[4],
    'plan', _plan);
END;
$function$;

GRANT EXECUTE ON FUNCTION public.rpc_start_recovery_session(uuid) TO authenticated;

-- ── Prove the guard reads keys that exist ─────────────────────────────────
-- G11: fails if the plan's contract changes under this function again. It
-- asserts on the plan's OWN output for a real chapter, never on a literal.
DO $prove$
DECLARE _plan jsonb; _chapter uuid;
BEGIN
  SELECT chapter_id INTO _chapter
    FROM public.student_mistakes
   WHERE chapter_id IS NOT NULL
   LIMIT 1;

  IF _chapter IS NULL THEN
    RAISE WARNING 'no keyed mistake to build a plan from; contract not exercised';
    RETURN;
  END IF;

  -- Called as the owner, so the curriculum fence inside the plan is not what
  -- is under test here — the shape of what it returns is.
  BEGIN
    _plan := public.rpc_recovery_session_plan(_chapter);
  EXCEPTION WHEN OTHERS THEN
    RAISE WARNING 'plan could not be built here (%); contract not exercised', SQLERRM;
    RETURN;
  END;

  IF NOT (_plan ? 'offerable_if_generation_exhausted') THEN
    RAISE EXCEPTION 'the plan no longer returns offerable_if_generation_exhausted; rpc_start_recovery_session is reading a key that does not exist';
  END IF;
  IF NOT (_plan ? 'complete') OR NOT (_plan ? 'shortfall') THEN
    RAISE EXCEPTION 'the plan no longer returns complete/shortfall; the short-session warning would be silent';
  END IF;
  IF _plan ? 'offerable' THEN
    RAISE EXCEPTION 'the plan now returns a bare "offerable" — reconcile it with offerable_if_generation_exhausted rather than reading both';
  END IF;

  RAISE NOTICE 'plan contract verified: complete / shortfall / offerable_if_generation_exhausted all present.';
END
$prove$;

COMMIT;
