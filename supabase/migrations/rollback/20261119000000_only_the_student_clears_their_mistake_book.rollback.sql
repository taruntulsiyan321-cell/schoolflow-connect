-- ===========================================================================
-- ROLLBACK: recovery scoring clears the book again on a ready round
--
-- Restores, from the definitions 20261119000000 saved before changing them,
-- rpc_submit_recovery_session (a ready round clears the chapter's mistakes,
-- marks it recovered and starts revision) and rpc_clear_chapter_after_recovery
-- (the student's clear only after a not-ready round). Roll the app back with
-- it: the result screen and the Mistake Book's Clear expect this migration.
--
-- Undoes: 20261119000000_only_the_student_clears_their_mistake_book.sql
-- ===========================================================================

BEGIN;

DO $restore$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN SELECT object, definition FROM public.routines_pre_20261119000000 LOOP
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

COMMENT ON FUNCTION public.rpc_clear_chapter_after_recovery(uuid) IS NULL;
DROP TABLE public.routines_pre_20261119000000;

COMMIT;
