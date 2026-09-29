-- ===========================================================================
-- ROLLBACK: recovery rounds as they were
--
-- Restores, from the definitions 20261118000000 saved before changing them:
-- _recovery_session_plan_for (no round; every round the same questions),
-- _enqueue_variant_generation (stops at one variant per tier),
-- dispatch_variant_generation (a job is done when any variant exists),
-- rpc_submit_recovery_session (a round that is not ready prepares nothing)
-- and rpc_start_recovery_session (its own copy of the builder).
--
-- Jobs it queued stay in variant_generation_queue; the restored dispatcher
-- closes each as done at its next run, because a variant of its question
-- already exists.
--
-- Undoes: 20261118000000_a_failed_recovery_round_gets_new_questions.sql
-- ===========================================================================

BEGIN;

DO $restore$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN SELECT object, definition FROM public.routines_pre_20261118000000 LOOP
    EXECUTE _r.definition;
    IF md5(pg_get_functiondef(_r.object::regprocedure)) <> md5(_r.definition) THEN
      RAISE EXCEPTION '% did not come back as it was saved', _r.object;
    END IF;
    _n := _n + 1;
  END LOOP;
  IF _n <> 5 THEN
    RAISE EXCEPTION 'expected 5 saved definitions to restore, found %', _n;
  END IF;
END
$restore$;

DROP TABLE public.routines_pre_20261118000000;

COMMIT;
