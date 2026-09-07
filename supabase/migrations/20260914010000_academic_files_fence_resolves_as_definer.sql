-- ═══════════════════════════════════════════════════════════════════════════
-- The academic-files fence could not see the profile it was asking about
--
-- ── THE DEFECT, CAUGHT BY ITS OWN POSITIVE CONTROL ───────────────────────
--
-- 20260914000000 applied the read policy that KNOWN_ISSUES 7 had carried,
-- verbatim, for a year:
--
--   USING (bucket_id = 'academic-files' AND EXISTS (
--            SELECT 1 FROM public.profiles p
--             WHERE p.id::text = (storage.foldername(name))[1]
--               AND p.school_id = public.get_my_school_id()))
--
-- Every denial test passed. The POSITIVE control did not: a Class 10-A student
-- could not read a file uploaded by their own teacher. Measured as that
-- student, in probe99:
--
--   get_my_school_id()                     -> 00000000-…-000000000001   (right)
--   rows visible in public.profiles        -> 1                          (their own)
--   the teacher's profiles row             -> NOT VISIBLE
--
-- **A policy predicate runs as the CALLER.** `public.profiles` has its own RLS,
-- and a student sees exactly one row in it — themselves. So the EXISTS was
-- false for every object uploaded by anyone else, and the fence refused every
-- academic file to every student. It would have looked like a perfect security
-- fix and silently broken every homework attachment and every resource
-- download. This is the same shape as the trash view that was unreadable by
-- admins: an invoker-context lookup of something the invoker cannot see.
--
-- ── THE SECOND DEFECT IN THE SAME LINE ───────────────────────────────────
--
-- `p.school_id` is the WRONG source even with permission. `profiles.school_id`
-- is NULL on 44 of 64 accounts, including 40 of the 52 student accounts, so an
-- object uploaded by any of them would resolve to NULL and be readable by
-- nobody — not even the person who uploaded it. `get_my_school_id()` already
-- knows better; it falls through membership → students → teachers → parents →
-- profiles. The uploader deserves the same resolution as the reader, and now
-- gets it.
--
-- ── THE FIX ──────────────────────────────────────────────────────────────
--
-- `storage_object_owner_school_id` is SECURITY DEFINER — load-bearing, exactly
-- as it is for `can_read_student_row` — so the lookup is not gated by the
-- caller's view of `profiles`, `students` or `memberships`. It mirrors
-- `get_my_school_id`'s fallback chain for the OBJECT'S OWNER.
--
-- The uploader is admitted by path, before any lookup, so a person can always
-- reach their own file even if their school cannot be resolved at all.
--
-- NULL IS A REFUSAL, NOT AN ADMISSION. An unresolvable owner yields NULL, and
-- `NULL = anything` is NULL, which excludes the row. There is deliberately no
-- `IS NULL OR …` escape hatch (G14).
--
-- §10.19 Multi-tenancy: the comparison is still school-to-school; only where
-- the owner's school is read from has changed.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE OR REPLACE FUNCTION public.storage_object_owner_school_id(_object_name text)
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public', 'storage'
AS $function$
  WITH owner AS (
    -- Segment 1 of the object key is the uploader's auth id — every write
    -- policy on these buckets pins it there. Guarded rather than cast blindly:
    -- an object whose first segment is not a uuid must return NULL, not raise,
    -- because a raising policy makes the whole SELECT fail rather than filter.
    SELECT CASE
             WHEN (storage.foldername(_object_name))[1] ~*
                  '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
             THEN ((storage.foldername(_object_name))[1])::uuid
           END AS id
  )
  SELECT COALESCE(
    (SELECT m.school_id FROM public.memberships m, owner o
      WHERE m.account_id = o.id AND m.status = 'active' AND m.school_id IS NOT NULL LIMIT 1),
    (SELECT s.school_id FROM public.students s, owner o
      WHERE s.user_id = o.id AND s.school_id IS NOT NULL LIMIT 1),
    (SELECT t.school_id FROM public.teachers t, owner o
      WHERE t.user_id = o.id AND t.school_id IS NOT NULL LIMIT 1),
    (SELECT pa.school_id FROM public.parents pa, owner o
      WHERE pa.user_id = o.id AND pa.school_id IS NOT NULL LIMIT 1),
    (SELECT p.school_id FROM public.profiles p, owner o WHERE p.id = o.id)
  )
$function$;

REVOKE ALL ON FUNCTION public.storage_object_owner_school_id(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storage_object_owner_school_id(text)
  TO anon, authenticated, service_role;

COMMENT ON FUNCTION public.storage_object_owner_school_id(text) IS
  'The school of whoever uploaded a storage object, read from segment 1 of the '
  'object key. SECURITY DEFINER because a storage.objects policy runs as the '
  'CALLER, and a student can see exactly one row of public.profiles -- their '
  'own -- so an invoker-context lookup refused every file uploaded by anyone '
  'else. Mirrors get_my_school_id''s fallback chain because profiles.school_id '
  'alone is NULL on 44 of 64 accounts. Returns NULL when unresolvable, which '
  'excludes the row.';

DROP POLICY IF EXISTS "academic files read" ON storage.objects;
CREATE POLICY "academic files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'academic-files'
    AND (
      -- Your own upload, always, without needing any school to resolve.
      (storage.foldername(name))[1] = auth.uid()::text
      -- ...or anyone in the uploader's school.
      OR public.storage_object_owner_school_id(name) = public.get_my_school_id()
    )
  );

COMMIT;

-- ═══════════════════════════════════════════════════════════════════════════
-- VERIFICATION — shape only; this runs as the migration role, which bypasses
-- RLS and holds every grant, so it cannot prove who is admitted (rule 6).
-- probe28 asserts the behaviour as the caller, INCLUDING the positive control
-- that caught this (rule 7).
-- ═══════════════════════════════════════════════════════════════════════════
DO $verify$
DECLARE
  _fn  text;
  _pol text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'storage_object_owner_school_id';
  IF _fn IS NULL THEN
    RAISE EXCEPTION 'ABORT: storage_object_owner_school_id was not created';
  END IF;
  IF _fn !~ 'SECURITY DEFINER' THEN
    RAISE EXCEPTION 'ABORT: the owner lookup is not SECURITY DEFINER -- it will see nothing as a student';
  END IF;
  IF _fn !~ 'memberships' OR _fn !~ 'students' OR _fn !~ 'teachers' OR _fn !~ 'parents' THEN
    RAISE EXCEPTION 'ABORT: the owner lookup lost a fallback and is back to profiles alone';
  END IF;

  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _pol
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'storage' AND c.relname = 'objects' AND p.polname = 'academic files read';
  IF _pol IS NULL THEN
    RAISE EXCEPTION 'ABORT: academic files read is missing';
  END IF;
  IF _pol ~ 'FROM public\.profiles' OR _pol ~ 'profiles' THEN
    RAISE EXCEPTION 'ABORT: the policy reads public.profiles directly again -- the caller cannot see it';
  END IF;
  IF _pol !~ 'storage_object_owner_school_id' THEN
    RAISE EXCEPTION 'ABORT: the policy does not use the definer lookup';
  END IF;
  IF NOT has_function_privilege('authenticated', 'public.storage_object_owner_school_id(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated cannot execute the owner lookup';
  END IF;

  RAISE NOTICE 'academic files read resolves the owner as definer; behaviour is asserted in probe28.';
END $verify$;
