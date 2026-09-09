-- ═══════════════════════════════════════════════════════════════════════════
-- The principal does not write to the shared question bank (§10, §10.9)
--
-- Found while building §5's write-back, by asking the write path who could use
-- it. Measured as the caller, 2026-09-09:
--
--   TEACHER writes back an MCQ (is_approved=false) ... inserted
--   STUDENT writes to the bank ...................... refused
--   PRINCIPAL writes to the bank .................... INSERTED   <- §10
--
-- `qb_staff_insert`, `qb_staff_update` and `qb_staff_delete` all read
--
--     created_by = auth.uid()
--     AND (is_principal_or_admin(auth.uid()) OR has_role(auth.uid(), 'teacher'))
--
-- and `is_principal_or_admin` is admin OR principal. §10 gives the principal
-- announcements and nothing else, and this is the fourth surface this session
-- where that helper was used as a shorthand for "staff" — after
-- `question_papers`, `question_paper_sections` and `question_paper_questions`.
--
-- IT IS WORSE HERE THAN IT WAS THERE. `question_bank` has no `school_id`:
-- §10.9 makes it "centralised and shared across all schools and all users".
-- A question paper written by a principal is one school's mistake. A question
-- inserted into the bank is content aimed at every school in the system, once
-- approved.
--
-- ── WHAT DOES NOT CHANGE ────────────────────────────────────────────────
--
-- READ. `qb_staff_read` is untouched: the principal keeps seeing the bank, the
-- same split this session applied to question papers — may look, may not touch.
--
-- APPROVAL. Already super-admin only, enforced by
-- `trg_question_bank_approval_is_super_admin_only`, and untouched. That trigger
-- is what makes a teacher's unapproved contribution safe, and it is why the
-- write-back in §5 can exist at all.
--
-- ── ANON ────────────────────────────────────────────────────────────────
--
-- anon holds SELECT, INSERT, UPDATE, DELETE and TRUNCATE on `question_bank`.
-- RLS refuses it — `auth.uid()` is NULL, so `created_by = auth.uid()` cannot
-- hold — but Chunk 9.5's rule is that anon holds nothing it does not need, and
-- the browser-bundle key does not need to write to the shared question bank.
-- SELECT is left alone: `qb_select_approved_board` is the fence there and
-- removing the grant is a bigger change than this migration is about.
--
-- Rollback: supabase/migrations/rollback/
--           20260916080000_the_principal_does_not_write_to_the_shared_question_bank.rollback.sql
-- Assertion: verification/caller-privileges/probe40.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- One helper, so the three policies cannot drift apart the way they would if
-- each carried its own copy of the role list.
CREATE OR REPLACE FUNCTION public.can_author_bank_question()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT (SELECT public.has_role((SELECT auth.uid()), 'teacher'::public.app_role))
      OR (SELECT public.has_role((SELECT auth.uid()), 'admin'::public.app_role))
$function$;

COMMENT ON FUNCTION public.can_author_bank_question() IS
  'Teacher or admin, acting in that role now. The principal is deliberately '
  'absent (§10: announcements only) — before 20260916080000 the three qb_staff '
  'write policies used is_principal_or_admin and a principal could insert into '
  'the cross-school question bank. Reading is unaffected.';

REVOKE ALL ON FUNCTION public.can_author_bank_question() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.can_author_bank_question() TO authenticated;

DROP POLICY IF EXISTS qb_staff_insert ON public.question_bank;
CREATE POLICY qb_staff_insert ON public.question_bank
  FOR INSERT
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.can_author_bank_question());

DROP POLICY IF EXISTS qb_staff_update ON public.question_bank;
CREATE POLICY qb_staff_update ON public.question_bank
  FOR UPDATE
  USING (created_by = (SELECT auth.uid()) AND public.can_author_bank_question())
  WITH CHECK (created_by = (SELECT auth.uid()) AND public.can_author_bank_question());

DROP POLICY IF EXISTS qb_staff_delete ON public.question_bank;
CREATE POLICY qb_staff_delete ON public.question_bank
  FOR DELETE
  USING (created_by = (SELECT auth.uid()) AND public.can_author_bank_question());

REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON public.question_bank FROM anon;

-- ── Proof, before this commits ───────────────────────────────────────────
DO $verify$
DECLARE _n int;
BEGIN
  -- No WRITE policy may still reach the principal.
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname='public' AND tablename='question_bank'
     AND policyname IN ('qb_staff_insert','qb_staff_update','qb_staff_delete')
     AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%is_principal_or_admin%';
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: % write policy/policies still admit the principal', _n;
  END IF;

  -- ...and all three must ask the new question.
  SELECT count(*) INTO _n
    FROM pg_policies
   WHERE schemaname='public' AND tablename='question_bank'
     AND policyname IN ('qb_staff_insert','qb_staff_update','qb_staff_delete')
     AND (coalesce(qual,'') || coalesce(with_check,'')) LIKE '%can_author_bank_question%';
  IF _n <> 3 THEN
    RAISE EXCEPTION 'ROLLED BACK: only % of 3 write policies use the shared predicate', _n;
  END IF;

  -- READING must be untouched. Narrowing the write rule must not take the
  -- principal's or the student's read with it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='question_bank'
       AND policyname = 'qb_staff_read'
       AND coalesce(qual,'') LIKE '%is_principal_or_admin%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: qb_staff_read changed — the principal must keep seeing the bank';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='question_bank'
       AND policyname = 'qb_select_approved_board'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the student read policy went missing';
  END IF;

  -- Approval stays super-admin only. §5's write-back is only safe because of it.
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
     WHERE tgname = 'trg_question_bank_approval_is_super_admin_only'
       AND tgrelid = 'public.question_bank'::regclass
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: the approval trigger is gone — an unapproved write-back would no longer be safe';
  END IF;

  SELECT count(*) INTO _n
    FROM information_schema.role_table_grants
   WHERE table_schema='public' AND table_name='question_bank' AND grantee='anon'
     AND privilege_type IN ('INSERT','UPDATE','DELETE','TRUNCATE');
  IF _n <> 0 THEN
    RAISE EXCEPTION 'ROLLED BACK: anon still holds % write grant(s) on the question bank', _n;
  END IF;

  RAISE NOTICE 'question bank writes: the author, acting as teacher or admin. Reading and approval unchanged.';
END $verify$;
