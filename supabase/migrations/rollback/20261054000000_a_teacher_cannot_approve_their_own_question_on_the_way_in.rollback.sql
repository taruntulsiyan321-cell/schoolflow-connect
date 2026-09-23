-- ROLLBACK 20261054000000 — lets a teacher approve their own question again
-- by setting is_approved on the INSERT that creates it.
--
-- THIS RESTORES THE DEFECT: any teacher or admin could then publish straight
-- into the central bank, which is global, and reach every school on that
-- board and class without passing the super admin's review queue.
--
-- It puts back the exact function and trigger that stood before: the body
-- from 20260914030000 (UPDATE only), and the trigger declared
-- `BEFORE UPDATE OF is_approved`.

CREATE OR REPLACE FUNCTION public.tg_question_bank_approval_is_super_admin_only()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.is_approved IS DISTINCT FROM OLD.is_approved
     AND NOT (SELECT public.is_super_admin()) THEN
    RAISE EXCEPTION
      'only a super admin may approve or unapprove a question (§10.20: manage the central question bank)'
      USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_question_bank_approval_is_super_admin_only ON public.question_bank;
CREATE TRIGGER trg_question_bank_approval_is_super_admin_only
  BEFORE UPDATE OF is_approved ON public.question_bank
  FOR EACH ROW EXECUTE FUNCTION public.tg_question_bank_approval_is_super_admin_only();

-- Fail closed: the trigger must be back to UPDATE-only, or this rollback did
-- not do what it says.
DO $check$
DECLARE _def text;
BEGIN
  SELECT pg_get_triggerdef(t.oid) INTO _def
    FROM pg_trigger t
   WHERE t.tgrelid = 'public.question_bank'::regclass
     AND t.tgname = 'trg_question_bank_approval_is_super_admin_only';
  IF _def IS NULL OR _def ILIKE '%INSERT%' THEN
    RAISE EXCEPTION 'the trigger was not restored to UPDATE-only: %', COALESCE(_def, '(missing)');
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261054000000_a_teacher_cannot_approve_their_own_question_on_the_way_in';
