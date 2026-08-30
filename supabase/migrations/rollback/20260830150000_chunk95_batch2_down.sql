-- ═══════════════════════════════════════════════════════════════════════════
-- REVERSE OF: 20260830150000_chunk95_batch2_no_caller.sql
--
-- Restores EXECUTE to anon and authenticated on the 44 functions batch 2
-- revoked. It does NOT restore the PUBLIC grant: PUBLIC was never the thing
-- carrying access here — 290 of the 305 held explicit grants — and putting it
-- back would re-open the surface more widely than it was.
--
-- Run this only to unblock a screen that turned out to need one of these. The
-- right end state is a narrower grant to the one role that needs it, not a
-- blanket restore, so treat this as a stopping point rather than a fix.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
     WHERE n.nspname='public'
       AND p.proname = ANY (ARRAY[
         'admin_connect_teacher_account','admin_link_user_to_student','admin_link_user_to_teacher',
         'admin_set_unique_role','ai_cosine_similarity','ai_kms_assert_staff','ai_lexical_overlap',
         'can_read_mark','can_read_test','chat_caller_role','chat_can_create_class_group','chat_dm_key',
         'current_auth_session_id','effective_role','get_chat_groups','get_teacher_directory',
         'get_user_role','membership_role_at','my_children_class_ids','my_children_student_ids',
         'my_class_teacher_class_ids','my_teacher_class_ids','normalize_phone',
         'progression_league_for_xp','progression_level_for_xp','progression_xp_for_level',
         'require_active_profile','rls_auto_enable','rpc_backfill_question_concepts',
         'rpc_close_homework','rpc_create_class_group','rpc_generate_battle','rpc_invite_member',
         'rpc_mark_group_messages_read','rpc_open_conversation','rpc_parent_child_snapshot',
         'rpc_record_concept_mistake','rpc_respond_to_invitation','rpc_send_direct_message',
         'rpc_send_group_message','rpc_student_improvement_plans','rpc_student_revision_queue',
         'super_admin_has_access','tg_homework_compute_is_late'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon, authenticated', r.sig);
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'batch 2 rollback: restored EXECUTE on % signature(s) to anon and authenticated.', _n;
END
$restore$;

COMMIT;
