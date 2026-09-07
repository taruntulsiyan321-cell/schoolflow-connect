-- Rollback for 20260911030000_activity_feed_hoist_role_test.sql
--
-- Restores the bare (un-hoisted) role test on the activity feed policies.
--
-- WHAT ROLLING BACK COSTS YOU. Who may read does not change; the cost does.
-- `has_role(auth.uid(), ...)` depends on nothing in the row, but written bare
-- in a policy qual PostgreSQL evaluates it during the scan, and each call runs
-- active_membership_id() and current_auth_session_id() underneath. On this
-- 9,134-row table, `ORDER BY created_at DESC LIMIT 6` for a caller who matches
-- nothing walks every row and returns
--   57014 canceling statement due to statement timeout
-- which is the 500 the /admin index showed a super admin.
BEGIN;

DROP POLICY IF EXISTS activity_feed_select ON public.school_activity_feed;
CREATE POLICY activity_feed_select ON public.school_activity_feed
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'teacher'::public.app_role)
    OR ((SELECT public.is_super_admin()) AND (SELECT public.super_admin_has_any_access()))
  )
);

DROP POLICY IF EXISTS activity_feed_select_family ON public.school_activity_feed;
CREATE POLICY activity_feed_select_family ON public.school_activity_feed
FOR SELECT
USING (
  (school_id IN (SELECT public.my_accessible_school_ids()))
  AND (
    public.has_role(auth.uid(), 'student'::public.app_role)
    OR public.has_role(auth.uid(), 'parent'::public.app_role)
  )
);

COMMIT;
