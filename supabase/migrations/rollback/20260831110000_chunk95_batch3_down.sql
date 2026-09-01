-- ═══════════════════════════════════════════════════════════════════════════
-- REVERSE OF: 20260831110000_chunk95_batch3_anon.sql
--
-- Restores EXECUTE to `anon` on the 124 signatures batch 3 closed. It does NOT
-- restore the PUBLIC grant: PUBLIC was carrying anon's access on only one of the
-- 124, and putting it back would re-open the surface to every role at once
-- rather than to the one that turned out to need it.
--
-- Run this only to unblock a signed-out screen that turned out to call one of
-- these. The right end state is a grant to that ONE function, not a blanket
-- restore of all 124 — so treat this as a stopping point, and note which screen
-- broke before narrowing it back down.
--
-- rpc_recovery_session_plan(uuid) deliberately keeps the EXPLICIT authenticated
-- grant batch 3 gave it. Before batch 3 it held authenticated access only
-- through PUBLIC, which is a latent break, not a state worth returning to.
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

DO $restore$
DECLARE r record; _n int := 0;
BEGIN
  FOR r IN
    SELECT p.oid::regprocedure::text AS sig
      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
     WHERE n.nspname = 'public'
       AND p.proname = ANY (ARRAY[
         'active_membership_id','active_membership_school_id','admin_connect_student_account',
         'admin_connect_teacher_account','admin_revoke_student_account','admin_revoke_teacher_account',
         'admin_set_teacher_access','admin_set_unique_role','ai_analytics_summary_v1',
         'ai_benchmark_gate_passed','ai_kms_approve_version','ai_kms_complete_chunk_embed',
         'ai_kms_defer_unset_embeddings','ai_kms_enqueue_embedding_jobs','ai_kms_register_document',
         'ai_kms_reject_version','ai_kms_retrieve_chunks','ai_kms_submit_version',
         'ai_prompt_promote','ai_session_memory_append','ai_session_memory_close',
         'ai_session_memory_open','ai_session_memory_read','bump_ai_answer_cache_hit',
         'can_manage_homework','chat_attachment_url_allowed','chat_caller_role',
         'chat_can_create_class_group','chat_can_dm','effective_role',
         'emit_academic_event','ensure_default_role','get_user_role',
         'is_battle_participant','is_chat_participant','is_class_of_my_child',
         'is_my_child','is_my_student_record','match_ai_answer_cache',
         'match_question_bank','process_academic_event','process_pending_academic_events',
         'publish_due_scheduled_homework','rpc_academic_revision_plan','rpc_accept_battle_invite',
         'rpc_add_community_answer','rpc_apply_progression','rpc_assign_concept_recovery',
         'rpc_battle_curriculum','rpc_battle_feed','rpc_battle_monitor',
         'rpc_bulk_upsert_attendance','rpc_cache_agent_insight','rpc_challenge_student',
         'rpc_classmates','rpc_close_homework','rpc_complete_recovery_assignment',
         'rpc_complete_revision','rpc_compute_session_analytics','rpc_create_class_battle',
         'rpc_create_community_doubt','rpc_create_open_battle','rpc_create_quick_battle',
         'rpc_create_template_solo_battle','rpc_decision_engine_rollout_summary_v1',
         'rpc_ensure_battle_report','rpc_ensure_featured_battle','rpc_ensure_featured_battles_all',
         'rpc_finish_battle','rpc_finish_practice_session','rpc_generate_battle',
         'rpc_get_academic_brain','rpc_get_battle_report','rpc_get_cached_agent_insight',
         'rpc_get_concept_recovery_report','rpc_get_my_student_identity','rpc_get_recovery_assignment',
         'rpc_get_student_progression','rpc_invite_member','rpc_join_battle_by_code',
         'rpc_leaderboard','rpc_list_practice_history','rpc_mark_best_community_answer',
         'rpc_mirror_battle_answer','rpc_parent_child_snapshot','rpc_parent_concept_analytics',
         'rpc_parent_weekly_digest','rpc_pick_question_templates','rpc_post_assessment_concept_analysis',
         'rpc_principal_concept_analytics','rpc_principal_school_health','rpc_progression_leaderboard',
         'rpc_record_community_doubt_view','rpc_record_question_attempt','rpc_recovery_session_plan',
         'rpc_recovery_v2','rpc_refresh_academic_brain','rpc_refresh_featured_battles',
         'rpc_respond_to_invitation','rpc_revision_plan_v2','rpc_rotate_featured_battles',
         'rpc_save_battle_ai_insights','rpc_save_practice_session','rpc_set_featured_badges',
         'rpc_start_practice_session','rpc_student_academic_snapshot','rpc_student_concept_mastery',
         'rpc_student_performance_charts','rpc_student_recovery_zone','rpc_submit_battle_answer',
         'rpc_submit_recovery_answer','rpc_teacher_battle_reports','rpc_teacher_class_progression_insights',
         'rpc_teacher_concept_analytics','rpc_teacher_doubt_dashboard','rpc_toggle_question_bookmark',
         'rpc_vote_community_answer','rpc_vote_community_doubt','rpc_weak_areas_v2',
         'super_admin_has_access','teacher_teaches_class_subject','write_academic_audit'])
  LOOP
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', r.sig);
    _n := _n + 1;
  END LOOP;
  RAISE NOTICE 'batch 3 rollback: restored EXECUTE to anon on % signature(s). PUBLIC deliberately not restored.', _n;
END
$restore$;

COMMIT;
