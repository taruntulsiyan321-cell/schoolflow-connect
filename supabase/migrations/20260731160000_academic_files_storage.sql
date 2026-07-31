-- Academic file attachments (homework + submissions + test papers).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'academic-files',
  'academic-files',
  true,
  20971520,
  ARRAY[
    'application/pdf',
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/plain',
    'application/octet-stream'
  ]
)
ON CONFLICT (id) DO UPDATE
SET
  public = EXCLUDED.public,
  file_size_limit = EXCLUDED.file_size_limit,
  allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "academic files read" ON storage.objects;
CREATE POLICY "academic files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'academic-files');

DROP POLICY IF EXISTS "academic files upload" ON storage.objects;
CREATE POLICY "academic files upload" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'academic-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "academic files update own" ON storage.objects;
CREATE POLICY "academic files update own" ON storage.objects
  FOR UPDATE TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );

DROP POLICY IF EXISTS "academic files delete own" ON storage.objects;
CREATE POLICY "academic files delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND (storage.foldername(name))[1] = auth.uid()::text
  );
