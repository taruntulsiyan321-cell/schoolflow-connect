-- Rollback for 20261045000000_a_count_says_what_the_student_did.
--
-- Puts rpc_student_recovery_queue, rpc_student_academic_snapshot and
-- rpc_student_practice_analytics back exactly as they were, from the copies
-- the migration kept in routines_pre_20261045000000. With them back, Recovery
-- counts prepared-but-unsat sessions as rounds again, Home counts relearn
-- chapters as ready to recover, and same-named topics in different chapters
-- merge into one Analysis row. Roll back only to undo those rulings.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.routines_pre_20261045000000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: routines_pre_20261045000000 is gone, so the definitions cannot be put back exactly.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261045000000
              WHERE applied IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ABORT: one of the three functions changed since 20261045000000 was applied. Roll back what changed it first.';
  END IF;
END
$pre$;

DO $restore$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT definition FROM public.routines_pre_20261045000000 LOOP
    EXECUTE _r.definition;
  END LOOP;
END
$restore$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261045000000
              WHERE definition IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ROLLED BACK: a function did not come back exactly as it was';
  END IF;
  RAISE NOTICE 'rollback OK: the three functions are as they were before 20261045000000';
END
$verify$;

DROP TABLE public.routines_pre_20261045000000;
DELETE FROM public.schema_migrations WHERE version = '20261045000000_a_count_says_what_the_student_did';

COMMIT;
