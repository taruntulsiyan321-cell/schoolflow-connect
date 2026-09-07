-- Rollback for 20260912000000_tenant_fences_use_the_indexable_set.sql
--
-- Restores all 71 tenant fences to `same_school(school_id)`.
--
-- Generated from the same source as the forward migration
-- (`node scripts/gen-tenant-fence-migration.mjs --rollback`), captured BEFORE
-- the conversion ran, so these are the definitions that were live -- not a
-- reconstruction of what they were assumed to be.
--
-- WHAT ROLLING BACK COSTS YOU. Which rows each fence admits does not change;
-- what returns is the cost of deciding. `same_school(school_id)` is a function
-- OF THE ROW, so it cannot be folded or answered from an index, it is called
-- once per row, and each call runs get_my_school_id() ->
-- active_membership_school_id() -> active_membership_id() ->
-- current_auth_session_id(). Being SECURITY DEFINER it is never inlined, so
-- there is no way to make it cheap from the inside.
--
-- For any caller who matches nothing there is no early exit and the whole table
-- is walked. Measured before the conversion:
--
--   academic_audit     (9,166 rows)  ->  500 57014 statement timeout, 8.5s
--   student_enrolments   (223 rows)  ->  200 in 949ms
--
-- and 42 of 62 accounts hold no role, so "matches nothing" is not a rare state.
-- An admin escapes it only because they match on the first row and LIMIT stops
-- the scan.
--
-- Roll back only to restore the previous definitions deliberately.

BEGIN;

DROP POLICY IF EXISTS academic_agent_cache_tenant_fence ON public.academic_agent_cache;
CREATE POLICY academic_agent_cache_tenant_fence ON public.academic_agent_cache
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS academic_audit_tenant_fence ON public.academic_audit;
CREATE POLICY academic_audit_tenant_fence ON public.academic_audit
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS academic_daily_activity_tenant_fence ON public.academic_daily_activity;
CREATE POLICY academic_daily_activity_tenant_fence ON public.academic_daily_activity
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS academic_terms_tenant_fence ON public.academic_terms;
CREATE POLICY academic_terms_tenant_fence ON public.academic_terms
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS academic_years_tenant_fence ON public.academic_years;
CREATE POLICY academic_years_tenant_fence ON public.academic_years
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS admission_enquiries_tenant_fence ON public.admission_enquiries;
CREATE POLICY admission_enquiries_tenant_fence ON public.admission_enquiries
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_answer_cache_tenant_fence ON public.ai_answer_cache;
CREATE POLICY ai_answer_cache_tenant_fence ON public.ai_answer_cache
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_budget_quotas_tenant_fence ON public.ai_budget_quotas;
CREATE POLICY ai_budget_quotas_tenant_fence ON public.ai_budget_quotas
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_budget_usage_tenant_fence ON public.ai_budget_usage;
CREATE POLICY ai_budget_usage_tenant_fence ON public.ai_budget_usage
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_embedding_jobs_tenant_fence ON public.ai_embedding_jobs;
CREATE POLICY ai_embedding_jobs_tenant_fence ON public.ai_embedding_jobs
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_explanations_tenant_fence ON public.ai_explanations;
CREATE POLICY ai_explanations_tenant_fence ON public.ai_explanations
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_feature_flags_tenant_fence ON public.ai_feature_flags;
CREATE POLICY ai_feature_flags_tenant_fence ON public.ai_feature_flags
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_feedback_signals_tenant_fence ON public.ai_feedback_signals;
CREATE POLICY ai_feedback_signals_tenant_fence ON public.ai_feedback_signals
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_kms_documents_tenant_fence ON public.ai_kms_documents;
CREATE POLICY ai_kms_documents_tenant_fence ON public.ai_kms_documents
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_request_decisions_tenant_fence ON public.ai_request_decisions;
CREATE POLICY ai_request_decisions_tenant_fence ON public.ai_request_decisions
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_session_memory_tenant_fence ON public.ai_session_memory;
CREATE POLICY ai_session_memory_tenant_fence ON public.ai_session_memory
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS ai_solution_cache_tenant_fence ON public.ai_solution_cache;
CREATE POLICY ai_solution_cache_tenant_fence ON public.ai_solution_cache
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS app_settings_tenant_fence ON public.app_settings;
CREATE POLICY app_settings_tenant_fence ON public.app_settings
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS approval_requests_tenant_fence ON public.approval_requests;
CREATE POLICY approval_requests_tenant_fence ON public.approval_requests
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS battle_answers_tenant_fence ON public.battle_answers;
CREATE POLICY battle_answers_tenant_fence ON public.battle_answers
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS battle_events_tenant_fence ON public.battle_events;
CREATE POLICY battle_events_tenant_fence ON public.battle_events
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS battle_invites_tenant_fence ON public.battle_invites;
CREATE POLICY battle_invites_tenant_fence ON public.battle_invites
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS battle_participants_tenant_fence ON public.battle_participants;
CREATE POLICY battle_participants_tenant_fence ON public.battle_participants
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS battle_questions_tenant_fence ON public.battle_questions;
CREATE POLICY battle_questions_tenant_fence ON public.battle_questions
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS battle_reports_tenant_fence ON public.battle_reports;
CREATE POLICY battle_reports_tenant_fence ON public.battle_reports
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS battles_tenant_fence ON public.battles;
CREATE POLICY battles_tenant_fence ON public.battles
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS chat_conversations_tenant_fence ON public.chat_conversations;
CREATE POLICY chat_conversations_tenant_fence ON public.chat_conversations
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS chat_participants_tenant_fence ON public.chat_participants;
CREATE POLICY chat_participants_tenant_fence ON public.chat_participants
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS class_groups_tenant_fence ON public.class_groups;
CREATE POLICY class_groups_tenant_fence ON public.class_groups
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS class_timetables_tenant_fence ON public.class_timetables;
CREATE POLICY class_timetables_tenant_fence ON public.class_timetables
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS classes_tenant_fence ON public.classes;
CREATE POLICY classes_tenant_fence ON public.classes
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS community_doubt_answer_attachments_tenant_fence ON public.community_doubt_answer_attachments;
CREATE POLICY community_doubt_answer_attachments_tenant_fence ON public.community_doubt_answer_attachments
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS community_doubt_answers_tenant_fence ON public.community_doubt_answers;
CREATE POLICY community_doubt_answers_tenant_fence ON public.community_doubt_answers
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS community_doubt_attachments_tenant_fence ON public.community_doubt_attachments;
CREATE POLICY community_doubt_attachments_tenant_fence ON public.community_doubt_attachments
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS community_doubt_views_tenant_fence ON public.community_doubt_views;
CREATE POLICY community_doubt_views_tenant_fence ON public.community_doubt_views
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS community_doubt_votes_tenant_fence ON public.community_doubt_votes;
CREATE POLICY community_doubt_votes_tenant_fence ON public.community_doubt_votes
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS community_doubts_tenant_fence ON public.community_doubts;
CREATE POLICY community_doubts_tenant_fence ON public.community_doubts
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS community_reputation_tenant_fence ON public.community_reputation;
CREATE POLICY community_reputation_tenant_fence ON public.community_reputation
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS device_tokens_tenant_fence ON public.device_tokens;
CREATE POLICY device_tokens_tenant_fence ON public.device_tokens
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS fees_tenant_fence ON public.fees;
CREATE POLICY fees_tenant_fence ON public.fees
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS homework_tenant_fence ON public.homework;
CREATE POLICY homework_tenant_fence ON public.homework
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS homework_answers_tenant_fence ON public.homework_answers;
CREATE POLICY homework_answers_tenant_fence ON public.homework_answers
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS homework_completions_tenant_fence ON public.homework_completions;
CREATE POLICY homework_completions_tenant_fence ON public.homework_completions
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS homework_questions_tenant_fence ON public.homework_questions;
CREATE POLICY homework_questions_tenant_fence ON public.homework_questions
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS homework_submissions_tenant_fence ON public.homework_submissions;
CREATE POLICY homework_submissions_tenant_fence ON public.homework_submissions
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS learning_resources_tenant_fence ON public.learning_resources;
CREATE POLICY learning_resources_tenant_fence ON public.learning_resources
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS leave_decisions_tenant_fence ON public.leave_decisions;
CREATE POLICY leave_decisions_tenant_fence ON public.leave_decisions
AS RESTRICTIVE
FOR ALL
TO PUBLIC
USING (same_school(school_id));

DROP POLICY IF EXISTS leave_requests_tenant_fence ON public.leave_requests;
CREATE POLICY leave_requests_tenant_fence ON public.leave_requests
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS message_attachments_tenant_fence ON public.message_attachments;
CREATE POLICY message_attachments_tenant_fence ON public.message_attachments
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (same_school(school_id))
WITH CHECK (same_school(school_id));

DROP POLICY IF EXISTS messages_tenant_fence ON public.messages;
CREATE POLICY messages_tenant_fence ON public.messages
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS parent_students_tenant_fence ON public.parent_students;
CREATE POLICY parent_students_tenant_fence ON public.parent_students
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS parents_tenant_fence ON public.parents;
CREATE POLICY parents_tenant_fence ON public.parents
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS progression_history_tenant_fence ON public.progression_history;
CREATE POLICY progression_history_tenant_fence ON public.progression_history
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS progression_league_history_tenant_fence ON public.progression_league_history;
CREATE POLICY progression_league_history_tenant_fence ON public.progression_league_history
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS question_templates_tenant_fence ON public.question_templates;
CREATE POLICY question_templates_tenant_fence ON public.question_templates
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS recovery_assignment_questions_tenant_fence ON public.recovery_assignment_questions;
CREATE POLICY recovery_assignment_questions_tenant_fence ON public.recovery_assignment_questions
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS recovery_assignments_tenant_fence ON public.recovery_assignments;
CREATE POLICY recovery_assignments_tenant_fence ON public.recovery_assignments
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS school_calendar_events_tenant_fence ON public.school_calendar_events;
CREATE POLICY school_calendar_events_tenant_fence ON public.school_calendar_events
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS school_complaints_tenant_fence ON public.school_complaints;
CREATE POLICY school_complaints_tenant_fence ON public.school_complaints
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS section_subjects_tenant_fence ON public.section_subjects;
CREATE POLICY section_subjects_tenant_fence ON public.section_subjects
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS student_academic_brain_tenant_fence ON public.student_academic_brain;
CREATE POLICY student_academic_brain_tenant_fence ON public.student_academic_brain
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS student_badges_tenant_fence ON public.student_badges;
CREATE POLICY student_badges_tenant_fence ON public.student_badges
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS student_enrolments_tenant_fence ON public.student_enrolments;
CREATE POLICY student_enrolments_tenant_fence ON public.student_enrolments
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS student_improvement_plans_tenant_fence ON public.student_improvement_plans;
CREATE POLICY student_improvement_plans_tenant_fence ON public.student_improvement_plans
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS student_xp_tenant_fence ON public.student_xp;
CREATE POLICY student_xp_tenant_fence ON public.student_xp
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS subjects_tenant_fence ON public.subjects;
CREATE POLICY subjects_tenant_fence ON public.subjects
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS teacher_assignments_tenant_fence ON public.teacher_assignments;
CREATE POLICY teacher_assignments_tenant_fence ON public.teacher_assignments
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS teacher_classes_tenant_fence ON public.teacher_classes;
CREATE POLICY teacher_classes_tenant_fence ON public.teacher_classes
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS teacher_remarks_tenant_fence ON public.teacher_remarks;
CREATE POLICY teacher_remarks_tenant_fence ON public.teacher_remarks
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS teachers_tenant_fence ON public.teachers;
CREATE POLICY teachers_tenant_fence ON public.teachers
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

DROP POLICY IF EXISTS timetable_slots_tenant_fence ON public.timetable_slots;
CREATE POLICY timetable_slots_tenant_fence ON public.timetable_slots
AS RESTRICTIVE
FOR ALL
TO authenticated, anon
USING (((school_id IS NULL) OR same_school(school_id)))
WITH CHECK (((school_id IS NULL) OR same_school(school_id)));

COMMIT;

DO $verify$
DECLARE _left int;
BEGIN
  SELECT count(*) INTO _left
    FROM pg_policy p JOIN pg_class c ON c.oid = p.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public' AND p.polname LIKE '%tenant_fence%'
     AND pg_get_expr(p.polqual, p.polrelid) LIKE '%same_school%';
  IF _left < 71 THEN
    RAISE EXCEPTION 'ABORT: rollback restored only % same_school fences, expected 71', _left;
  END IF;
  RAISE NOTICE '71 tenant fences restored to same_school (the full scans are back, as intended).';
END $verify$;
