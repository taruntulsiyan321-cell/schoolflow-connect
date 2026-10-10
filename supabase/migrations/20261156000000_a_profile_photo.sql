-- ═══════════════════════════════════════════════════════════════════════════
-- A PROFILE PHOTO (docs/TODO.md D1)
-- ═══════════════════════════════════════════════════════════════════════════
--
-- Owner, 2026-10-03: the initials in a coloured circle look bad. A student
-- may put their own photo there instead — cropped square in the app, stored
-- privately, shown wherever the initials are; removed or replaced at will.
-- The initials stay the fallback.
--
-- 1. profile-photos: a private bucket, one folder per account, JPEG only
--    (the app always uploads a 512-pixel JPEG it drew itself), 1 MB cap. A
--    student reads, adds and removes only in their own folder. No update: a
--    new photo is a new object, so a signed link to the old one never shows
--    the new picture under the old name.
-- 2. profiles.photo_url says what it holds — the object key, {user_id}/{n}.jpg
--    — and a CHECK holds it to the owner's own folder, so the row's own update
--    policy (a student may edit their profile) cannot point it elsewhere.
-- 3. rpc_set_profile_photo(path) sets it, after checking the object is the
--    caller's and was uploaded; NULL clears it. The app removes the old file
--    itself (storage removal goes through the storage API, not SQL).
--
-- Measured 2026-10-09: profiles.photo_url is NULL on all 70 rows, and the app
-- read it into the session and showed it nowhere.
--
-- ROLLBACK: rollback/20261156000000_a_profile_photo.rollback.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── 1. Private, one folder per account ──────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-photos', 'profile-photos', false, 1048576, ARRAY['image/jpeg'])
ON CONFLICT (id) DO UPDATE
SET public = EXCLUDED.public,
    file_size_limit = EXCLUDED.file_size_limit,
    allowed_mime_types = EXCLUDED.allowed_mime_types;

DROP POLICY IF EXISTS "profile photos read own" ON storage.objects;
DROP POLICY IF EXISTS "profile photos insert own" ON storage.objects;
DROP POLICY IF EXISTS "profile photos delete own" ON storage.objects;

CREATE POLICY "profile photos read own" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "profile photos insert own" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

CREATE POLICY "profile photos delete own" ON storage.objects
  FOR DELETE TO authenticated
  USING (bucket_id = 'profile-photos' AND (storage.foldername(name))[1] = auth.uid()::text);

-- ── 2. What the column holds ────────────────────────────────────────────────
COMMENT ON COLUMN public.profiles.photo_url IS
  'The account''s photo: an object key {user_id}/{n}.jpg in the private profile-photos bucket, shown through a signed link. NULL: the initials (20261156000000).';

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_photo_in_own_folder
  CHECK (photo_url IS NULL OR photo_url ~ ('^' || id::text || '/[0-9]+\.jpg$'));

-- ── 3. Set it, or clear it ──────────────────────────────────────────────────
CREATE FUNCTION public.rpc_set_profile_photo(_path text DEFAULT NULL)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _uid uuid := auth.uid();
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'auth required' USING ERRCODE = '42501'; END IF;
  IF _path IS NOT NULL THEN
    IF _path !~ ('^' || _uid::text || '/[0-9]+\.jpg$') THEN
      RAISE EXCEPTION 'photo_not_yours' USING ERRCODE = '42501',
        DETAIL = 'A photo is kept in your own folder.';
    END IF;
    IF NOT EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'profile-photos' AND o.name = _path) THEN
      RAISE EXCEPTION 'photo_not_uploaded' USING ERRCODE = 'P0002',
        DETAIL = 'The photo did not finish uploading. Try again.';
    END IF;
  END IF;
  UPDATE public.profiles SET photo_url = _path WHERE id = _uid;
  RETURN _path;
END $$;

COMMENT ON FUNCTION public.rpc_set_profile_photo(text) IS
  'Set the caller''s photo to an object they uploaded to their own profile-photos folder, or clear it with NULL (20261156000000, D1).';

REVOKE ALL ON FUNCTION public.rpc_set_profile_photo(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.rpc_set_profile_photo(text) TO authenticated;

-- ── PROOF, as the callers, before COMMIT ────────────────────────────────────
DO $proof$
DECLARE
  _a     uuid;
  _b     uuid;
  _pa    text;
  _pb    text;
  _got   text;
  _err   text;
  _n     int;
BEGIN
  -- 1. The bucket and its fence.
  IF NOT EXISTS (SELECT 1 FROM storage.buckets b WHERE b.id = 'profile-photos' AND NOT b.public
                  AND b.file_size_limit = 1048576 AND b.allowed_mime_types = ARRAY['image/jpeg']) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the photo bucket is missing, public, uncapped or not JPEG-only';
  END IF;
  IF (SELECT count(*) FROM pg_policies p WHERE p.schemaname = 'storage' AND p.tablename = 'objects'
        AND p.policyname LIKE 'profile photos %'
        AND coalesce(p.qual, p.with_check) LIKE '%profile-photos%foldername%auth.uid()%') <> 3 THEN
    RAISE EXCEPTION 'VERIFY FAILED: the photo bucket is not fenced to the owner''s folder';
  END IF;

  SELECT p.id INTO _a FROM public.profiles p ORDER BY p.id LIMIT 1;
  SELECT p.id INTO _b FROM public.profiles p WHERE p.id <> _a ORDER BY p.id LIMIT 1;
  _pa := _a::text || '/1700000000000.jpg';
  _pb := _b::text || '/1700000000000.jpg';

  BEGIN
    -- 2. A uploads into their own folder, and not into B's.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    SET LOCAL ROLE authenticated;
    INSERT INTO storage.objects (bucket_id, name) VALUES ('profile-photos', _pa);
    BEGIN
      INSERT INTO storage.objects (bucket_id, name) VALUES ('profile-photos', _pb);
      RAISE EXCEPTION 'VERIFY FAILED: A wrote into B''s photo folder';
    EXCEPTION WHEN insufficient_privilege THEN NULL;
    END;

    -- 3. A sets it, and the profile carries the key.
    _got := public.rpc_set_profile_photo(_pa);
    RESET ROLE;
    IF (SELECT p.photo_url FROM public.profiles p WHERE p.id = _a) IS DISTINCT FROM _pa OR _got IS DISTINCT FROM _pa THEN
      RAISE EXCEPTION 'VERIFY FAILED: A''s photo was not set';
    END IF;

    -- 4. A cannot point at B's folder, nor at a photo never uploaded — by the
    --    function, or by editing their own row directly.
    SET LOCAL ROLE authenticated;
    BEGIN
      PERFORM public.rpc_set_profile_photo(_pb);
      _err := 'none';
    -- Any error, named: a refusal for the wrong reason must not pass as this one.
    EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
    END;
    IF _err <> 'photo_not_yours' THEN RAISE EXCEPTION 'VERIFY FAILED: another folder gave %', _err; END IF;
    BEGIN
      PERFORM public.rpc_set_profile_photo(_a::text || '/1700000000001.jpg');
      _err := 'none';
    EXCEPTION WHEN OTHERS THEN _err := SQLERRM;
    END;
    IF _err <> 'photo_not_uploaded' THEN RAISE EXCEPTION 'VERIFY FAILED: a missing photo gave %', _err; END IF;
    BEGIN
      UPDATE public.profiles SET photo_url = _pb WHERE id = _a;
      _err := 'none';
    EXCEPTION WHEN check_violation THEN _err := 'refused';
    END;
    IF _err <> 'refused' THEN RAISE EXCEPTION 'VERIFY FAILED: A pointed their own row at B''s folder'; END IF;

    -- 5. B sees none of A's photo.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _b, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO _n FROM storage.objects o WHERE o.bucket_id = 'profile-photos' AND o.name = _pa;
    IF _n <> 0 THEN RAISE EXCEPTION 'VERIFY FAILED: B reads A''s photo'; END IF;
    -- CONTROL: A does.
    PERFORM set_config('request.jwt.claims', json_build_object('sub', _a, 'role', 'authenticated')::text, true);
    SELECT count(*) INTO _n FROM storage.objects o WHERE o.bucket_id = 'profile-photos' AND o.name = _pa;
    IF _n <> 1 THEN RAISE EXCEPTION 'VERIFY FAILED: A cannot read their own photo'; END IF;

    -- 6. Cleared: the initials again.
    PERFORM public.rpc_set_profile_photo(NULL);
    RESET ROLE;
    IF (SELECT p.photo_url FROM public.profiles p WHERE p.id = _a) IS NOT NULL THEN
      RAISE EXCEPTION 'VERIFY FAILED: the photo was not cleared';
    END IF;

    RAISE EXCEPTION 'proof-rollback';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM <> 'proof-rollback' THEN RAISE; END IF;
  END;

  IF EXISTS (SELECT 1 FROM storage.objects o WHERE o.bucket_id = 'profile-photos' AND o.name IN (_pa, _pb)) THEN
    RAISE EXCEPTION 'VERIFY FAILED: the proof''s objects survived';
  END IF;

  -- 7. Not for anon.
  IF has_function_privilege('anon', 'public.rpc_set_profile_photo(text)', 'EXECUTE')
     OR NOT has_function_privilege('authenticated', 'public.rpc_set_profile_photo(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'VERIFY FAILED: grants';
  END IF;
END $proof$;

COMMIT;
