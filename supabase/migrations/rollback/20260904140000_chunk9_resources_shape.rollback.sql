-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — restore the seven-value resource enum and the FOR ALL policy
--
-- Puts back the enum that offered video, link, notes, worksheet, presentation
-- and other — five kinds §10.11 does not permit — with 'link' as the DEFAULT,
-- and collapses the three write policies back into one FOR ALL, which returns
-- delete on a colleague's upload to every teacher of the class.
--
-- Safe only while learning_resources is empty. If a row has been uploaded with
-- resource_type 'image', that value does not exist in the restored enum and
-- the cast below will fail — deliberately, rather than silently rewriting
-- somebody's file type.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TYPE public.resource_type AS ENUM
  ('pdf', 'video', 'link', 'notes', 'worksheet', 'presentation', 'other');

ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type DROP NOT NULL;
ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type TYPE public.resource_type
  USING resource_type::text::public.resource_type;
ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type SET DEFAULT 'link'::public.resource_type;
ALTER TABLE public.learning_resources
  ALTER COLUMN resource_type SET NOT NULL;

DROP TYPE public.resource_file_type;

DROP POLICY IF EXISTS resources_write  ON public.learning_resources;
DROP POLICY IF EXISTS resources_update ON public.learning_resources;
DROP POLICY IF EXISTS resources_delete ON public.learning_resources;

CREATE POLICY resources_manage ON public.learning_resources
  FOR ALL TO authenticated
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

DO $verify$
BEGIN
  IF to_regtype('public.resource_type') IS NULL THEN
    RAISE EXCEPTION 'the old enum was not restored';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid='public.learning_resources'::regclass
                    AND polname='resources_manage') THEN
    RAISE EXCEPTION 'resources_manage was not restored';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations WHERE version = '20260904140000_chunk9_resources_shape';

COMMIT;
