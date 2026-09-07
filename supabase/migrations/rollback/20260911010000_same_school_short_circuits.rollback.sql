-- Rollback for 20260911010000_same_school_short_circuits.sql
--
-- Restores the unguarded form of same_school().
--
-- WHAT ROLLING BACK COSTS YOU. Row-level answers are identical either way —
-- NULL and false both exclude a row. What returns is the COST: for any caller
-- whose `get_my_school_id()` is NULL, `_school_id = NULL` is NULL rather than
-- false, the planner cannot fold the predicate, and every policy keyed on
-- `same_school` becomes a full scan calling `super_admin_has_access()` per row.
-- Measured before the fix: `GET /school_activity_feed` as the super admin
-- returned 500 `57014 canceling statement due to statement timeout`, while the
-- same request as an admin returned 200.
--
-- That state is not confined to super admins: any account with no membership,
-- no student/teacher/parent row and no `profiles.school_id` resolves NULL, and
-- 42 of 62 accounts hold no role.
--
-- Roll back only to restore the previous definition deliberately.

BEGIN;

CREATE OR REPLACE FUNCTION public.same_school(_school_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT _school_id IS NOT NULL
    AND (
      _school_id = public.get_my_school_id()
      OR public.super_admin_has_access(_school_id)
    )
$function$;

COMMENT ON FUNCTION public.same_school(uuid) IS
  'True when the caller may act in _school_id.';

COMMIT;

DO $verify$
DECLARE _fn text;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _fn
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'same_school';
  IF _fn IS NULL OR _fn ~ 'super_admin_has_any_access' THEN
    RAISE EXCEPTION 'ABORT: rollback did not restore the unguarded same_school';
  END IF;
  RAISE NOTICE 'unguarded same_school restored (full scans for school-less callers are back, as intended).';
END $verify$;
