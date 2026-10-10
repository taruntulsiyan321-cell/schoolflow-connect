-- ROLLBACK 20261156000000 — no profile photos.
--
-- Drops the function, the column's check and comment (it had none before),
-- and the three storage policies, and sets every photo_url back to NULL —
-- the state measured before (all 70 NULL), and the app before D1 shows none.
--
-- The profile-photos bucket and any files in it are LEFT: a storage file is
-- removed through the storage API, not SQL (deleting storage.objects rows
-- strands the files). With the policies gone no student can reach them; empty
-- the bucket from the dashboard or the API, then delete it there.

BEGIN;

DROP FUNCTION public.rpc_set_profile_photo(text);

UPDATE public.profiles SET photo_url = NULL WHERE photo_url IS NOT NULL;
ALTER TABLE public.profiles DROP CONSTRAINT profiles_photo_in_own_folder;
COMMENT ON COLUMN public.profiles.photo_url IS NULL;

DROP POLICY IF EXISTS "profile photos read own" ON storage.objects;
DROP POLICY IF EXISTS "profile photos insert own" ON storage.objects;
DROP POLICY IF EXISTS "profile photos delete own" ON storage.objects;

COMMIT;
