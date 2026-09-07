-- Rollback for 20260911000000_super_admin_needs_a_grant.sql
--
-- Restores the unguarded `profiles.school_id` fallback in get_my_school_id().
--
-- WHAT ROLLING BACK COSTS YOU. It reopens the path §10.20 says does not exist.
-- A super admin whose `profiles.school_id` names a school reaches that school's
-- academic data again with NO access-log row, no notification to the school and
-- no expiry — "unlogged super admin access", which the spec calls out as the
-- single largest concentration of risk in the system. The seeded
-- `superadmin@wisdomcampus.com` has exactly that column set and zero grants, so
-- the hole is open the moment this runs.
--
-- If the intent is to give a super admin access to a school, do NOT roll back:
-- call `rpc_super_admin_open_access(school_id, what_was_accessed, reason,
-- minutes)`. That is the supported path, it writes the log row the spec
-- requires, and it expires on its own.
--
-- The client half (`assertCanConsume` admitting super_admin for reads) is
-- independent of this file and is not reverted here. Left alone, it is
-- harmless: without a grant the queries simply return no rows.

BEGIN;

CREATE OR REPLACE FUNCTION public.get_my_school_id()
RETURNS uuid
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT COALESCE(
    public.active_membership_school_id(),
    (SELECT s.school_id FROM public.students s
      WHERE s.user_id = auth.uid() AND s.school_id IS NOT NULL LIMIT 1),
    (SELECT t.school_id FROM public.teachers t
      WHERE t.user_id = auth.uid() AND t.school_id IS NOT NULL LIMIT 1),
    (SELECT pa.school_id FROM public.parents pa
      WHERE pa.user_id = auth.uid() AND pa.school_id IS NOT NULL LIMIT 1),
    (SELECT p.school_id FROM public.profiles p WHERE p.id = auth.uid())
  )
$function$;

COMMENT ON FUNCTION public.get_my_school_id() IS
  'The caller''s own school.';

COMMIT;

DO $verify$
DECLARE _fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'get_my_school_id';
  IF _fn IS NULL OR _fn ~ 'is_super_admin' THEN
    RAISE EXCEPTION 'ABORT: rollback did not restore the unguarded fallback';
  END IF;
  RAISE NOTICE 'the unguarded profiles fallback is back (ungranted super admin access reopened, as intended).';
END $verify$;
