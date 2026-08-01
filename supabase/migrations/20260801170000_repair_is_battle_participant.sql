-- =========================================================
-- REPAIR: is_battle_participant DROP dependency (2BP01)
--
-- Safe to run whether 20260801160000:
--   * failed on DROP FUNCTION (policies still on 2-arg overload), OR
--   * partially applied, OR
--   * never ran
--
-- Drops dependent policies first, removes both overloads,
-- recreates 1-arg auth.uid()-only helper + policies + grants.
-- =========================================================

DROP POLICY IF EXISTS "battles read participant" ON public.battles;
DROP POLICY IF EXISTS "bp read as participant" ON public.battle_participants;
DROP POLICY IF EXISTS "bq read participant" ON public.battle_questions;

DROP FUNCTION IF EXISTS public.is_battle_participant(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_battle_participant(uuid);

CREATE OR REPLACE FUNCTION public.is_battle_participant(_battle_id uuid)
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
      AND user_id = auth.uid()
  );
$$;

REVOKE ALL ON FUNCTION public.is_battle_participant(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_battle_participant(uuid) TO authenticated;

CREATE POLICY "battles read participant" ON public.battles
FOR SELECT TO authenticated
USING (public.is_battle_participant(id));

CREATE POLICY "bp read as participant" ON public.battle_participants
FOR SELECT TO authenticated
USING (public.is_battle_participant(battle_id));

CREATE POLICY "bq read participant" ON public.battle_questions
FOR SELECT TO authenticated
USING (public.is_battle_participant(battle_id));
