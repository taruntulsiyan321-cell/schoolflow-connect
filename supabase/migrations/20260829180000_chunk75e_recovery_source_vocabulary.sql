-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5e — 'dpp' in one more constraint
--
--   recovery_assignments.source_type CHECK IN ('practice', 'dpp', 'battle')
--
-- The second place this chunk has found the retired feature living as a VALUE
-- rather than a table name (student_mistakes.source and .assessment_type were
-- the first). 7.5 verification item 4 requires zero references to dpp anywhere,
-- schema included.
--
-- Only 'practice' is in use, so nothing is migrated — but the constraint is
-- still converged, because the next recovery assignment sourced from a test
-- would otherwise be rejected by a constraint naming a feature that no longer
-- exists. That is G15's third pattern: a CHECK that omits the value about to
-- be written.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE _n int;
BEGIN
  SELECT count(*)::int INTO _n FROM public.recovery_assignments WHERE source_type = 'dpp';
  IF _n > 0 THEN
    RAISE NOTICE 'migrating % recovery_assignments row(s) from dpp to test', _n;
  END IF;
END
$guard$;

ALTER TABLE public.recovery_assignments DROP CONSTRAINT IF EXISTS recovery_assignments_source_type_check;

UPDATE public.recovery_assignments SET source_type = 'test' WHERE source_type = 'dpp';

ALTER TABLE public.recovery_assignments
  ADD CONSTRAINT recovery_assignments_source_type_check
  CHECK (source_type = ANY (ARRAY['practice', 'test', 'battle']));

DO $assert$
DECLARE _n int;
BEGIN
  SELECT count(*)::int INTO _n FROM pg_constraint
   WHERE conrelid = 'public.recovery_assignments'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%dpp%';
  IF _n > 0 THEN RAISE EXCEPTION 'recovery_assignments still has a constraint naming dpp'; END IF;
END
$assert$;

COMMIT;
