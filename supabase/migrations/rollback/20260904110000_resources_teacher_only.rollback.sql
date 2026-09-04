-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK — resources_manage back to role-only
--
-- Restores the policy exactly as measured before ruling 5:
--   same_school(school_id) AND (has_role(admin) OR has_role(teacher))
--
-- READ THIS BEFORE RUNNING IT. The forward migration closed a real hole: any
-- teacher in the school could write or DELETE a resource targeted at any class,
-- and admin could upload at all, both against §10.11. Rolling back reopens
-- both. learning_resources holds 0 rows, so nothing is protected by the old
-- policy that is not equally protected by the new one — there is no data
-- reason to run this, only a bisect reason.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DROP POLICY IF EXISTS resources_manage ON public.learning_resources;

CREATE POLICY resources_manage ON public.learning_resources
  FOR ALL TO authenticated
  USING (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    )
  )
  WITH CHECK (
    public.same_school(school_id)
    AND (
      public.has_role(auth.uid(), 'admin'::public.app_role)
      OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    )
  );

COMMENT ON POLICY resources_manage ON public.learning_resources IS NULL;

DO $verify$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy
                  WHERE polrelid = 'public.learning_resources'::regclass
                    AND polname = 'resources_manage') THEN
    RAISE EXCEPTION 'resources_manage was not restored';
  END IF;
END
$verify$;

DELETE FROM public.schema_migrations WHERE version = '20260904110000_resources_teacher_only';

COMMIT;
