-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9 — resources: PDF and image only, and the uploader owns the delete
--
-- §10.11: "Types: PDF/document and image only … Deletable by the uploader.
-- Permanent deletion — no trash."
--
-- learning_resources holds 0 rows, so every change here is free of migration
-- risk. What it is NOT free of is the shape it has been advertising: a
-- resource_type enum offering
--
--     pdf · video · link · notes · worksheet · presentation · other
--
-- with `link` as the DEFAULT. Five of those seven are not permitted by §10.11,
-- and the default was one of them — so the first resource anyone uploaded
-- through a form that omitted the field would have been a link.
--
-- The enum has exactly one consumer (learning_resources.resource_type) and the
-- table is empty, so it is replaced outright rather than extended. ALTER TYPE
-- ADD VALUE would also have forced this into two migrations: a value added in
-- a transaction cannot be USED in that same transaction, so the CHECK below
-- could not have referenced 'image'.
--
-- ── THE SPEC ASKS FOR A COLUMN THIS SCHEMA CANNOT HAVE ────────────────────
--
-- The Chunk 9 shape names both:
--
--     target_class_id · target_section_id
--
-- There is no `sections` table in this database. Every `section_id` in the
-- schema — attendance_submissions, section_subjects, student_enrolments — is a
-- foreign key to `classes`, and a `classes` row carries BOTH `name` and
-- `section` ("10", "A"). A class row IS a section here.
--
-- So `learning_resources.class_id` already targets what the spec calls a
-- section, and adding `target_section_id` would be a second column pointing at
-- the same table for the same purpose — G9, created on purpose, to satisfy a
-- word. It is not added. REPORTED as a doc-vs-schema contradiction rather than
-- resolved silently in either direction.
--
-- This is also why ruling 5's policy is correct as written:
-- teacher_teaches_class(auth.uid(), class_id) IS "a section they teach".
--
-- ── THE DELETE SPLITS OFF FROM THE WRITE ──────────────────────────────────
--
-- Ruling 5 gave learning_resources one FOR ALL policy: a teacher who teaches
-- the class may do anything. §10.11 is narrower on one verb — "Deletable by
-- the UPLOADER" — so a colleague teaching the same class may upload beside you
-- but may not delete your file.
--
-- FOR ALL cannot express that, so it becomes:
--
--     resources_write   INSERT + UPDATE   teaches the class
--     resources_delete  DELETE            teaches the class AND uploaded it
--
-- The delete keeps the teaching test as well as the uploader test: an account
-- that stops teaching a class should not retain a delete on it.
--
-- ── WHAT IS DELIBERATELY LEFT ALONE ───────────────────────────────────────
--
-- `is_published` stays. §10.11 describes no publish step for resources, so it
-- is arguably surplus — but resources_select reads it, and narrowing who can
-- SEE a resource is a different decision from what §10.11 governs, which is
-- who UPLOADS. Reported, not folded in.
--
-- `created_by` is NOT renamed to the spec's uploaded_by_teacher_id. It holds an
-- auth.users id, not a teachers.id, and every policy here tests auth.uid().
-- Renaming it to say "teacher_id" while it holds a user id would be a name
-- that lies about its contents — the same G14 shape as a policy called
-- "anyone insert" that is not.
--
-- NO VIEW TRACKING IS CREATED. §10.11: "No view tracking of any kind. Not who
-- opened it, not a view count. Do not create the table." A column scan, a
-- function scan, a view scan and a client scan all confirm none exists today,
-- and the verification below asserts none appeared.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE _rows int;
BEGIN
  SELECT count(*) INTO _rows FROM public.learning_resources;
  IF _rows <> 0 THEN
    RAISE EXCEPTION
      'ABORT: learning_resources has % row(s). This migration narrows the type enum with no mapping for video/link/notes/worksheet/presentation/other; write the mapping first.',
      _rows;
  END IF;
END
$guard$;

-- ── PDF and image only ────────────────────────────────────────────────────
CREATE TYPE public.resource_file_type AS ENUM ('pdf', 'image');

ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type DROP DEFAULT;

ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type TYPE public.resource_file_type
  USING resource_type::text::public.resource_file_type;

-- No default. §10.11 permits two kinds and neither is the obvious one; a
-- default here is how `link` became the shape of an unspecified upload.
ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type SET NOT NULL;

DROP TYPE public.resource_type;

COMMENT ON COLUMN public.learning_resources.resource_type IS
  '§10.11: PDF/document and image ONLY. Deliberately has no default - the '
  'previous enum defaulted to ''link'', which the spec does not permit.';

-- ── The write splits from the delete ──────────────────────────────────────
DROP POLICY IF EXISTS resources_manage ON public.learning_resources;

CREATE POLICY resources_write ON public.learning_resources
  FOR INSERT TO authenticated
  WITH CHECK (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  );

CREATE POLICY resources_update ON public.learning_resources
  FOR UPDATE TO authenticated
  USING (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  )
  WITH CHECK (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  );

CREATE POLICY resources_delete ON public.learning_resources
  FOR DELETE TO authenticated
  USING (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND created_by = auth.uid()
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  );

COMMENT ON POLICY resources_delete ON public.learning_resources IS
  '§10.11: deletable by the UPLOADER. Still tests the teaching relationship - '
  'an account that stops teaching a class should not keep a delete on it.';

-- ── Assert the outcome, not the statements ────────────────────────────────
DO $verify$
DECLARE _n int; _labels text;
BEGIN
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO _labels
    FROM pg_enum WHERE enumtypid = 'public.resource_file_type'::regtype;
  IF _labels <> 'pdf,image' THEN
    RAISE EXCEPTION 'resource_file_type is %, expected exactly pdf,image', _labels;
  END IF;

  IF to_regtype('public.resource_type') IS NOT NULL THEN
    RAISE EXCEPTION 'the old resource_type enum survived; two vocabularies for one column';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='learning_resources'
       AND column_name='resource_type' AND column_default IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'resource_type has a default again';
  END IF;

  -- Exactly one policy per write verb, and the delete must name the uploader.
  SELECT count(*) INTO _n FROM pg_policy
   WHERE polrelid='public.learning_resources'::regclass AND polpermissive AND polcmd='a';
  IF _n <> 1 THEN RAISE EXCEPTION 'expected 1 INSERT policy, found %', _n; END IF;

  SELECT count(*) INTO _n FROM pg_policy
   WHERE polrelid='public.learning_resources'::regclass AND polpermissive AND polcmd='d';
  IF _n <> 1 THEN RAISE EXCEPTION 'expected 1 DELETE policy, found %', _n; END IF;

  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
       WHERE polrelid='public.learning_resources'::regclass AND polname='resources_delete')
     NOT ILIKE '%created_by = auth.uid()%' THEN
    RAISE EXCEPTION 'resources_delete does not restrict to the uploader';
  END IF;

  -- No FOR ALL policy may return: it would silently re-grant delete to every
  -- teacher of the class.
  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid='public.learning_resources'::regclass
                AND polpermissive AND polcmd='*') THEN
    RAISE EXCEPTION 'a permissive FOR ALL policy is back on learning_resources';
  END IF;

  -- admin must be absent from every write path.
  IF EXISTS (
    SELECT 1 FROM pg_policy
     WHERE polrelid='public.learning_resources'::regclass AND polpermissive
       AND polcmd IN ('a','w','d')
       AND (coalesce(pg_get_expr(polqual, polrelid),'') ILIKE '%''admin''%'
         OR coalesce(pg_get_expr(polwithcheck, polrelid),'') ILIKE '%''admin''%')
  ) THEN
    RAISE EXCEPTION 'admin is back on a resources write path';
  END IF;

  -- §10.11: no view tracking, of any kind, anywhere.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='learning_resources'
       AND column_name IN ('view_count','views','opened_at','last_viewed_at','open_count')
  ) THEN
    RAISE EXCEPTION 'a view-tracking column appeared on learning_resources';
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema='public'
       AND table_name IN ('resource_views','learning_resource_views','resource_opens')
  ) THEN
    RAISE EXCEPTION 'a view-tracking table appeared';
  END IF;

  -- Resources are hard-deleted; they must never acquire a trash column.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema='public' AND table_name='learning_resources'
       AND column_name IN ('deleted_at','deleted_by')
  ) THEN
    RAISE EXCEPTION '§10.11 says permanent deletion, but learning_resources has a soft-delete column';
  END IF;
END
$verify$;

COMMIT;
