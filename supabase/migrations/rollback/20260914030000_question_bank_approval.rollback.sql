-- ROLLBACK 20260914030000_question_bank_approval — written 2026-09-22; the migration shipped without one.
--
-- Removes what it added, all of it new in that migration (no earlier migration defines any of these names):
-- rpc_review_question, rpc_question_bank_review_queue, the approval trigger and its function, the qb_super_admin_read
-- policy, the pending-review index, and the three provenance columns approved_by, approved_at, review_note.
--
-- THIS REOPENS WHAT IT CLOSED: an author can approve their own contributed question again, and the super admin's
-- review screen (/admin/question-bank-review) stops working — its two RPCs are gone. Roll back the migrations that
-- depend on the bank's shape first, newest first.
--
-- REFUSES rather than destroy a record: if any question already carries a review (approved_by, approved_at or
-- review_note set), dropping those columns would erase who approved or rejected it and why. Such a database is not
-- rolled back by this file.
DO $precheck$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.question_bank
   WHERE approved_by IS NOT NULL OR approved_at IS NOT NULL OR review_note IS NOT NULL;
  IF _n > 0 THEN
    RAISE EXCEPTION 'rollback refused: % question(s) carry a review record that dropping the columns would erase', _n;
  END IF;
END
$precheck$;

DROP FUNCTION IF EXISTS public.rpc_review_question(uuid, boolean, text);
DROP FUNCTION IF EXISTS public.rpc_question_bank_review_queue(integer, integer);
DROP TRIGGER IF EXISTS trg_question_bank_approval_is_super_admin_only ON public.question_bank;
DROP FUNCTION IF EXISTS public.tg_question_bank_approval_is_super_admin_only();
DROP POLICY IF EXISTS qb_super_admin_read ON public.question_bank;
DROP INDEX IF EXISTS public.question_bank_pending_review_idx;
ALTER TABLE public.question_bank
  DROP COLUMN IF EXISTS approved_by,
  DROP COLUMN IF EXISTS approved_at,
  DROP COLUMN IF EXISTS review_note;

DO $check$
BEGIN
  IF to_regprocedure('public.rpc_review_question(uuid,boolean,text)') IS NOT NULL
     OR to_regprocedure('public.tg_question_bank_approval_is_super_admin_only()') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
                 WHERE c.relname = 'question_bank' AND p.polname = 'qb_super_admin_read')
     OR EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_schema = 'public' AND table_name = 'question_bank' AND column_name = 'approved_by') THEN
    RAISE EXCEPTION 'rollback: part of the approval workflow is still there';
  END IF;
END
$check$;

DELETE FROM public.schema_migrations WHERE version = '20260914030000_question_bank_approval';
