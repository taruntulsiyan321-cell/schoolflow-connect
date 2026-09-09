-- Rollback for 20260916080000_the_principal_does_not_write_to_the_shared_question_bank
--
-- THIS RESTORES A MEASURED §10 VIOLATION. With `is_principal_or_admin` back in
-- the three write policies, a principal can insert into `question_bank` — a
-- table with no `school_id`, shared across every school by §10.9. Measured as
-- the caller before 20260916080000: "PRINCIPAL writes to the bank -> inserted".
--
-- The anon write grants are NOT restored. They were unused — RLS refused anon
-- either way, since `created_by = auth.uid()` cannot hold with a NULL uid — and
-- re-granting INSERT/UPDATE/DELETE on the shared question bank to the
-- browser-bundle key in the name of "restoring prior state" would be a
-- deliberate step backwards for no caller.

DROP POLICY IF EXISTS qb_staff_insert ON public.question_bank;
CREATE POLICY qb_staff_insert ON public.question_bank
  FOR INSERT
  WITH CHECK (
    created_by = auth.uid()
    AND ((SELECT public.is_principal_or_admin(auth.uid()))
         OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)))
  );

DROP POLICY IF EXISTS qb_staff_update ON public.question_bank;
CREATE POLICY qb_staff_update ON public.question_bank
  FOR UPDATE
  USING (
    created_by = auth.uid()
    AND ((SELECT public.is_principal_or_admin(auth.uid()))
         OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)))
  )
  WITH CHECK (
    created_by = auth.uid()
    AND ((SELECT public.is_principal_or_admin(auth.uid()))
         OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)))
  );

DROP POLICY IF EXISTS qb_staff_delete ON public.question_bank;
CREATE POLICY qb_staff_delete ON public.question_bank
  FOR DELETE
  USING (
    created_by = auth.uid()
    AND ((SELECT public.is_principal_or_admin(auth.uid()))
         OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role)))
  );

DROP FUNCTION IF EXISTS public.can_author_bank_question();

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='question_bank'
       AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%can_author_bank_question%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: a policy still references the dropped helper';
  END IF;

  -- The approval trigger must survive: without it, restoring the wider write
  -- rule would also make every unapproved contribution approvable by its author.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_question_bank_approval_is_super_admin_only'
       AND tgrelid = 'public.question_bank'::regclass
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the approval trigger went with it';
  END IF;

  RAISE NOTICE 'question bank write policies restored to the principal-inclusive form.';
END $verify$;
