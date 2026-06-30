-- Allow invited students to open and complete private 1v1 duel battles.

DROP POLICY IF EXISTS "battles read invited duel" ON public.battles;
CREATE POLICY "battles read invited duel"
ON public.battles
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.battle_invites bi
    WHERE bi.battle_id = battles.id
      AND bi.invited_user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "bp read private duel participants" ON public.battle_participants;
CREATE POLICY "bp read private duel participants"
ON public.battle_participants
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.battles b
    WHERE b.id = battle_participants.battle_id
      AND (
        b.creator_user_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.battle_invites bi
          WHERE bi.battle_id = b.id
            AND bi.invited_user_id = auth.uid()
        )
      )
  )
);
