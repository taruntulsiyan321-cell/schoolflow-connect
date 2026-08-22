-- Found via a fresh user-journey-trace cross-check, 2026-08-22 (continuing
-- the Phase 5 audit).
--
-- battle_participants' only INSERT policy ("bp self insert") has a
-- WITH CHECK of just `user_id = auth.uid()` -- it never validates that
-- `battle_id` actually belongs to the same school as the `school_id` the
-- client puts in the same insert, and joinById() (battleExperienceService.ts)
-- does a plain client-side `.insert()`, not a SECURITY DEFINER RPC, so RLS
-- is the *only* enforcement here. A client fully controls both `battle_id`
-- and `school_id` in that payload -- nothing stops a caller from joining a
-- battle row belonging to a different school, or setting `school_id` to a
-- value that doesn't match the battle at all, which would then feed
-- whatever downstream logic keys off battle_participants.school_id (battle
-- reports, leaderboards, mastery capture via rpc_mirror_battle_answer).
--
-- Fixed by requiring the battle to exist, belong to the same school as the
-- row being inserted, and requiring that school to be the caller's own
-- (get_my_school_id()) -- closing both "joined a foreign battle" and
-- "lied about my own school_id" in the same check.
DROP POLICY IF EXISTS "bp self insert" ON public.battle_participants;
CREATE POLICY "bp self insert" ON public.battle_participants
  FOR INSERT
  WITH CHECK (
    user_id = auth.uid()
    AND school_id = public.get_my_school_id()
    AND EXISTS (
      SELECT 1 FROM public.battles b
      WHERE b.id = battle_participants.battle_id AND b.school_id = battle_participants.school_id
    )
  );
