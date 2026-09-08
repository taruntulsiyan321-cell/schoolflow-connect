-- ═══════════════════════════════════════════════════════════════════════════
-- Restore EXECUTE on rpc_test_questions_for_attempt — a DROP took it
--
-- ── WHAT HAPPENED ────────────────────────────────────────────────────────
--
-- `20260914060000` added a column to the function's RETURNS TABLE. Postgres
-- refuses that through `CREATE OR REPLACE` (42P13, "cannot change return type
-- of existing function"), so the migration did `DROP FUNCTION` first.
--
-- **A DROP takes the grants with it.** The recreated function came back with
-- default privileges, and Chunk 9.5 revokes EXECUTE from PUBLIC across this
-- schema — so `authenticated` had none, and every student sitting a test got
--
--     ERROR: permission denied for function rpc_test_questions_for_attempt
--
-- Caught by probe31/probe32 within minutes, because both carry a POSITIVE
-- control — "an all-MCQ paper still serves". Seven assertions failed at once
-- and every one of them was a positive control. A suite of denial tests would
-- have gone green on a function nobody could call.
--
-- This is the same lesson as the trash view that was unreadable by admins: in
-- a schema where EXECUTE is revoked by default, anything that recreates a
-- function must re-grant it in the same breath.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

REVOKE ALL ON FUNCTION public.rpc_test_questions_for_attempt(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rpc_test_questions_for_attempt(uuid)
  TO authenticated, service_role;

COMMIT;

DO $verify$
BEGIN
  IF NOT has_function_privilege('authenticated',
        'public.rpc_test_questions_for_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: authenticated still cannot sit a test';
  END IF;
  -- PUBLIC must NOT hold it: that is the schema-wide rule this migration is
  -- restoring compliance with, not just the one grant.
  IF has_function_privilege('public',
        'public.rpc_test_questions_for_attempt(uuid)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: PUBLIC holds EXECUTE on the attempt path';
  END IF;
  -- The neighbour that was NOT dropped, as a control: if this one lost its
  -- grant too, something wider is wrong than one DROP.
  IF NOT has_function_privilege('authenticated',
        'public.rpc_test_submit(uuid,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'ABORT: rpc_test_submit lost its grant as well';
  END IF;
  RAISE NOTICE 'the attempt path is callable by authenticated again.';
END $verify$;
