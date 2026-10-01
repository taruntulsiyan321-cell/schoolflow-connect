-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK: students and parents read the school's activity feed again
--
-- Recreates activity_feed_select_family exactly as it was. Note what you are
-- restoring: every student and parent of a school reads every feed row of it,
-- classmates' marks and attendance included (KNOWN_ISSUES 61). Redeploy the
-- app from before 20261134000000 too, or students receive no feed changes.
--
-- Undoes: 20261134000000_the_school_feed_is_for_staff.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE POLICY activity_feed_select_family ON public.school_activity_feed
  FOR SELECT TO public
  USING (
    (school_id IN (SELECT public.my_accessible_school_ids() AS my_accessible_school_ids))
    AND (SELECT (public.has_role(auth.uid(), 'student'::public.app_role)
              OR public.has_role(auth.uid(), 'parent'::public.app_role)))
  );

DELETE FROM public.schema_migrations WHERE version = '20261134000000_the_school_feed_is_for_staff';

COMMIT;
