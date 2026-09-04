-- ═══════════════════════════════════════════════════════════════════════════
-- The trash view was unreadable by everyone it was built for
--
-- 20260904130000 created `trash` as a security_invoker view whose columns call
-- public.trash_retention_days(). security_invoker means the CALLER'S rights are
-- used — which is the whole point, because it inherits the admin-only hiding
-- policies instead of inventing a second access path.
--
-- But Chunk 9.5 set ALTER DEFAULT PRIVILEGES to revoke EXECUTE from PUBLIC on
-- new functions. So trash_retention_days was created reachable by postgres and
-- service_role and nobody else, and an admin selecting from `trash` got
--
--     ERROR: 42501: permission denied for function trash_retention_days
--
-- G13 exactly, and from the direction that keeps catching this codebase:
-- reachability for a function is decided by the GRANT, not by the policy on
-- the table it reads.
--
-- WHY THE MIGRATION'S OWN VERIFICATION MISSED IT
--
-- The DO block asserted the view existed, was a view, and was security_invoker.
-- All true. It ran as the migration role, which HAS execute, so the one thing
-- that was broken was the one thing a check running as postgres cannot see.
-- A privilege check that never assumes the caller's privileges is not a check.
-- The assertion below tests has_function_privilege('authenticated', ...), and
-- the negative case for the purge job as well, so this cannot regress in
-- either direction.
--
-- Granting is safe: trash_retention_days is IMMUTABLE and returns one of
-- 7, 30 or NULL for a text label. It reads no table and leaks nothing.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

GRANT EXECUTE ON FUNCTION public.trash_retention_days(text) TO authenticated;

DO $verify$
BEGIN
  IF NOT has_function_privilege('authenticated',
        'public.trash_retention_days(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated still cannot execute trash_retention_days; the trash view stays unreadable';
  END IF;

  -- The restore is admin-gated inside its body, so authenticated needs EXECUTE.
  IF NOT has_function_privilege('authenticated',
        'public.rpc_restore_from_trash(text, uuid)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated cannot execute rpc_restore_from_trash; no admin could restore';
  END IF;

  -- The purge deletes across institutions and must NOT become reachable.
  IF has_function_privilege('authenticated',
        'public.rpc_purge_expired()'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'authenticated can execute rpc_purge_expired';
  END IF;
  IF has_function_privilege('anon',
        'public.trash_retention_days(text)'::regprocedure, 'EXECUTE') THEN
    RAISE EXCEPTION 'anon gained execute on trash_retention_days';
  END IF;
END
$verify$;

COMMIT;
