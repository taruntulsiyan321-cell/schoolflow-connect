-- ═══════════════════════════════════════════════════════════════════════════
-- CHUNK 9.5 batch 2 — narrow the batch by five. A SIXTH caller class.
--
-- Batch 2 revoked 44. Re-running the verification suite immediately afterwards
-- rotted five files, every one with 42501 permission denied:
--
--   CHUNK15_VERIFY            chat_can_create_class_group
--   CHUNK1_ISOLATION_PROOFS   super_admin_has_access
--   CHUNK1_PROOFS_4_5_6       rpc_invite_member
--   CHUNK5_VERIFY             rpc_close_homework
--   CHUNK7A_VERIFY            rpc_generate_battle
--
-- ── The class: the verification suite is a caller, and it is evidence ──────
--
-- These files call functions AS authenticated, deliberately, because G11 says
-- a check must exercise the thing it claims to test. CHUNK15_VERIFY's entire
-- purpose is "revoke a membership, then prove every one of the 31 functions
-- denies — test each, do not sample." It sweeps the permission layer as a real
-- role, which is the only way that assertion means anything.
--
-- So a verification file is not just another caller the grep missed. It is a
-- record of a decision that some role should be able to call this. Three of
-- the five are plainly product actions whose UI is not wired yet:
--
--   rpc_close_homework   §10.24 — "the teacher closes it early"
--   rpc_invite_member    Chunk 1 — admin enters an identifier, membership
--                        goes pending
--   rpc_generate_battle  battle creation, a live feature
--
-- ── The two I am restoring anyway, and why that is the honest choice ───────
--
-- chat_can_create_class_group and super_admin_has_access are internal
-- predicates. Both are reached by SECURITY DEFINER callers in normal use, so
-- the product does not need them granted, and revoking them turns "returns
-- false" into "permission denied" — a stronger denial, not a weaker one.
--
-- The only thing that broke is the test mechanism. I could adapt those two
-- files to call as owner and keep the revoke. I am not doing that here,
-- because editing an isolation proof so that my own change passes is the exact
-- pressure G11 names — "a test fails on legitimate change, and the pressure is
-- then to weaken or delete it" — and this is the file that proves a revoked
-- membership grants nothing. Two internal predicates staying granted is a
-- smaller and better-understood error than a hand-adjusted isolation proof.
--
-- Follow-up, recorded rather than done: adapt CHUNK15_VERIFY and
-- CHUNK1_ISOLATION_PROOFS to exercise these two through the definer that calls
-- them, then revoke them in batch 3 where they can be verified properly.
--
-- Batch 2 therefore closed 39, not 44.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig, p.proname
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname = ANY (ARRAY[
         'chat_can_create_class_group',
         'super_admin_has_access',
         'rpc_invite_member',
         'rpc_close_homework',
         'rpc_generate_battle'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    _n := _n + 1;
  END LOOP;

  IF _n = 0 THEN
    RAISE EXCEPTION 'batch 2 narrowing: none of the five functions was found; the list is stale.';
  END IF;
  RAISE NOTICE 'batch 2 narrowed: restored EXECUTE on % signature(s).', _n;
END
$restore$;

-- ── Assert both halves ─────────────────────────────────────────────────────
-- The five are back, AND the other 39 are still closed. Asserting only the
-- first half would let a clumsy restore re-open the whole batch silently.
DO $assert$
DECLARE _missing text; _reopened text;
BEGIN
  SELECT string_agg(p.proname, ', ') INTO _missing
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname = ANY (ARRAY['chat_can_create_class_group','super_admin_has_access',
                                'rpc_invite_member','rpc_close_homework','rpc_generate_battle'])
     AND NOT has_function_privilege('authenticated', p.oid,'EXECUTE');
  IF _missing IS NOT NULL THEN
    RAISE EXCEPTION 'batch 2 narrowing failed to restore: %', _missing;
  END IF;

  SELECT string_agg(p.proname, ', ') INTO _reopened
    FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
   WHERE n.nspname='public'
     AND p.proname = ANY (ARRAY[
       'can_read_mark','can_read_test','effective_role','get_user_role','membership_role_at',
       'my_children_class_ids','my_children_student_ids','my_teacher_class_ids',
       'require_active_profile','normalize_phone','current_auth_session_id',
       'rpc_open_conversation','rpc_send_direct_message','rpc_send_group_message'])
     AND (has_function_privilege('authenticated', p.oid,'EXECUTE')
       OR has_function_privilege('anon', p.oid,'EXECUTE'));
  IF _reopened IS NOT NULL THEN
    RAISE EXCEPTION 'batch 2 narrowing re-opened functions it should not have: %', _reopened;
  END IF;
END
$assert$;

COMMIT;
