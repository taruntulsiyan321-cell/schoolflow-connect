-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5a FIX — tests carried TWO status constraints, not one
--
-- 7.5a widened the status set so a student can sit a PUBLISHED test:
--
--   ALTER TABLE tests DROP CONSTRAINT IF EXISTS tests_status_check;
--   ALTER TABLE tests ADD  CONSTRAINT tests_status_check
--     CHECK (status = ANY (ARRAY['draft','published','submitted']));
--
-- The constraint it meant to replace is named tests_status_known. So the DROP
-- matched nothing, the ADD created a SECOND constraint, and both had to pass —
-- leaving 'published' rejected by the older one. IF EXISTS made the failed drop
-- silent, which is the whole reason this got as far as an insert.
--
-- The name was guessed from convention rather than read out of pg_constraint.
-- Found by CHUNK75_VERIFY item 1 failing on its very first insert.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_status_known;

-- Assert the outcome rather than trusting the drop: exactly one status
-- constraint must remain, and it must admit 'published'.
DO $assert$
DECLARE _n int; _def text;
BEGIN
  SELECT count(*)::int INTO _n
    FROM pg_constraint
   WHERE conrelid = 'public.tests'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%status%';

  IF _n <> 1 THEN
    RAISE EXCEPTION 'tests carries % status constraint(s), expected exactly 1', _n;
  END IF;

  SELECT pg_get_constraintdef(oid) INTO _def
    FROM pg_constraint
   WHERE conrelid = 'public.tests'::regclass AND contype = 'c'
     AND pg_get_constraintdef(oid) LIKE '%status%';

  IF _def NOT LIKE '%published%' THEN
    RAISE EXCEPTION 'the surviving status constraint does not admit ''published'': %', _def;
  END IF;
END
$assert$;

COMMIT;
