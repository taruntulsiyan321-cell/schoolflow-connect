-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — resources read goes back to school-wide, delete back to class-bound
--
-- READ THIS BEFORE RUNNING IT. Running this file restores two measured defects:
--
--   - a student of any class can read a resource targeted at another class,
--     as long as it is published and in their school (probe9 measured this)
--   - a resource whose class has been deleted becomes editable and deletable
--     by nobody, because every write policy requires class_id IS NOT NULL
--
-- It also re-widens update from uploader-only back to any teacher of the class.
--
-- learning_resources holds 0 rows, so nothing is protected by the old policies
-- that is not equally protected by the new ones. There is no data reason to run
-- this, only a bisect reason.
--
-- Restores all three policies exactly as measured on 2026-09-04.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS resources_select ON public.learning_resources;
CREATE POLICY resources_select ON public.learning_resources
  FOR SELECT TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      is_published
      OR public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    )
  );
COMMENT ON POLICY resources_select ON public.learning_resources IS NULL;

DROP POLICY IF EXISTS resources_update ON public.learning_resources;
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
COMMENT ON POLICY resources_update ON public.learning_resources IS NULL;

DROP POLICY IF EXISTS resources_delete ON public.learning_resources;
CREATE POLICY resources_delete ON public.learning_resources
  FOR DELETE TO authenticated
  USING (
    public.same_school(school_id)
    AND public.has_role(auth.uid(), 'teacher'::public.app_role)
    AND created_by = auth.uid()
    AND class_id IS NOT NULL
    AND public.teacher_teaches_class(auth.uid(), class_id)
  );
COMMENT ON POLICY resources_delete ON public.learning_resources IS NULL;

DO $verify$
BEGIN
  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
       WHERE polrelid = 'public.learning_resources'::regclass AND polname = 'resources_select')
     ILIKE '%student_class_id%' THEN
    RAISE EXCEPTION 'resources_select was not restored to the school-wide form';
  END IF;
  IF (SELECT pg_get_expr(polqual, polrelid) FROM pg_policy
       WHERE polrelid = 'public.learning_resources'::regclass AND polname = 'resources_delete')
     NOT ILIKE '%teacher_teaches_class%' THEN
    RAISE EXCEPTION 'resources_delete was not restored';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations
 WHERE version = '20260905020000_resources_read_scope_and_orphan_delete';

COMMIT;
