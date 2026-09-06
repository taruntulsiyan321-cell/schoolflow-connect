-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — question_bank writes go back to staff-only, unowned
--
-- This RESTORES THE HOLE deliberately: after this runs, any teacher, principal
-- or admin at any school can again UPDATE or DELETE any of the 21,696
-- reference questions and any other teacher's contribution. The predicates
-- below are the ones measured live on 2026-09-06, reproduced exactly.
--
-- Rows contributed while the fence was in place keep their `created_by`; the
-- column is not cleared, so re-applying the forward migration re-fences them
-- to the same authors.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS qb_staff_insert ON public.question_bank;
CREATE POLICY qb_staff_insert ON public.question_bank
  FOR INSERT TO authenticated
  WITH CHECK (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
  );

DROP POLICY IF EXISTS qb_staff_update ON public.question_bank;
CREATE POLICY qb_staff_update ON public.question_bank
  FOR UPDATE TO authenticated
  USING (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
  )
  WITH CHECK (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
  );

DROP POLICY IF EXISTS qb_staff_delete ON public.question_bank;
CREATE POLICY qb_staff_delete ON public.question_bank
  FOR DELETE TO authenticated
  USING (
    (SELECT public.is_principal_or_admin(auth.uid()))
    OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
  );

COMMENT ON COLUMN public.question_bank.created_by IS NULL;

COMMIT;
