-- ===========================================================================
-- ROLLBACK: the six recovery and revision functions as they were
--
-- Restores, from the definitions 20261117000000 saved before changing them:
-- _recovery_variant_pool and _recovery_step_pool (no approval filter; tier 3
-- not served by the step pool), _recovery_session_plan_for (tier 3 = the
-- chapter's oldest questions; relearn read from RECOVERY_WIDE_MAX_MISTAKES),
-- _recovery_queue_for (the same relearn read), _apply_chapter_state (practice
-- resets the revision clock to the first interval) and
-- rpc_revision_session_plan (misses without an approval filter).
--
-- Undoes: 20261117000000_every_recovery_step_is_one_the_student_can_be_shown.sql
-- ===========================================================================

BEGIN;

DO $restore$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN SELECT object, definition FROM public.routines_pre_20261117000000 LOOP
    EXECUTE _r.definition;
    IF md5(pg_get_functiondef(_r.object::regprocedure)) <> md5(_r.definition) THEN
      RAISE EXCEPTION '% did not come back as it was saved', _r.object;
    END IF;
    _n := _n + 1;
  END LOOP;
  IF _n <> 6 THEN
    RAISE EXCEPTION 'expected 6 saved definitions to restore, found %', _n;
  END IF;
END
$restore$;

DROP TABLE public.routines_pre_20261117000000;

COMMIT;
