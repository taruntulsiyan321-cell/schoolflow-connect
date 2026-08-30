-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260830140000_chunk95_default_privileges_fix.sql
--
-- Restores the built-in default: functions created by `postgres` are once again
-- EXECUTE-able by PUBLIC on creation.
--
-- WHAT THIS REOPENS, and it is the slow kind. Nothing breaks the moment this
-- runs. Instead, the next migration that creates a function ships it
-- PUBLIC-executable, and so does the one after that. The surface this chunk
-- exists to close starts regrowing immediately and silently, and the only
-- signal is scripts/report-public-execute.mjs counting higher next time
-- somebody runs it.
--
-- The reason to run this: a migration or tool that legitimately relies on new
-- functions being reachable without an explicit grant, discovered after the
-- fact. The better fix in that case is an explicit GRANT in that migration —
-- one line, in the place that needs it — rather than turning the default back
-- on for everything.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

ALTER DEFAULT PRIVILEGES FOR ROLE postgres GRANT EXECUTE ON FUNCTIONS TO PUBLIC;

-- Prove the restore on a real function rather than trusting pg_default_acl.
-- That catalog is exactly what read "correct" while the behaviour was wrong in
-- the forward migration, so it is not evidence here either.
DO $verify$
DECLARE _pub boolean;
BEGIN
  EXECUTE 'CREATE FUNCTION public._chunk95_rollback_probe() RETURNS int LANGUAGE sql IMMUTABLE AS $f$ SELECT 1 $f$';
  _pub := has_function_privilege('public', 'public._chunk95_rollback_probe()'::regprocedure, 'EXECUTE');
  EXECUTE 'DROP FUNCTION public._chunk95_rollback_probe()';
  IF NOT _pub THEN
    RAISE EXCEPTION 'rollback did not restore the PUBLIC default — a new function is still not executable by PUBLIC';
  END IF;
END
$verify$;

COMMIT;
