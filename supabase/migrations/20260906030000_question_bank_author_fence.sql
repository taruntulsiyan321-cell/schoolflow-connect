-- ═══════════════════════════════════════════════════════════════════════════
-- question_bank: writes are fenced to the contributing author
--
-- THE HOLE. `qb_staff_insert`, `qb_staff_update` and `qb_staff_delete` each
-- carried one predicate — "is the caller staff" — and no ownership test and no
-- school test. Measured 2026-09-06: any teacher, principal or admin at ANY
-- school could UPDATE or DELETE any of the 21,696 reference questions, and
-- could edit any other teacher's contribution.
--
-- WHY IT IS STILL LATENT, AND WHY THAT IS NOT A REASON TO WAIT. `created_by`
-- is NULL on all 21,696 rows and there are zero contributions, so nothing has
-- been lost yet. But the write-back is ALREADY SHIPPED and teacher-reachable:
-- `QuestionBankPage.saveDrafts` and its CSV import both call
-- `QuestionBankService.insert` from a teacher-only screen. The hole is one
-- working save away, not one feature away.
--
-- WHAT DOES NOT CHANGE — §10.9 (docs/locked-decisions.md:385):
--   "Centralised and shared across all schools and all users."
-- So reading stays shared. Neither SELECT policy is touched, no school
-- predicate is added to any write, and no `school_id` column is introduced —
-- the schema cannot express per-school ownership and the spec does not ask it
-- to. The fence is OWNERSHIP, not tenancy.
--
-- THE ROLE GATE IS UNCHANGED. Staff means teacher OR principal OR admin here,
-- exactly as before. §10.9 states no rule about who writes, and rule 18 says
-- not to narrow a role beyond the spec on my own judgement.
--
-- `created_by = auth.uid()` refuses a NULL `created_by`, because NULL = uuid is
-- NULL and a policy admits only TRUE. That is what makes the reference seed
-- unmodifiable by everyone, including its own author, which has none.
--
-- No DEFAULT auth.uid() is added to `created_by`. A caller that omits it is
-- refused loudly rather than silently attributed; the only live writer
-- (`QuestionBankService.insert`) already sets `created_by: r.created_by ?? ctx.userId`.
--
-- Verified by probe15, not by a DO block (rule 6). Every denial there is paired
-- with a positive control (rule 8).
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── INSERT: staff may contribute, but only as themselves ──────────────────
DROP POLICY IF EXISTS qb_staff_insert ON public.question_bank;
CREATE POLICY qb_staff_insert ON public.question_bank
  FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND (
      (SELECT public.is_principal_or_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
    )
  );

-- ── UPDATE: only your own contribution, and it stays yours ────────────────
-- WITH CHECK repeats the ownership test so an author cannot reassign a row to
-- somebody else on the way out.
DROP POLICY IF EXISTS qb_staff_update ON public.question_bank;
CREATE POLICY qb_staff_update ON public.question_bank
  FOR UPDATE TO authenticated
  USING (
    created_by = auth.uid()
    AND (
      (SELECT public.is_principal_or_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
    )
  )
  WITH CHECK (
    created_by = auth.uid()
    AND (
      (SELECT public.is_principal_or_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
    )
  );

-- ── DELETE: only your own contribution ────────────────────────────────────
DROP POLICY IF EXISTS qb_staff_delete ON public.question_bank;
CREATE POLICY qb_staff_delete ON public.question_bank
  FOR DELETE TO authenticated
  USING (
    created_by = auth.uid()
    AND (
      (SELECT public.is_principal_or_admin(auth.uid()))
      OR (SELECT public.has_role(auth.uid(), 'teacher'::public.app_role))
    )
  );

COMMENT ON COLUMN public.question_bank.created_by IS
  'The contributing author. NULL marks the reference seed, which no policy can '
  'UPDATE or DELETE because created_by = auth.uid() is never true for NULL. '
  'Writes are fenced on this column alone -- the bank itself is shared across '
  'all schools by §10.9, so ownership rather than tenancy is the write rule.';

COMMIT;
