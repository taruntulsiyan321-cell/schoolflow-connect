-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — tests → test_attempts returns to ON DELETE CASCADE
--
-- ⚠ THIS RESTORES A SILENT DATA-LOSS PATH FOR STUDENT DATA.
--
-- After this, deleting a test destroys its attempt history again. The path is
-- not a hypothetical cleanup job — it is the teacher's "Delete" button
-- (TestService.remove → LiveClassPanels.tsx:1752), which hard-deletes.
--
-- Today the loss is masked: every test that has attempts also has marks, and
-- test_marks' RESTRICT refuses the delete first. So rolling this back appears
-- to change nothing. That masking is the whole hazard — it holds only while
-- marks happen to exist. The unprotected case is the ordinary one: a test that
-- students have attempted and whose marks are not uploaded yet. On that test,
-- with this rollback applied, Delete destroys the attempt record and reports
-- success.
--
-- An attempt with no mark is a student who opened the test and never submitted,
-- or was force-closed mid-attempt and recorded as "Not given". It is the
-- evidence a disputed result would be settled from.
--
-- test_questions is NOT touched here. It is CASCADE both before and after, by
-- ruling: questions are the test's own body, not student data.
--
-- WHAT GOES RED AFTER RUNNING THIS, and should be allowed to:
--   · probe7 "220000 delete test WITH attempts (no marks)" — expects a refusal
--     and will observe a successful delete
--   · probe7 "220000 attempt survives the refusal"
-- Run `npm run verify:caller-privileges` afterwards so the regression is
-- recorded rather than discovered.
--
-- The likely reason to reach for this — "a test cannot be deleted any more" —
-- is the constraint working, not failing. Fix it in the application layer
-- instead: TestService.remove already anticipates the refusal and explains it
-- in words a teacher can act on.
--
-- No data is changed either way; this is one constraint.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.test_attempts DROP CONSTRAINT IF EXISTS test_attempts_test_id_fkey;

ALTER TABLE public.test_attempts
  ADD CONSTRAINT test_attempts_test_id_fkey
  FOREIGN KEY (test_id)
  REFERENCES public.tests (id)
  ON DELETE CASCADE;

-- Assert the INVERSE of the forward check, so a half-applied reversal fails
-- loudly rather than leaving the constraint in an unnamed state.
DO $$
DECLARE _att text; _qs text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _att FROM pg_constraint
   WHERE conname = 'test_attempts_test_id_fkey' AND conrelid = 'public.test_attempts'::regclass;

  IF _att IS NULL OR _att NOT LIKE '%ON DELETE CASCADE%' THEN
    RAISE EXCEPTION 'rollback incomplete: test_attempts_test_id_fkey is not CASCADE — it reads: %',
      coalesce(_att, '(missing)');
  END IF;

  -- The rollback must not have disturbed the half that was never in scope.
  SELECT pg_get_constraintdef(oid) INTO _qs FROM pg_constraint
   WHERE conname = 'test_questions_test_id_fkey' AND conrelid = 'public.test_questions'::regclass;
  IF _qs IS NULL OR _qs NOT LIKE '%ON DELETE CASCADE%' THEN
    RAISE EXCEPTION 'rollback touched test_questions, which was out of scope — it reads: %',
      coalesce(_qs, '(missing)');
  END IF;
END $$;

DELETE FROM public.schema_migrations
 WHERE version = '20260904220000_test_attempts_restrict';

COMMIT;
