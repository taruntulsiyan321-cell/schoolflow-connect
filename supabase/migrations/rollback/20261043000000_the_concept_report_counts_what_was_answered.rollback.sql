-- Rollback for 20261043000000_the_concept_report_counts_what_was_answered.
--
-- Puts _build_concept_recovery_report back exactly as it was before it — the
-- practice branch counting every attempt (a skip as a wrong answer), timing a
-- session by the clock from opening to finishing, and reporting 0% where
-- nothing was answered — from the copy the migration kept in
-- routines_pre_20261043000000.
--
-- The client from that commit renders the report's accuracy and duration as
-- "—" when they are absent; with the old function back they are never absent,
-- so the screens work either way. Roll the client back with it only if the
-- old figures are what is wanted.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.routines_pre_20261043000000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: routines_pre_20261043000000 is gone, so the definition cannot be put back exactly. Restore it from a backup instead.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261043000000
              WHERE applied IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ABORT: _build_concept_recovery_report changed since 20261043000000 was applied. Roll back what changed it first.';
  END IF;
END
$pre$;

DO $restore$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT definition FROM public.routines_pre_20261043000000 LOOP
    EXECUTE _r.definition;
  END LOOP;
END
$restore$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261043000000
              WHERE definition IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ROLLED BACK: _build_concept_recovery_report did not come back exactly as it was defined';
  END IF;
  RAISE NOTICE 'rollback OK: the concept report is as it was before 20261043000000';
END
$verify$;

DROP TABLE public.routines_pre_20261043000000;
DELETE FROM public.schema_migrations WHERE version = '20261043000000_the_concept_report_counts_what_was_answered';

COMMIT;
