-- Rollback for 20260914000000_private_buckets.sql
--
-- Puts both buckets back to public with their previous read policies. The
-- `doubt-images` size limit is NOT removed: it was NULL before, and restoring
-- "no limit at all" would re-open an unmetered upload target for no benefit.
-- 20 MB matches every other bucket in the project, so nothing depends on its
-- absence. That is a deliberate asymmetry, stated rather than silent.
--
-- ROLLING THIS BACK DOES NOT RESTORE THE OLD CLIENT. `uploadAcademicFile` and
-- `uploadDoubtImage` store durable refs, and the readers sign them; on a public
-- bucket signing still works, so the app keeps functioning either way. What
-- changes is only that the objects become world-readable again.

BEGIN;

UPDATE storage.buckets SET public = true WHERE id = 'academic-files';
UPDATE storage.buckets SET public = true WHERE id = 'doubt-images';

DROP POLICY IF EXISTS "academic files read" ON storage.objects;
CREATE POLICY "academic files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'academic-files');

DROP POLICY IF EXISTS "doubt images read" ON storage.objects;
CREATE POLICY "doubt images public read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'doubt-images');

COMMIT;

DO $verify$
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets
              WHERE id IN ('academic-files','doubt-images') AND NOT public) THEN
    RAISE EXCEPTION 'ABORT: a bucket is still private after rollback';
  END IF;
  -- Positive control: the write policies this rollback must NOT have touched.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'objects'
       AND p.polname = 'academic files delete own'
  ) THEN
    RAISE EXCEPTION 'ABORT: the rollback removed an upload/delete policy as well';
  END IF;
  RAISE NOTICE 'buckets public again; write policies intact.';
END $verify$;
