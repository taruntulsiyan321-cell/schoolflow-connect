-- ════════════════════════════════════════════════════════════════════════════
-- THE STUDENT MAY ACTUALLY CALL IT
-- ════════════════════════════════════════════════════════════════════════════
--
-- TWO DEFECTS I SHIPPED IN THIS SAME PIECE OF WORK, AND WHY MY OWN PROOF
-- MISSED THEM
--
-- 1. rpc_revision_session_plan (20261008000000) was never granted to
--    `authenticated`. Every student calling it — which is now the only way to
--    start a revision check — gets `permission denied for function`.
--
-- 2. 20261009000000 split the ladder into _recovery_session_plan_for and
--    _recovery_chapter_is_for, leaving rpc_recovery_session_plan and
--    _recovery_chapter_is_mine as one-line SECURITY INVOKER delegations. An
--    invoker function runs as the CALLER, so EXECUTE on the inner function is
--    checked against the student, who had none. Both public entry points were
--    broken for every student the moment that migration applied.
--
-- The verification suites for both changes passed. They set
-- request.jwt.claims so auth.uid() answered correctly, but they ran as the
-- database OWNER, who has EXECUTE on everything. Setting the claim is not
-- becoming the user. A check that cannot fail is not a check, and these two
-- could not fail on a permission defect however wrong the grants were.
--
-- So the assertions at the bottom of this file SET LOCAL ROLE authenticated
-- and call both entry points for real. Wrong grants now stop the migration.
--
-- WHY THE HELPERS ARE SAFE TO EXPOSE
--
-- Both are SECURITY INVOKER, so RLS applies to the caller. Passing another
-- student's uid does not read their data:
--   * _recovery_chapter_is_for joins students, whose RESTRICTIVE fence hides
--     other people's rows, so the EXISTS is false and the caller is refused.
--   * _recovery_session_plan_for reads student_mistakes under its own
--     user_id = auth.uid() policy, so another uid yields an empty ladder.
-- This mirrors _recovery_chapter_is_mine and _recovery_variant_pool, which
-- have carried EXECUTE for authenticated since 20260829310000 for the same
-- reason.
--
-- _ensure_recovery_session and _apply_chapter_state are deliberately NOT
-- granted. They are SECURITY DEFINER background steps of the finish path, and
-- a student who could call them directly could prepare sessions at will.
--
-- ROLLBACK: supabase/migrations/rollback/20261011000000_down.sql
-- ════════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.rpc_revision_session_plan(uuid)          TO authenticated;
GRANT EXECUTE ON FUNCTION public._recovery_chapter_is_for(uuid, uuid)     TO authenticated;
GRANT EXECUTE ON FUNCTION public._recovery_session_plan_for(uuid, uuid)   TO authenticated;

-- Stated as a revoke rather than left to the default, so the intent is on the
-- record: these two are background steps, not student-callable.
REVOKE ALL ON FUNCTION public._ensure_recovery_session(uuid, uuid, uuid, uuid) FROM authenticated, anon;
REVOKE ALL ON FUNCTION public._apply_chapter_state(uuid)                       FROM authenticated, anon;

-- ── The assertion that would have caught this ──────────────────────────────
--
-- Runs as `authenticated`, with a real student's claim, and calls both public
-- entry points. Inside its own sub-block so the role is reset however it ends.

DO $prove$
DECLARE
  _uid     uuid;
  _chapter uuid;
  _plan    jsonb;
  _ok      boolean := false;
BEGIN
  SELECT sm.user_id, sm.chapter_id INTO _uid, _chapter
    FROM public.student_mistakes sm
   WHERE sm.status = 'open' AND sm.question_id IS NOT NULL AND sm.chapter_id IS NOT NULL
   LIMIT 1;

  IF _uid IS NULL THEN
    -- Not a pass. If there is nothing to call it with, this migration cannot
    -- demonstrate the grants work and must say so rather than commit quietly.
    RAISE EXCEPTION 'NO FIXTURE: no open mistake with a question id, so the grants below are unproven';
  END IF;

  PERFORM set_config('request.jwt.claims', json_build_object('sub', _uid::text)::text, true);

  BEGIN
    SET LOCAL ROLE authenticated;

    -- 1. The revision entry point.
    _plan := public.rpc_revision_session_plan(_chapter);
    IF _plan IS NULL THEN
      RAISE EXCEPTION 'rpc_revision_session_plan returned NULL as authenticated';
    END IF;

    -- 2. The recovery entry point, which reaches both split helpers.
    _plan := public.rpc_recovery_session_plan(_chapter);
    IF _plan IS NULL OR _plan->>'mode' IS NULL THEN
      RAISE EXCEPTION 'rpc_recovery_session_plan returned no mode as authenticated';
    END IF;

    -- 3. And the background step must STAY shut.
    BEGIN
      PERFORM public._apply_chapter_state('00000000-0000-0000-0000-000000000000'::uuid);
      RAISE EXCEPTION 'A STUDENT CAN CALL _apply_chapter_state — the revoke above did not take';
    EXCEPTION
      WHEN insufficient_privilege THEN
        _ok := true;
    END;

    RESET ROLE;
  EXCEPTION
    WHEN OTHERS THEN
      RESET ROLE;
      RAISE;
  END;

  IF NOT _ok THEN
    RAISE EXCEPTION 'the negative half did not run — _apply_chapter_state was reachable or failed for another reason';
  END IF;

  RAISE NOTICE 'grants proven as role authenticated: both plans answer, the background step is refused';
END $prove$;

COMMIT;
