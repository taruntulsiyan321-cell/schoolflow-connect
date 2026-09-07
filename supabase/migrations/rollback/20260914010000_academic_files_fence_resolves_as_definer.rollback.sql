-- Rollback for 20260914010000_academic_files_fence_resolves_as_definer.sql
--
-- Restores the policy 20260914000000 installed and drops the helper.
--
-- READ THIS BEFORE RUNNING IT. The restored policy is the one that DOES NOT
-- WORK: `public.profiles` has RLS, a student sees only their own row, and a
-- policy predicate runs as the caller — so it refuses every academic file
-- uploaded by anyone else. Rolling back re-breaks every student download.
--
-- If the goal is to undo the fence rather than this correction, run
-- 20260914000000's rollback instead; it puts the bucket back to public.

BEGIN;

DROP POLICY IF EXISTS "academic files read" ON storage.objects;
CREATE POLICY "academic files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND EXISTS (
      SELECT 1 FROM public.profiles p
       WHERE p.id::text = (storage.foldername(name))[1]
         AND p.school_id = public.get_my_school_id()
    )
  );

DROP FUNCTION IF EXISTS public.storage_object_owner_school_id(text);

COMMIT;

DO $verify$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public' AND p.proname = 'storage_object_owner_school_id'
  ) THEN
    RAISE EXCEPTION 'ABORT: the helper survived the rollback';
  END IF;
  -- Positive control: the doubt-images policy must be untouched by this.
  IF NOT EXISTS (
    SELECT 1 FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'objects' AND p.polname = 'doubt images read'
  ) THEN
    RAISE EXCEPTION 'ABORT: the rollback removed the doubt-images policy as well';
  END IF;
  RAISE NOTICE 'academic files read is back to the profiles-reading form (which refuses students).';
END $verify$;
