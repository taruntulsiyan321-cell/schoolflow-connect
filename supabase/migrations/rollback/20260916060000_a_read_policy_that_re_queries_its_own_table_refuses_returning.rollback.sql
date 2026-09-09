-- Rollback for 20260916060000_a_read_policy_that_re_queries_its_own_table_refuses_returning
--
-- THIS RESTORES A MEASURED, LIVE BREAKAGE. With the id-in-set form of
-- `tests_read` back in place, no teacher can create a test through the app:
-- PostgREST's `.insert(...).select()` is `INSERT ... RETURNING`, the SELECT
-- policy re-queries `public.tests`, and the new row's id is in neither set
-- while the inserting statement is still running.
--
-- Measured 2026-09-09, as the teacher, before 20260916060000:
--
--   INSERT ... VALUES (...)                  -> OK, row lands
--   INSERT ... VALUES (...) RETURNING id     -> ERROR 42501
--   SELECT that same row afterwards          -> 1 row
--
-- Run this only if the per-row predicate turns out to admit the wrong people —
-- and note that the migration refuses to commit unless its row sets are
-- identical to the old ones for every role it can find, so that is a narrow
-- possibility. Breaking test creation again to undo a role-set change would be
-- the wrong trade; prefer editing `can_read_test_row`.

DROP POLICY IF EXISTS tests_read ON public.tests;
CREATE POLICY tests_read ON public.tests
  FOR SELECT
  USING (
    (id IN (SELECT public.my_readable_test_ids()))
    OR (id IN (SELECT public.my_manageable_test_ids()))
  );

DROP FUNCTION IF EXISTS public.can_read_test_row(uuid, uuid, uuid);

DO $verify$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname='public' AND tablename='tests' AND policyname='tests_read'
       AND qual LIKE '%my_readable_test_ids%'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: tests_read was not restored to the id-in-set form';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname='public' AND p.proname='can_read_test_row'
  ) THEN
    RAISE EXCEPTION 'ROLLED BACK: can_read_test_row is still present';
  END IF;

  -- The two RESTRICTIVE policies are not this migration's and must survive it.
  IF (SELECT count(*) FROM pg_policies
       WHERE schemaname='public' AND tablename='tests'
         AND policyname IN ('tests_tenant_fence','tests_hide_soft_deleted')) <> 2 THEN
    RAISE EXCEPTION 'ROLLED BACK: a fence policy on tests went missing';
  END IF;

  RAISE NOTICE 'tests_read restored to the self-referential form — INSERT ... RETURNING is refused again.';
END $verify$;
