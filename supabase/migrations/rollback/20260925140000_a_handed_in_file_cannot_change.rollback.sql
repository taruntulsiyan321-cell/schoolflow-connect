-- Rollback for 20260925140000_a_handed_in_file_cannot_change.sql
--
-- Restores the two academic-files policies exactly as 20260731160000 wrote them
-- (and as the live project holds them), which lets a signed-in user overwrite
-- or delete a file they have handed in again. Run before rolling back
-- 20260925130000, 20260925120000 and 20260925110000.

DROP POLICY "academic files update own" ON storage.objects;
CREATE POLICY "academic files update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY "academic files delete own" ON storage.objects;
CREATE POLICY "academic files delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP FUNCTION public.homework_file_is_fixed(text);
DROP INDEX public.homework_question_file_path_idx;
DROP INDEX public.homework_submissions_file_path_idx;

DO $verify$
BEGIN
  IF to_regprocedure('public.homework_file_is_fixed(text)') IS NOT NULL
     OR EXISTS (SELECT 1 FROM pg_policies
                 WHERE schemaname = 'storage' AND tablename = 'objects'
                   AND policyname IN ('academic files update own', 'academic files delete own')
                   AND qual LIKE '%homework_file_is_fixed%')
     OR (SELECT count(*) FROM pg_policies
          WHERE schemaname = 'storage' AND tablename = 'objects'
            AND policyname IN ('academic files update own', 'academic files delete own')) <> 2 THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: the academic-files policies are not back as 20260731160000 wrote them';
  END IF;
END
$verify$;
