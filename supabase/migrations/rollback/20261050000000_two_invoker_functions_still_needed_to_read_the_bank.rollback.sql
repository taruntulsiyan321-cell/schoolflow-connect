-- ROLLBACK 20261050000000 — rpc_revision_session_plan and rpc_practice_bank_catalog run as the caller again.
--
-- THIS BREAKS BOTH while 20261049000000 is applied. With no policy letting a student read question_bank, an invoker
-- sees an empty bank: the revision plan answers 400 "there is nothing new left in this chapter" for chapters whose
-- own state row lists fresh questions, and the catalog returns zero rows, so the practice subject picker is empty
-- (both measured 2026-09-22, which is why the forward migration exists). Roll back 20261049000000 next — it restores
-- the policy these two relied on — or do not roll this one back at all.
--
-- The forward migration only added SECURITY DEFINER to each header; this takes exactly that away, and nothing else.
ALTER FUNCTION public.rpc_revision_session_plan(uuid) SECURITY INVOKER;
ALTER FUNCTION public.rpc_practice_bank_catalog(integer, text, text, text) SECURITY INVOKER;

DO $check$
DECLARE _still text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _still
    FROM pg_proc p
   WHERE p.pronamespace = 'public'::regnamespace
     AND p.proname IN ('rpc_revision_session_plan', 'rpc_practice_bank_catalog')
     AND p.prosecdef;
  IF _still IS NOT NULL THEN
    RAISE EXCEPTION 'rollback: % is still a definer', _still;
  END IF;
END
$check$;

DELETE FROM public.schema_migrations
 WHERE version = '20261050000000_two_invoker_functions_still_needed_to_read_the_bank';
