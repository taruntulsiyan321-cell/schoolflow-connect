-- ═══════════════════════════════════════════════════════════════════════════
-- ROLLBACK for 20260830110000_ci_readonly_role.sql
--
-- Order matters: a role cannot be dropped while it still holds privileges, and
-- DROP ROLE's error message names only the database, not what is held. Revoke
-- first, then drop.
--
-- This is destructive in one direction that matters: if the role has been
-- activated with a password and CI is using it, dropping it breaks three gates
-- immediately. That is the correct behaviour for a rollback of this file -- it
-- is not meant to be run casually -- but it is worth saying out loud, because
-- "rollback" reads as harmless and this one is not.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $down$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gurukul_ci_readonly') THEN
    RAISE NOTICE 'gurukul_ci_readonly does not exist; nothing to roll back';
    RETURN;
  END IF;

  REVOKE pg_read_all_data FROM gurukul_ci_readonly;
  REVOKE CONNECT ON DATABASE postgres FROM gurukul_ci_readonly;

  -- Anything granted outside this migration would block the DROP. Surface it
  -- rather than letting DROP ROLE fail with a message that does not say what.
  IF EXISTS (
    SELECT 1 FROM pg_shdepend d
     WHERE d.refobjid = (SELECT oid FROM pg_roles WHERE rolname = 'gurukul_ci_readonly')
  ) THEN
    RAISE EXCEPTION
      'gurukul_ci_readonly still holds privileges granted outside this migration; '
      'run REASSIGN OWNED / DROP OWNED deliberately rather than having this file guess';
  END IF;

  DROP ROLE gurukul_ci_readonly;
END
$down$;

DO $guard$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gurukul_ci_readonly') THEN
    RAISE EXCEPTION 'rollback did not drop gurukul_ci_readonly';
  END IF;
END
$guard$;

COMMIT;
