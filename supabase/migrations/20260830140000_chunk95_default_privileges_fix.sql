-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 — the default-privileges step, in the form that actually works
--
-- Batch 1 ran the step exactly as the chunk specifies it:
--
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
--
-- It did not work, and it did not look like it had failed. pg_default_acl
-- afterwards read `postgres=X/postgres | service_role=X/postgres` — PUBLIC
-- absent, exactly as intended — while a function created one statement later
-- still came out with `=X/postgres`, which is PUBLIC holding EXECUTE.
-- Verification item 5 caught it; nothing else would have.
--
-- ── Why ───────────────────────────────────────────────────────────────────
--
-- Default privileges come in two kinds and they are COMBINED, not overridden:
--
--   ALTER DEFAULT PRIVILEGES ...                  -> the global default
--   ALTER DEFAULT PRIVILEGES ... IN SCHEMA public -> an ADDITIONAL per-schema
--                                                    default
--
-- The privileges a new object receives are the union of the two. The built-in
-- `EXECUTE TO PUBLIC` grant on functions belongs to the GLOBAL default, so
-- revoking it inside a schema removes something that schema never granted and
-- leaves the global grant untouched. Measured, not reasoned: the same probe
-- with the global form produced `postgres=X/postgres | service_role=X/postgres`
-- and has_function_privilege('public', ...) = false.
--
-- This matters beyond this migration. The chunk's step 4 says "without this the
-- surface regrows with every migration" — and the form it specifies would have
-- left the surface regrowing while pg_default_acl looked correct. Every new
-- function shipped after that would have been PUBLIC-executable again, and the
-- audit would have said the default was set.
--
-- ── Scope, stated because it is wider than the schema-scoped form ─────────
--
-- FOR ROLE postgres with no IN SCHEMA covers every schema, not just `public`.
-- That is the point — it is where the built-in grant lives — but it does mean
-- functions postgres creates anywhere are no longer PUBLIC-executable by
-- default. Supabase's own objects in `extensions`, `storage`, `auth` and so on
-- are owned by supabase_admin, whose separate default ACL row is untouched
-- here, so they are unaffected.
--
-- anon and authenticated need no global revoke: the postgres default ACL row
-- grants EXECUTE only to postgres and service_role, so a new function does not
-- reach them either. Verified rather than assumed, in the assertion below.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- ── Prove it on a real new function, then remove it ───────────────────────
-- Asserting pg_default_acl here would repeat the exact mistake this migration
-- exists to fix: that catalog looked right while the behaviour was wrong. The
-- only trustworthy check is to create a function and ask what it got.
DO $verify$
DECLARE
  _pub  boolean;
  _auth boolean;
  _anon boolean;
  _acl  text;
BEGIN
  EXECUTE 'CREATE FUNCTION public._chunk95_default_probe() RETURNS int LANGUAGE sql IMMUTABLE AS $f$ SELECT 1 $f$';

  SELECT coalesce(array_to_string(proacl, ' | '), '(NULL acl — built-in default, PUBLIC gets EXECUTE)')
    INTO _acl FROM pg_proc WHERE oid = 'public._chunk95_default_probe()'::regprocedure;
  _pub  := has_function_privilege('public',        'public._chunk95_default_probe()'::regprocedure, 'EXECUTE');
  _auth := has_function_privilege('authenticated', 'public._chunk95_default_probe()'::regprocedure, 'EXECUTE');
  _anon := has_function_privilege('anon',          'public._chunk95_default_probe()'::regprocedure, 'EXECUTE');

  EXECUTE 'DROP FUNCTION public._chunk95_default_probe()';

  IF _pub OR _auth OR _anon THEN
    RAISE EXCEPTION
      'a newly created function is STILL reachable (public=%, authenticated=%, anon=%). acl was [%]',
      _pub, _auth, _anon, _acl;
  END IF;

  RAISE NOTICE 'new functions now get acl [%] — not reachable by PUBLIC, anon or authenticated', _acl;
END
$verify$;

COMMIT;
