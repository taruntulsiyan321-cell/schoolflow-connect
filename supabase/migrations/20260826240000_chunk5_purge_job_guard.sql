-- =====================================================================
-- CHUNK 5 (correction) — rpc_purge_deleted_homework is a job, and says so
--
-- Found by the tenant-scope gate, not by reading the code: the purge deletes
-- every institution's expired homework with no school predicate at all. It is
-- SECURITY DEFINER, so nothing else would have stopped it.
--
-- Scoping it per institution would be wrong -- G6's 7-day retention is uniform
-- and a purge has no per-user caller. The honest fix is to make "this is a
-- platform job" a property the function enforces rather than a comment: it
-- refuses to run when there IS a caller. That turns the missing school
-- predicate from an oversight into a structurally unreachable path, which is
-- the standard the tenant-scope allowlist asks for.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.rpc_purge_deleted_homework()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _n int;
BEGIN
  -- No per-user caller. A logged-in user reaching this would be deleting other
  -- institutions' homework, so refuse rather than scope: there is no correct
  -- institution to scope to.
  IF auth.uid() IS NOT NULL THEN
    RAISE EXCEPTION
      'rpc_purge_deleted_homework is a platform maintenance job; it has no per-user caller and deletes across institutions by design';
  END IF;

  -- G6: homework is retained 7 days, restorable by admin, then permanent.
  WITH gone AS (
    DELETE FROM public.homework
     WHERE deleted_at IS NOT NULL
       AND deleted_at < now() - interval '7 days'
    RETURNING 1
  )
  SELECT count(*) INTO _n FROM gone;
  RETURN _n;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.rpc_purge_deleted_homework() FROM public, anon, authenticated;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'rpc_purge_deleted_homework'
       AND p.prosrc NOT LIKE '%auth.uid() IS NOT NULL%'
  ) THEN
    RAISE EXCEPTION 'Chunk 5 correction: the purge job guard is missing';
  END IF;

  IF has_function_privilege('authenticated', 'public.rpc_purge_deleted_homework()', 'EXECUTE') THEN
    RAISE EXCEPTION 'Chunk 5 correction: authenticated can still execute the purge job';
  END IF;
END $$;
