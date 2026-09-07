-- Rollback for 20260911020000_activity_feed_fence_and_super_admin.sql
--
-- Restores the three policies to their `same_school(school_id)` form and drops
-- the super admin read branch.
--
-- WHAT ROLLING BACK COSTS YOU. `same_school(school_id)` is a function of the
-- ROW, so it is called once per row and cannot be answered from an index. For
-- any caller who matches nothing, `ORDER BY created_at DESC LIMIT 6` walks all
-- 9,134 rows calling four SECURITY DEFINER functions each, and the statement
-- timeout wins. Measured before the fix: the /admin index returned
-- 500 `57014 canceling statement due to statement timeout` for the super admin
-- while an admin got 200 — the admin escaped only because has_role matched and
-- the scan stopped after six rows.
--
-- It also re-closes the feed to a super admin holding a live, logged access
-- grant, which §10.20 says they may read.
--
-- Roll back only to restore the previous definitions deliberately.

BEGIN;

DROP POLICY IF EXISTS school_activity_feed_tenant_fence ON public.school_activity_feed;
CREATE POLICY school_activity_feed_tenant_fence ON public.school_activity_feed
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING ((school_id IS NULL) OR public.same_school(school_id))
WITH CHECK ((school_id IS NULL) OR public.same_school(school_id));

DROP POLICY IF EXISTS activity_feed_select ON public.school_activity_feed;
CREATE POLICY activity_feed_select ON public.school_activity_feed
FOR SELECT
USING (
  public.same_school(school_id)
  AND (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'principal'::public.app_role)
    OR public.has_role(auth.uid(), 'teacher'::public.app_role)
  )
);

DROP POLICY IF EXISTS activity_feed_select_family ON public.school_activity_feed;
CREATE POLICY activity_feed_select_family ON public.school_activity_feed
FOR SELECT
USING (
  public.same_school(school_id)
  AND (
    public.has_role(auth.uid(), 'student'::public.app_role)
    OR public.has_role(auth.uid(), 'parent'::public.app_role)
  )
);

COMMIT;

DO $verify$
DECLARE _sel text;
BEGIN
  SELECT pg_get_expr(p.polqual, p.polrelid) INTO _sel
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
   WHERE c.relname = 'school_activity_feed' AND p.polname = 'activity_feed_select';
  IF _sel IS NULL OR _sel !~ 'same_school' OR _sel ~ 'is_super_admin' THEN
    RAISE EXCEPTION 'ABORT: rollback did not restore the same_school policies';
  END IF;
  RAISE NOTICE 'same_school activity-feed policies restored (the 57014 timeout is back, as intended).';
END $verify$;
