-- Rollback for 20261046000000_an_exam_is_an_account.sql
--
-- REFUSES if any individual has signed up. Dropping exam_accounts would leave
-- their space as an unexplained school row and their practice, mistakes and
-- revision inside a tenant nothing names; that is a data decision, not a
-- schema one, and it belongs to whoever is rolling back, not to this file.

BEGIN;

DO $guard$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.schools WHERE kind = 'individual';
  IF _n > 0 THEN
    RAISE EXCEPTION
      'REFUSED: % individual account(s) exist. Decide what happens to their data first, then delete those spaces, then run this rollback.', _n;
  END IF;
END
$guard$;

-- Restore the pre-migration body BEFORE schools.kind goes, or the function
-- would reference a column that no longer exists.
CREATE OR REPLACE FUNCTION public.default_school_id()
 RETURNS uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.get_my_school_id(),
    (SELECT s.id FROM public.schools s
      WHERE (SELECT count(*) FROM public.schools) = 1)
  )
$function$;

DROP FUNCTION IF EXISTS public.rpc_set_my_display_name(text);
DROP FUNCTION IF EXISTS public.rpc_create_exam_account(uuid, text, text, text);

DROP TRIGGER IF EXISTS exam_account_is_fixed ON public.exam_accounts;
DROP FUNCTION IF EXISTS public.tg_exam_account_is_fixed();

DROP TABLE IF EXISTS public.exam_accounts;
DROP TABLE IF EXISTS public.competitive_exams;

ALTER TABLE public.schools DROP CONSTRAINT IF EXISTS schools_kind_known;
ALTER TABLE public.schools DROP COLUMN IF EXISTS kind;

COMMIT;
