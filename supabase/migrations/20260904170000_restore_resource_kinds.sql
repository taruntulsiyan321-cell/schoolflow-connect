-- ═══════════════════════════════════════════════════════════════════════════
-- REVERT — the resource kinds come back. The default does not.
--
-- 20260904140000 narrowed resource_type from seven kinds to ('pdf','image')
-- and removed its default. Two changes, one of them ruled and one of them not.
--
--   THE DEFECT was `link` as the DEFAULT: a form that omitted the field
--   produced a link, which §10.11 does not permit. Removing the default fixes
--   that completely.
--
--   THE NARROWING was not the defect and was not ruled. Deleting `video` and
--   `link` removed article URLs and videos as a CONCEPT, not just as a
--   default — a product decision taken inside a threshold-and-shape cleanup.
--
-- So: the kinds are restored, the default stays gone. The write/delete split
-- from 140000 (upload needs the teaching relationship, delete additionally
-- needs to be the uploader) is correct and is NOT touched here.
--
-- ── ONE JUDGEMENT CALL, FLAGGED ───────────────────────────────────────────
--
-- The restored enum is the original seven PLUS `image`.
--
-- `image` was never in the original enum, and §10.11 names it explicitly:
-- "Types: PDF/document and image only". Dropping it now would be a second
-- unruled narrowing — of a value that exists in production this minute — and
-- would leave a teacher uploading a PNG with no type but `other`.
--
-- If the intent was the original seven exactly, delete 'image' from the
-- CREATE TYPE below; it is one line and the table is empty, so nothing breaks.
-- Reported rather than assumed.
--
-- ── WHY A NEW TYPE RATHER THAN ALTER TYPE ADD VALUE ───────────────────────
--
-- The column is renamed back to the original type name `resource_type`, so the
-- schema reads as it did before 140000 rather than carrying
-- `resource_file_type` as a scar. ALTER TYPE ADD VALUE could not do that, and
-- a value added by it cannot be used in the same transaction.
--
-- learning_resources holds 0 rows, so the cast is free.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE _rows int;
BEGIN
  SELECT count(*) INTO _rows FROM public.learning_resources;
  IF _rows <> 0 THEN
    RAISE EXCEPTION
      'ABORT: learning_resources has % row(s); a widening cast is safe but this file has not been checked against real data',
      _rows;
  END IF;
  IF to_regtype('public.resource_file_type') IS NULL THEN
    RAISE EXCEPTION 'ABORT: resource_file_type does not exist; 20260904140000 was not applied';
  END IF;
END
$guard$;

CREATE TYPE public.resource_type AS ENUM
  ('pdf', 'image', 'video', 'link', 'notes', 'worksheet', 'presentation', 'other');

ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type TYPE public.resource_type
  USING resource_type::text::public.resource_type;

DROP TYPE public.resource_file_type;

-- Still NOT NULL, still no default. The default was the defect.
ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type SET NOT NULL;

COMMENT ON COLUMN public.learning_resources.resource_type IS
  'The kind of resource. NO DEFAULT, deliberately: this column previously '
  'defaulted to ''link'', so a form omitting the field produced a link, which '
  '§10.11 does not permit. The caller must say what it is uploading.';

-- ── Assert the outcome, not the statements ────────────────────────────────
DO $verify$
DECLARE _labels text; _dflt text;
BEGIN
  SELECT string_agg(enumlabel, ',' ORDER BY enumsortorder) INTO _labels
    FROM pg_enum WHERE enumtypid = 'public.resource_type'::regtype;

  -- Every original kind must be back. Named individually so a partial restore
  -- cannot pass by count alone.
  IF _labels NOT LIKE '%pdf%'          THEN RAISE EXCEPTION 'pdf missing';          END IF;
  IF _labels NOT LIKE '%video%'        THEN RAISE EXCEPTION 'video missing';        END IF;
  IF _labels NOT LIKE '%link%'         THEN RAISE EXCEPTION 'link missing';         END IF;
  IF _labels NOT LIKE '%notes%'        THEN RAISE EXCEPTION 'notes missing';        END IF;
  IF _labels NOT LIKE '%worksheet%'    THEN RAISE EXCEPTION 'worksheet missing';    END IF;
  IF _labels NOT LIKE '%presentation%' THEN RAISE EXCEPTION 'presentation missing'; END IF;
  IF _labels NOT LIKE '%other%'        THEN RAISE EXCEPTION 'other missing';        END IF;

  IF to_regtype('public.resource_file_type') IS NOT NULL THEN
    RAISE EXCEPTION 'the narrowed enum survived alongside the restored one';
  END IF;

  -- THE DEFECT MUST STAY FIXED. This is the whole point of the revert being
  -- partial: kinds back, default gone.
  SELECT column_default INTO _dflt FROM information_schema.columns
   WHERE table_schema='public' AND table_name='learning_resources'
     AND column_name='resource_type';
  IF _dflt IS NOT NULL THEN
    RAISE EXCEPTION 'resource_type has a default again: %', _dflt;
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema='public' AND table_name='learning_resources'
                AND column_name='resource_type' AND is_nullable='YES') THEN
    RAISE EXCEPTION 'resource_type became nullable';
  END IF;

  -- The 140000 write/delete split must survive this revert untouched.
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid='public.learning_resources'::regclass
                    AND polname='resources_delete') THEN
    RAISE EXCEPTION 'the uploader-only delete policy was lost';
  END IF;
  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
       WHERE polrelid='public.learning_resources'::regclass AND polname='resources_delete')
     NOT ILIKE '%created_by = auth.uid()%' THEN
    RAISE EXCEPTION 'resources_delete no longer restricts to the uploader';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_policy
              WHERE polrelid='public.learning_resources'::regclass
                AND polpermissive AND polcmd='*') THEN
    RAISE EXCEPTION 'a permissive FOR ALL policy is back on learning_resources';
  END IF;
END
$verify$;

COMMIT;
