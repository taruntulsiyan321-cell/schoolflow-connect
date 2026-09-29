-- ===========================================================================
-- ROLLBACK: brought questions planned and scored on existing alone
--
-- Restores, from the definitions 20261120000000 saved before changing them,
-- _recovery_session_plan_for and rpc_submit_recovery_session, and drops
-- _brought_question_askable.
--
-- Undoes: 20261120000000_a_brought_question_is_asked_only_if_it_can_be_answered.sql
-- ===========================================================================

BEGIN;

DO $restore$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN SELECT object, definition FROM public.routines_pre_20261120000000 LOOP
    EXECUTE _r.definition;
    IF md5(pg_get_functiondef(_r.object::regprocedure)) <> md5(_r.definition) THEN
      RAISE EXCEPTION '% did not come back as it was saved', _r.object;
    END IF;
    _n := _n + 1;
  END LOOP;
  IF _n <> 2 THEN
    RAISE EXCEPTION 'expected 2 saved definitions to restore, found %', _n;
  END IF;
END
$restore$;

DROP FUNCTION public._brought_question_askable(jsonb, integer);
DROP TABLE public.routines_pre_20261120000000;

COMMIT;
