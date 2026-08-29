-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 7.5i — DROP + CREATE silently reset a revoked grant
--
-- 7.5c had to DROP and recreate both _bump_academic_activity overloads,
-- because its second parameter was named `_dpp` and Postgres cannot rename an
-- input parameter through CREATE OR REPLACE.
--
-- pg_get_functiondef() returns the DEFINITION. It does not return GRANTs. So
-- recreating from it produced functions with DEFAULT privileges — EXECUTE to
-- PUBLIC — on an internal helper that had been deliberately revoked from anon
-- and authenticated by 20260822180000_phase5_revoke_internal_helper_execute.
--
-- Caught by verify-database-integrity's standing assertion, "internal
-- data-forgery/leak helpers are no longer callable by anon or authenticated",
-- which is exactly the kind of invariant that only earns its keep on a day
-- like this. Live for the length of one migration.
--
-- The general lesson, which is G15's shape at one remove: a construct whose
-- precondition is absent fails open. Here the absent precondition was that
-- pg_get_functiondef carries the whole story about a function. It does not —
-- grants, comments and ownership all live elsewhere. **Any DROP + CREATE of an
-- existing function must restore its grants explicitly.**
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public._bump_academic_activity(uuid, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public._bump_academic_activity(uuid, integer, integer, integer, integer, integer)
  FROM PUBLIC, anon, authenticated;

DO $assert$
DECLARE _bad text;
BEGIN
  SELECT string_agg(p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', ', ')
    INTO _bad
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = '_bump_academic_activity'
     AND (has_function_privilege('anon', p.oid, 'EXECUTE')
       OR has_function_privilege('authenticated', p.oid, 'EXECUTE'));
  IF _bad IS NOT NULL THEN
    RAISE EXCEPTION 'still callable by anon or authenticated: %', _bad;
  END IF;
END
$assert$;

COMMIT;
