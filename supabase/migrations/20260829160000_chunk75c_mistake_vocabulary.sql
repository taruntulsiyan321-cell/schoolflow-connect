-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5c — 'dpp' is a value in the schema, not just a table name
--
-- student_mistakes encodes DPP in two CHECK constraints:
--
--   source          IN ('dpp', 'battleground', 'exam', 'practice')
--   assessment_type IN ('practice', 'dpp', 'battle')
--
-- Neither admits 'test', so rpc_test_submit could not record a single mistake
-- — found by CHUNK75_VERIFY item 3, three constraint violations deep into an
-- end-to-end run. And 7.5 verification item 4 requires zero references to dpp
-- ANYWHERE, schema included. A convergence that renames the tables and leaves
-- the vocabulary saying 'dpp' has not converged anything.
--
-- One live row carries source='dpp'/assessment_type='dpp'. It is migrated
-- rather than deleted: it is a real mistake in a student's book, and the
-- feature it came from is being renamed, not withdrawn.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- Constraints first would reject the very rows we are about to migrate, and
-- migrating first would violate the constraints still in force. So: drop,
-- migrate, re-add.
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_source_check;
ALTER TABLE public.student_mistakes DROP CONSTRAINT IF EXISTS student_mistakes_assessment_type_check;

UPDATE public.student_mistakes SET source          = 'test' WHERE source = 'dpp';
UPDATE public.student_mistakes SET assessment_type = 'test' WHERE assessment_type = 'dpp';

ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_source_check
  CHECK (source = ANY (ARRAY['test', 'battleground', 'exam', 'practice']));

ALTER TABLE public.student_mistakes
  ADD CONSTRAINT student_mistakes_assessment_type_check
  CHECK (assessment_type IS NULL
         OR assessment_type = ANY (ARRAY['practice', 'test', 'battle']));

-- assessment_type gains an explicit NULL arm it did not have. 483 of the 489
-- rows carry NULL today and were only legal because a CHECK passes on NULL by
-- default; stating it means the column's rule is readable rather than
-- inferred from three-valued logic.

DO $assert$
DECLARE _n int;
BEGIN
  SELECT count(*)::int INTO _n FROM public.student_mistakes
   WHERE source = 'dpp' OR assessment_type = 'dpp';
  IF _n > 0 THEN RAISE EXCEPTION '% student_mistakes row(s) still say dpp', _n; END IF;

  SELECT count(*)::int INTO _n FROM pg_constraint
   WHERE conrelid = 'public.student_mistakes'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%dpp%';
  IF _n > 0 THEN RAISE EXCEPTION '% constraint(s) on student_mistakes still name dpp', _n; END IF;
END
$assert$;

COMMIT;
