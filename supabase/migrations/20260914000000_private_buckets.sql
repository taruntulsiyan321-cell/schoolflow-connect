-- ═══════════════════════════════════════════════════════════════════════════
-- The two public buckets stop being public (KNOWN_ISSUES 7 and 7b)
--
-- ── WHAT WAS OPEN ────────────────────────────────────────────────────────
--
--   academic-files   public = true, 20 MB, SELECT policy `bucket_id = ...`
--   doubt-images     public = true, NO SIZE LIMIT, public read
--
-- `public = true` on a Supabase bucket means URL-enumerable: no token, no
-- signature, no expiry. `academic-files` holds homework attachments and
-- teaching resources. `doubt-images` holds student photographs of homework and
-- handwriting — faces, names, and a child's own work — and was the only bucket
-- in the project with no size limit at all, so it was an unmetered upload
-- target as well as a disclosure surface.
--
-- ── WHY IT IS SAFE TO DO NOW ─────────────────────────────────────────────
--
-- The client stopped depending on public URLs first, which is the whole reason
-- this is one migration rather than a migration plus a scramble:
--
--   * `academicFileUrl` (landed 2026-09-07) signs every read of academic-files
--     and `uploadAcademicFile` stores a durable ref, not a URL.
--   * `doubtImageUrl` / `uploadDoubtImage` do the same for doubt-images, in the
--     same change as this file.
--   * `getPublicUrl` appears NOWHERE in `src/` any more. Measured before
--     applying.
--
-- And there is nothing to migrate. Measured 2026-09-07:
--   learning_resources 0 rows · homework attachments 0 · academic-files 1 object
--   community_doubts with an image 0 · doubt-images 0 objects
--
-- ── THE READ POLICIES, AND WHY NOT THE ONES THAT WERE DRAFTED ────────────
--
-- academic-files keeps the drafted shape: object keys are `{auth.uid}/{file}`
-- with no school segment, so the fence goes through the UPLOADER'S profile.
-- INSERT/UPDATE/DELETE already pin segment 1 to auth.uid() and are untouched.
--
-- doubt-images does NOT. The drafted policy was
--   `USING (bucket_id = 'doubt-images' AND owner = auth.uid())`
-- and applying it verbatim would have broken the feature: the community doubt
-- portal exists so that CLASSMATES and the SUBJECT TEACHER can answer, and
-- `community_doubts` is readable by exactly them plus school admin/principal.
-- An owner-only image policy makes every doubt picture invisible to everyone
-- except the child who posted it — a fence that silently removes the point of
-- the feature. Instead the policy asks the ROW's own question: you may read the
-- object if you may read a doubt or an answer that references it. Same
-- audience, no wider, no narrower.
--
-- The match is exact, not `LIKE`. Both stored shapes are enumerated
-- (`doubt-images/{path}` and a bare `{path}`) because the client writes the
-- first and older code wrote the second; a legacy public URL is not matched
-- because zero rows have one.
--
-- §10.19 Multi-tenancy is carried by the referencing tables' own predicates —
-- `same_school` / `student_class_id` / `teacher_teaches_class_subject` — rather
-- than restated here, so there is one home for the rule.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- ── academic-files ────────────────────────────────────────────────────────
UPDATE storage.buckets SET public = false WHERE id = 'academic-files';

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

-- ── doubt-images ──────────────────────────────────────────────────────────
UPDATE storage.buckets
   SET public = false,
       file_size_limit = 20971520          -- 20 MB, matching doubt-attachments
 WHERE id = 'doubt-images';

DROP POLICY IF EXISTS "doubt images public read" ON storage.objects;
DROP POLICY IF EXISTS "doubt images read"        ON storage.objects;
DROP POLICY IF EXISTS "doubt images owner read"  ON storage.objects;

CREATE POLICY "doubt images read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'doubt-images'
    AND (
      -- The child who uploaded it, always.
      (storage.foldername(name))[1] = auth.uid()::text
      -- ...and everyone who may read the doubt it belongs to.
      OR EXISTS (
           SELECT 1 FROM public.community_doubts d
            WHERE d.image_url IN ('doubt-images/' || storage.objects.name, storage.objects.name)
              AND (
                d.class_id = public.student_class_id(auth.uid())
                OR public.teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)
                OR (public.same_school(d.school_id)
                    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
                         OR public.has_role(auth.uid(), 'principal'::public.app_role)))
              )
         )
      -- ...or the answer it belongs to, which has the same audience.
      OR EXISTS (
           SELECT 1
             FROM public.community_doubt_answers a
             JOIN public.community_doubts d ON d.id = a.doubt_id
            WHERE a.image_url IN ('doubt-images/' || storage.objects.name, storage.objects.name)
              AND (
                d.class_id = public.student_class_id(auth.uid())
                OR public.teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)
                OR (public.same_school(d.school_id)
                    AND (public.has_role(auth.uid(), 'admin'::public.app_role)
                         OR public.has_role(auth.uid(), 'principal'::public.app_role)))
              )
         )
    )
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only. This runs as the migration role, which bypasses
-- RLS, so it cannot prove who is admitted (rule 6). probe28 asserts the
-- behaviour as the caller (rule 7): a teacher signs and fetches their own
-- object, a classmate reads a doubt image, an outsider does not, and no
-- unauthenticated fetch of a bucket path succeeds.
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _n int;
BEGIN
  IF EXISTS (SELECT 1 FROM storage.buckets
              WHERE id IN ('academic-files','doubt-images') AND public) THEN
    RAISE EXCEPTION 'ABORT: a bucket is still public';
  END IF;
  IF EXISTS (SELECT 1 FROM storage.buckets
              WHERE id IN ('academic-files','doubt-images') AND file_size_limit IS NULL) THEN
    RAISE EXCEPTION 'ABORT: a bucket still has no size limit';
  END IF;

  SELECT count(*) INTO _n FROM pg_policy p
    JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects'
     AND p.polname IN ('academic files read', 'doubt images read');
  IF _n <> 2 THEN
    RAISE EXCEPTION 'ABORT: expected both read policies, found %', _n;
  END IF;

  -- The drafted owner-only doubt policy would have hidden every image from the
  -- classmates the portal exists for. Fail loudly if it ever comes back.
  IF EXISTS (
    SELECT 1 FROM pg_policy p
      JOIN pg_class c ON c.oid = p.polrelid
      JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'storage' AND c.relname = 'objects'
       AND p.polname = 'doubt images read'
       AND pg_get_expr(p.polqual, p.polrelid) !~ 'community_doubts'
  ) THEN
    RAISE EXCEPTION 'ABORT: doubt images read no longer consults the doubt it belongs to';
  END IF;

  RAISE NOTICE 'both buckets private and sized; behaviour is asserted in probe28.';
END $verify$;
