-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — narrow the resource kinds back to ('pdf','image')
--
-- Undoes the revert, returning to the 140000 shape. It does NOT restore the
-- 'link' DEFAULT — that was the actual defect and neither file wants it back.
--
-- Fails deliberately if any row uses a kind the narrow enum does not have,
-- rather than silently rewriting somebody's file type.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $guard$
DECLARE _bad int;
BEGIN
  SELECT count(*) INTO _bad FROM public.learning_resources
   WHERE resource_type::text NOT IN ('pdf','image');
  IF _bad <> 0 THEN
    RAISE EXCEPTION
      'ABORT: % resource(s) use a kind outside (pdf,image); narrowing would rewrite them', _bad;
  END IF;
END
$guard$;

CREATE TYPE public.resource_file_type AS ENUM ('pdf', 'image');
ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type TYPE public.resource_file_type
  USING resource_type::text::public.resource_file_type;
DROP TYPE public.resource_type;

DO $verify$
BEGIN
  IF to_regtype('public.resource_file_type') IS NULL THEN
    RAISE EXCEPTION 'the narrow enum was not created';
  END IF;
  IF (SELECT column_default FROM information_schema.columns
       WHERE table_schema='public' AND table_name='learning_resources'
         AND column_name='resource_type') IS NOT NULL THEN
    RAISE EXCEPTION 'a default came back; that was the defect';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations WHERE version = '20260904170000_restore_resource_kinds';

COMMIT;
