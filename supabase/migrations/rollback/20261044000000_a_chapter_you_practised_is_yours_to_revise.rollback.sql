-- Rollback for 20261044000000_a_chapter_you_practised_is_yours_to_revise.
--
-- Puts _recovery_chapter_is_for back to the section-only guard, from the copy
-- the migration kept in routines_pre_20261044000000. With it back, every
-- revision check and recovery session for a chapter the student practised but
-- their section is not mapped to refuses to start again — the defect this
-- migration fixed (KNOWN_ISSUES 58). Roll back only to undo the ruling.

BEGIN;

DO $pre$
BEGIN
  IF to_regclass('public.routines_pre_20261044000000') IS NULL THEN
    RAISE EXCEPTION 'ABORT: routines_pre_20261044000000 is gone, so the definition cannot be put back exactly.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261044000000
              WHERE applied IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ABORT: _recovery_chapter_is_for changed since 20261044000000 was applied. Roll back what changed it first.';
  END IF;
END
$pre$;

DO $restore$
DECLARE _r record;
BEGIN
  FOR _r IN SELECT definition FROM public.routines_pre_20261044000000 LOOP
    EXECUTE _r.definition;
  END LOOP;
END
$restore$;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM public.routines_pre_20261044000000
              WHERE definition IS DISTINCT FROM pg_get_functiondef(object::regprocedure)) THEN
    RAISE EXCEPTION 'ROLLED BACK: _recovery_chapter_is_for did not come back exactly as it was';
  END IF;
  RAISE NOTICE 'rollback OK: the entitlement guard is section-only again';
END
$verify$;

DROP TABLE public.routines_pre_20261044000000;
DELETE FROM public.schema_migrations WHERE version = '20261044000000_a_chapter_you_practised_is_yours_to_revise';

COMMIT;
