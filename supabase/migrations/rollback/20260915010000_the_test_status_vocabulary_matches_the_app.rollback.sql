-- Rollback for 20260915010000_the_test_status_vocabulary_matches_the_app
--
-- Restores `tests_status_check` to the three-value vocabulary
-- ('draft','published','submitted').
--
-- ── WHAT ROLLING THIS BACK COSTS ─────────────────────────────────────────
--
-- `TestService.schedule()` and `TestService.archive()` write 'scheduled' and
-- 'archived'. Under the restored constraint both raise 23514, so the Schedule
-- and Archive controls in the teacher's test builder stop working again. That
-- is the state this migration was written to leave.
--
-- IT REFUSES TO RUN while any row holds one of the two values it is about to
-- outlaw. Narrowing a CHECK under live rows leaves them in place but
-- un-updatable: every later UPDATE re-evaluates the constraint against the
-- whole row and fails on a column the update never touched. That failure
-- surfaces far from here and reads as something else entirely, so it is
-- refused up front rather than discovered later.
--
-- If the count below is non-zero and you still mean to roll back, decide
-- explicitly what those tests should become — 'draft' for scheduled,
-- 'submitted' or 'draft' for archived — and migrate them first.

DO $guard$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM public.tests WHERE status IN ('scheduled', 'archived');
  IF _n > 0 THEN
    RAISE EXCEPTION
      'REFUSED: % test(s) hold status scheduled/archived. Narrowing the CHECK now would '
      'leave them permanently un-updatable. Migrate them to draft/submitted first.', _n;
  END IF;
END $guard$;

ALTER TABLE public.tests DROP CONSTRAINT IF EXISTS tests_status_check;

ALTER TABLE public.tests
  ADD CONSTRAINT tests_status_check
  CHECK (status = ANY (ARRAY['draft', 'published', 'submitted']));

DO $verify$
DECLARE _def text;
BEGIN
  SELECT pg_get_constraintdef(oid) INTO _def
    FROM pg_constraint
   WHERE conrelid = 'public.tests'::regclass AND conname = 'tests_status_check';

  IF _def IS NULL OR _def LIKE '%scheduled%' OR _def LIKE '%archived%' THEN
    RAISE EXCEPTION 'ROLLED BACK: tests_status_check was not narrowed (got %)', _def;
  END IF;

  RAISE NOTICE 'tests_status_check narrowed to draft/published/submitted — Schedule and Archive now raise 23514 again.';
END $verify$;
