-- Rollback for 20260915000000_a_test_cannot_be_created_by_looking_itself_up
--
-- Restores `tests_insert` to `WITH CHECK (can_manage_test(id))` and drops the
-- INSERT-side helper.
--
-- ── WHAT ROLLING THIS BACK COSTS ─────────────────────────────────────────
--
-- The restored policy REFUSES EVERY INSERT into `public.tests`. That is not a
-- side effect of the rollback, it is the state this migration was written to
-- leave: `can_manage_test(id)` looks the new row up in `tests`, the row does
-- not exist yet, the predicate is false. Measured before the fix, as the demo
-- teacher, inserting only real columns:
--
--     ERROR: new row violates row-level security policy for table "tests"
--
-- So applying this rollback returns the project to "no teacher can create a
-- test", which is where it had been for the life of the policy — 72 tests, all
-- seeded, 0 published. Roll back only to unblock something worse.
--
-- The policy body below is the one captured from the live catalog with
-- `pg_get_policydef`-equivalent output BEFORE the change, not reconstructed
-- from migration history. (The last time a rollback was reconstructed from
-- history in this repo it differed from the live body in four places.)
--
-- `can_manage_test` itself is NOT touched here, by this migration or its
-- rollback — `tests_update` and `tests_delete` use it and are correct.

DROP POLICY IF EXISTS tests_insert ON public.tests;

CREATE POLICY tests_insert ON public.tests
  FOR INSERT TO public
  WITH CHECK (public.can_manage_test(id));

DROP FUNCTION IF EXISTS public.can_create_test(uuid, uuid, uuid);

-- Confirm the rollback landed the shape it claims.
DO $verify$
DECLARE _check text;
BEGIN
  SELECT with_check INTO _check
    FROM pg_policies
   WHERE schemaname = 'public' AND tablename = 'tests' AND policyname = 'tests_insert';

  IF _check IS NULL OR _check NOT LIKE '%can_manage_test%' THEN
    RAISE EXCEPTION 'ROLLED BACK: tests_insert was not restored to can_manage_test (got %)', _check;
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'can_create_test'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: can_create_test still exists';
  END IF;

  RAISE NOTICE 'tests_insert restored to can_manage_test(id) — every INSERT is refused again.';
END $verify$;
