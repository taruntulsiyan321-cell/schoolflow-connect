-- ═══════════════════════════════════════════════════════════════════════════
-- A read-only database role for CI, so three gates stop being blocked on a
-- credential that should never have been the answer.
--
-- ── What this replaces, and why the obvious fix was wrong ─────────────────
--
-- check:recovery-constants, check-pending-migrations and db:verify-integrity
-- all authenticate with SUPABASE_ACCESS_TOKEN against the Management API's
-- /database/query endpoint. The proposal was to put that token in GitHub
-- Actions secrets and turn all three on.
--
-- That token is a Supabase PERSONAL ACCESS TOKEN. It is account-wide, there is
-- no read-only variant of it, and /database/query executes arbitrary SQL as the
-- database owner. A token that can run the constants gate can also run
-- DROP TABLE students.
--
-- And quality.yml triggers on `pull_request`, where same-repo PRs DO receive
-- secrets. Any branch PR could add one line echoing the token to an external
-- host. The proposal would not have closed three gates; it would have opened a
-- path from any PR to production.
--
-- All three scripts run SELECT-only SQL. Verified rather than assumed: the
-- INSERT/DELETE strings in verify-database-integrity.mjs are assertion text and
-- policy names ("the attendance teacher write policy is INSERT-only"), not
-- statements. So a read-only role is sufficient, and unlike a PAT it is
-- enforced by the database rather than by trust.
--
-- ── Why BYPASSRLS on a READ-only role is not a contradiction ──────────────
--
-- pg_read_all_data grants SELECT everywhere but explicitly does NOT set
-- BYPASSRLS. Without it every policy applies to this role, and an integrity
-- assertion like "no finished participant retains a correct answer" would
-- return zero rows because the role cannot SEE the rows, not because none
-- exist. That is the failure mode this project has hit more than any other: a
-- check passing because it was not looking. BYPASSRLS here buys visibility, and
-- the role still cannot write anything.
--
-- ── The residual, measured rather than waved at ───────────────────────────
--
-- 305 of 441 functions in `public` are EXECUTE-able by PUBLIC, and 157 of those
-- are SECURITY DEFINER. PUBLIC grants apply to every role and Postgres has no
-- deny-grant, so this role inherits them and no GRANT written here can take
-- them away. If this credential leaked it could still CALL those functions,
-- some of which write.
--
-- That is a real limitation and it is stated rather than papered over. It is
-- also strictly smaller than the alternative: the PAT could run any SQL at all.
-- Closing it properly means REVOKE EXECUTE ON ALL FUNCTIONS FROM PUBLIC plus
-- explicit grants to anon/authenticated/service_role — a 305-function change
-- with app-wide blast radius that deserves its own chunk, not a footnote in
-- this one.
--
-- ── This role cannot log in yet, ON PURPOSE ───────────────────────────────
--
-- It is created NOLOGIN with no password. Setting a password is a step for a
-- human, not for this migration and not for Claude: a credential written into a
-- migration file is a credential in git history forever. To activate:
--
--   ALTER ROLE gurukul_ci_readonly WITH LOGIN PASSWORD '<generated>';
--
-- then put the connection string in the CI_READONLY_DATABASE_URL repository
-- secret. Until that happens this role exists and can do nothing, which is the
-- correct resting state.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $role$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gurukul_ci_readonly') THEN
    -- NOLOGIN and no password: see the header. BYPASSRLS so that a check
    -- returning zero rows means zero rows exist, not zero rows are visible.
    CREATE ROLE gurukul_ci_readonly NOLOGIN BYPASSRLS;
  ELSE
    -- Idempotent, but never silently: if the role already exists, force it back
    -- to the shape this file describes rather than trusting whatever it drifted
    -- into. NOLOGIN is NOT reasserted -- that would break an already-activated
    -- CI credential every time this migration replayed.
    ALTER ROLE gurukul_ci_readonly BYPASSRLS NOCREATEDB NOCREATEROLE NOSUPERUSER NOREPLICATION;
  END IF;
END
$role$;

GRANT CONNECT ON DATABASE postgres TO gurukul_ci_readonly;

-- pg_read_all_data covers SELECT on every table and USAGE on every schema,
-- including ones added later. Granting the predefined role rather than
-- enumerating GRANT SELECT ON ALL TABLES means a table created next month is
-- covered without anyone remembering to come back here -- the same reason the
-- deploy workflow derives its function list from disk instead of hardcoding it.
GRANT pg_read_all_data TO gurukul_ci_readonly;

-- Explicitly NOT granted, and each for a reason:
--   INSERT / UPDATE / DELETE / TRUNCATE  -- the entire point
--   CREATE on any schema                 -- no temp tables, no scratch objects
--   USAGE on sequences                   -- nextval() is a write
--   pg_write_all_data                    -- the mirror of what we do grant
-- No REVOKE is written for these because they were never granted; a REVOKE
-- here would read as though something had been taken away and invite someone
-- to "restore" it.

-- ── Prove the shape, in the same transaction that created it ──────────────
DO $verify$
DECLARE
  _r record;
  _can_read boolean;
  _can_write boolean;
BEGIN
  SELECT rolcanlogin, rolbypassrls, rolsuper, rolcreatedb, rolcreaterole
    INTO _r FROM pg_roles WHERE rolname = 'gurukul_ci_readonly';

  IF _r IS NULL THEN
    RAISE EXCEPTION 'gurukul_ci_readonly was not created';
  END IF;
  IF _r.rolsuper OR _r.rolcreatedb OR _r.rolcreaterole THEN
    RAISE EXCEPTION 'gurukul_ci_readonly has an attribute it must not have (super=% createdb=% createrole=%)',
      _r.rolsuper, _r.rolcreatedb, _r.rolcreaterole;
  END IF;
  IF NOT _r.rolbypassrls THEN
    RAISE EXCEPTION 'gurukul_ci_readonly lacks BYPASSRLS, so an empty result could not be told apart from an invisible one';
  END IF;

  -- Assert the OUTCOME on a real table, not the presence of a GRANT statement.
  -- has_table_privilege answers what the role can actually do.
  _can_read  := has_table_privilege('gurukul_ci_readonly', 'public.recovery_constants', 'SELECT');
  _can_write := has_table_privilege('gurukul_ci_readonly', 'public.recovery_constants', 'INSERT')
             OR has_table_privilege('gurukul_ci_readonly', 'public.recovery_constants', 'UPDATE')
             OR has_table_privilege('gurukul_ci_readonly', 'public.recovery_constants', 'DELETE');

  IF NOT _can_read THEN
    RAISE EXCEPTION 'gurukul_ci_readonly cannot SELECT recovery_constants — the gate it exists for would fail';
  END IF;
  IF _can_write THEN
    RAISE EXCEPTION 'gurukul_ci_readonly can WRITE recovery_constants — it is not read-only';
  END IF;

  -- And the same question asked of a table it has no business writing either.
  IF has_table_privilege('gurukul_ci_readonly', 'public.students', 'DELETE') THEN
    RAISE EXCEPTION 'gurukul_ci_readonly can DELETE students';
  END IF;
END
$verify$;

COMMIT;
