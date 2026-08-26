-- =====================================================================
-- REVERSE OF: 20260825140000_chunk1_tenant_fence_restrictive.sql
--
-- Drops every restrictive tenancy fence policy this chunk created. Running
-- this re-opens the 29 cross-institution leaks the fence closed.
-- =====================================================================

DO $undo$
DECLARE _r record; _n int := 0;
BEGIN
  FOR _r IN
    SELECT tablename, policyname
      FROM pg_policies
     WHERE schemaname = 'public'
       AND permissive = 'RESTRICTIVE'
       AND policyname LIKE '%\_tenant\_fence'
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', _r.policyname, _r.tablename);
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'dropped % tenant fence policies', _n;
END;
$undo$;

DELETE FROM public.schema_migrations
 WHERE version = '20260825140000_chunk1_tenant_fence_restrictive';
