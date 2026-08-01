-- =========================================================
-- P0: fix infinite recursion in battle_participants RLS
--
-- Root cause (from 20260801120000_battle_codes_and_featured.sql):
--   * "battles read participant" SELECTs battle_participants
--   * "bp read as participant" SELECTs battle_participants (self)
--   * "bp read class" / "bp read private duel participants" SELECT battles
--     which re-enters "battles read participant" → infinite recursion
--
-- Fix: SECURITY DEFINER membership helper bypasses RLS when checking
-- whether the caller is a participant; recreate the three policies
-- that introduced the cycle.
-- =========================================================

CREATE OR REPLACE FUNCTION public.is_battle_participant(
  _battle_id uuid,
  _uid uuid DEFAULT auth.uid()
)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.battle_participants
    WHERE battle_id = _battle_id
      AND user_id = _uid
  );
$$;

REVOKE ALL ON FUNCTION public.is_battle_participant(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_battle_participant(uuid, uuid) TO authenticated;

-- battles: participant can read (incl. cross-class via code/featured)
DROP POLICY IF EXISTS "battles read participant" ON public.battles;
CREATE POLICY "battles read participant" ON public.battles
FOR SELECT TO authenticated
USING (public.is_battle_participant(id));

-- participants: co-participants can read each other's rows
DROP POLICY IF EXISTS "bp read as participant" ON public.battle_participants;
CREATE POLICY "bp read as participant" ON public.battle_participants
FOR SELECT TO authenticated
USING (public.is_battle_participant(battle_id));

-- questions: same membership gate
DROP POLICY IF EXISTS "bq read participant" ON public.battle_questions;
CREATE POLICY "bq read participant" ON public.battle_questions
FOR SELECT TO authenticated
USING (public.is_battle_participant(battle_id));
