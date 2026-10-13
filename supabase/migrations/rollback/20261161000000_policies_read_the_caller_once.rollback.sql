-- ROLLBACK 20261161000000 — the 193 policies back to calling auth.uid() per row.
--
-- Each ALTER below is the policy's exact text as it was live before the
-- migration (read from pg_policies 2026-10-13), and the block at the end checks
-- every one of them by md5.

BEGIN;

SET LOCAL lock_timeout = '3s';

ALTER POLICY "agent cache self" ON public.academic_agent_cache
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY academic_audit_admin_select ON public.academic_audit
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY "activity self" ON public.academic_daily_activity
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY academic_taxonomy_terms_write_operators ON public.academic_taxonomy_terms
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role)));

ALTER POLICY terms_admin ON public.academic_terms
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY academic_years_admin_write ON public.academic_years
  USING ((is_principal_or_admin(auth.uid()) AND same_school(school_id)))
  WITH CHECK ((is_principal_or_admin(auth.uid()) AND same_school(school_id)));

ALTER POLICY academic_years_school_select ON public.academic_years
  USING ((same_school(school_id) OR is_principal_or_admin(auth.uid())));

ALTER POLICY account_identifiers_select_own ON public.account_identifiers
  USING ((account_id = auth.uid()));

ALTER POLICY accounts_select_own ON public.accounts
  USING ((id = auth.uid()));

ALTER POLICY "admission_enquiries insert own school signed in" ON public.admission_enquiries
  WITH CHECK (((school_id = get_my_school_id()) AND ((created_by IS NULL) OR (created_by = auth.uid()))));

ALTER POLICY "admission_enquiries staff manage" ON public.admission_enquiries
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY "ai_benchmark fixtures read admin" ON public.ai_benchmark_fixtures
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "ai_benchmark runs read admin" ON public.ai_benchmark_runs
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "ai_benchmark runs write admin" ON public.ai_benchmark_runs
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "ai_benchmark defs read admin" ON public.ai_benchmark_suite_defs
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "ai_budget_quotas read school" ON public.ai_budget_quotas
  USING (((school_id IN ( SELECT s.school_id
   FROM students s
  WHERE (s.user_id = auth.uid()))) OR (school_id IN ( SELECT t.school_id
   FROM teachers t
  WHERE (t.user_id = auth.uid()))) OR (school_id IN ( SELECT p.school_id
   FROM parents p
  WHERE (p.user_id = auth.uid()))) OR ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id))));

ALTER POLICY "ai_budget_quotas write admin" ON public.ai_budget_quotas
  USING (((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id)))
  WITH CHECK (((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id)));

ALTER POLICY "ai_budget_usage read admin" ON public.ai_budget_usage
  USING (((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id)));

ALTER POLICY "ai_embedding_jobs staff read" ON public.ai_embedding_jobs
  USING (((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role)) AND same_school(school_id)));

ALTER POLICY "ai_expl insert own" ON public.ai_explanations
  WITH CHECK (((created_by = auth.uid()) AND ((school_id IS NULL) OR same_school(school_id) OR has_role(auth.uid(), 'admin'::app_role))));

ALTER POLICY "ai_expl read tenant" ON public.ai_explanations
  USING (((created_by = auth.uid()) OR ((school_id IS NOT NULL) AND (school_id IN ( SELECT s.school_id
   FROM students s
  WHERE (s.user_id = auth.uid())))) OR ((school_id IS NOT NULL) AND (school_id IN ( SELECT t.school_id
   FROM teachers t
  WHERE (t.user_id = auth.uid())))) OR ((school_id IS NOT NULL) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id))));

ALTER POLICY "ai_flags read authenticated" ON public.ai_feature_flags
  USING (((school_id IS NULL) OR (school_id IN ( SELECT s.school_id
   FROM students s
  WHERE (s.user_id = auth.uid()))) OR (school_id IN ( SELECT t.school_id
   FROM teachers t
  WHERE (t.user_id = auth.uid()))) OR (school_id IN ( SELECT p.school_id
   FROM parents p
  WHERE (p.user_id = auth.uid()))) OR ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id))));

ALTER POLICY "ai_flags write admin" ON public.ai_feature_flags
  USING (((school_id IS NOT NULL) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id)))
  WITH CHECK (((school_id IS NOT NULL) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id)));

ALTER POLICY "ai_feedback insert own" ON public.ai_feedback_signals
  WITH CHECK (((actor_user_id = auth.uid()) AND ((school_id IS NULL) OR same_school(school_id))));

ALTER POLICY "ai_feedback read own or admin" ON public.ai_feedback_signals
  USING (((actor_user_id = auth.uid()) OR ((school_id IS NOT NULL) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id))));

ALTER POLICY "ai_kms_audit staff read" ON public.ai_kms_approval_audit
  USING ((EXISTS ( SELECT 1
   FROM ai_kms_documents d
  WHERE ((d.id = ai_kms_approval_audit.document_id) AND same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))));

ALTER POLICY "ai_kms_chunks staff read" ON public.ai_kms_chunks
  USING ((EXISTS ( SELECT 1
   FROM ai_kms_documents d
  WHERE ((d.id = ai_kms_chunks.document_id) AND same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))));

ALTER POLICY "ai_kms_chunks staff write" ON public.ai_kms_chunks
  USING ((EXISTS ( SELECT 1
   FROM ai_kms_documents d
  WHERE ((d.id = ai_kms_chunks.document_id) AND same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ai_kms_documents d
  WHERE ((d.id = ai_kms_chunks.document_id) AND same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))));

ALTER POLICY "ai_kms_versions staff read" ON public.ai_kms_document_versions
  USING ((EXISTS ( SELECT 1
   FROM ai_kms_documents d
  WHERE ((d.id = ai_kms_document_versions.document_id) AND same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))));

ALTER POLICY "ai_kms_versions staff write" ON public.ai_kms_document_versions
  USING ((EXISTS ( SELECT 1
   FROM ai_kms_documents d
  WHERE ((d.id = ai_kms_document_versions.document_id) AND same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM ai_kms_documents d
  WHERE ((d.id = ai_kms_document_versions.document_id) AND same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))));

ALTER POLICY "ai_kms_documents staff read" ON public.ai_kms_documents
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))));

ALTER POLICY "ai_kms_documents staff write" ON public.ai_kms_documents
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR (has_role(auth.uid(), 'teacher'::app_role) AND ((owner_user_id IS NULL) OR (owner_user_id = auth.uid()))))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))));

ALTER POLICY "ai_prompt_library read admin" ON public.ai_prompt_library
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "ai_prompt_library write admin" ON public.ai_prompt_library
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "ai_decisions read own school" ON public.ai_request_decisions
  USING (((actor_user_id = auth.uid()) OR ((school_id IS NOT NULL) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id))));

ALTER POLICY "ai_session_memory own read" ON public.ai_session_memory
  USING (((actor_user_id = auth.uid()) OR ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)) AND same_school(school_id))));

ALTER POLICY "ai_session_memory own write" ON public.ai_session_memory
  USING (((actor_user_id = auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id))))
  WITH CHECK (((actor_user_id = auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id))));

ALTER POLICY "ai_workflow_registry read admin" ON public.ai_workflow_registry
  USING ((has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "app settings write" ON public.app_settings
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY approvals_select ON public.approval_requests
  USING ((same_school(school_id) AND ((requested_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY approvals_write ON public.approval_requests
  USING ((same_school(school_id) AND ((requested_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))
  WITH CHECK ((same_school(school_id) AND ((requested_by = auth.uid()) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY "att admin all" ON public.attendance
  USING ((( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) AND (school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids))))
  WITH CHECK ((( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) AND (school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids))));

ALTER POLICY "att teacher write class" ON public.attendance
  WITH CHECK ((EXISTS ( SELECT 1
   FROM attendance_submissions s
  WHERE ((s.id = attendance.submission_id) AND is_class_teacher_of_class(auth.uid(), s.section_id)))));

ALTER POLICY attendance_principal_never_writes ON public.attendance
  USING (true)
  WITH CHECK ((NOT has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY attendance_read ON public.attendance
  USING (((school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids)) AND (( SELECT is_principal_or_admin(auth.uid()) AS is_principal_or_admin) OR (student_id IN ( SELECT my_own_or_children_student_ids() AS my_own_or_children_student_ids)) OR (submission_id IN ( SELECT my_teacher_submission_ids() AS my_teacher_submission_ids)))));

ALTER POLICY attendance_submissions_admin_all ON public.attendance_submissions
  USING (((school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)))
  WITH CHECK (((school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids)) AND ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));

ALTER POLICY attendance_submissions_class_teacher_insert ON public.attendance_submissions
  WITH CHECK ((same_school(school_id) AND is_class_teacher_of_class(auth.uid(), section_id)));

ALTER POLICY attendance_submissions_principal_never_writes ON public.attendance_submissions
  USING (true)
  WITH CHECK ((NOT has_role(auth.uid(), 'principal'::app_role)));

ALTER POLICY "ba self all" ON public.battle_answers
  USING ((EXISTS ( SELECT 1
   FROM battle_participants p
  WHERE ((p.id = battle_answers.participant_id) AND (p.user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM battle_participants p
  WHERE ((p.id = battle_answers.participant_id) AND (p.user_id = auth.uid())))));

ALTER POLICY "be read" ON public.battle_events
  USING (((actor_user_id = auth.uid()) OR ((class_id IS NOT NULL) AND (student_class_id(auth.uid()) = class_id)) OR (has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)) OR (has_role(auth.uid(), 'principal'::app_role) AND same_school(school_id)) OR ((class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), class_id))));

ALTER POLICY "invites creator insert" ON public.battle_invites
  WITH CHECK (((inviter_user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM battles b
  WHERE ((b.id = battle_invites.battle_id) AND (b.creator_user_id = auth.uid()))))));

ALTER POLICY "invites read mine" ON public.battle_invites
  USING (((invited_user_id = auth.uid()) OR (inviter_user_id = auth.uid())));

ALTER POLICY "invites update mine" ON public.battle_invites
  USING ((invited_user_id = auth.uid()))
  WITH CHECK ((invited_user_id = auth.uid()));

ALTER POLICY "bp read class" ON public.battle_participants
  USING ((EXISTS ( SELECT 1
   FROM battles b
  WHERE ((b.id = battle_participants.battle_id) AND (b.is_public = true) AND ((student_class_id(auth.uid()) = b.class_id) OR (b.creator_user_id = auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role) AND same_school(b.school_id)) OR (has_role(auth.uid(), 'principal'::app_role) AND same_school(b.school_id)) OR teacher_teaches_class(auth.uid(), b.class_id))))));

ALTER POLICY "bp read private duel participants" ON public.battle_participants
  USING ((EXISTS ( SELECT 1
   FROM battles b
  WHERE ((b.id = battle_participants.battle_id) AND ((b.creator_user_id = auth.uid()) OR (EXISTS ( SELECT 1
           FROM battle_invites bi
          WHERE ((bi.battle_id = b.id) AND (bi.invited_user_id = auth.uid())))))))));

ALTER POLICY "bp self insert" ON public.battle_participants
  WITH CHECK (((user_id = auth.uid()) AND (school_id = get_my_school_id()) AND (EXISTS ( SELECT 1
   FROM battles b
  WHERE ((b.id = battle_participants.battle_id) AND (b.school_id = battle_participants.school_id))))));

ALTER POLICY "bp self update" ON public.battle_participants
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY "bq creator manage" ON public.battle_questions
  USING ((EXISTS ( SELECT 1
   FROM battles b
  WHERE ((b.id = battle_questions.battle_id) AND (b.creator_user_id = auth.uid())))))
  WITH CHECK ((EXISTS ( SELECT 1
   FROM battles b
  WHERE ((b.id = battle_questions.battle_id) AND (b.creator_user_id = auth.uid())))));

ALTER POLICY "bq read" ON public.battle_questions
  USING ((EXISTS ( SELECT 1
   FROM battles b
  WHERE ((b.id = battle_questions.battle_id) AND ((b.creator_user_id = auth.uid()) OR (student_class_id(auth.uid()) = b.class_id) OR (has_role(auth.uid(), 'admin'::app_role) AND same_school(b.school_id)))))));

ALTER POLICY "br ai update self" ON public.battle_reports
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY "br self read" ON public.battle_reports
  USING ((user_id = auth.uid()));

ALTER POLICY "battles admin all" ON public.battles
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY "battles creator manage" ON public.battles
  USING ((creator_user_id = auth.uid()))
  WITH CHECK ((creator_user_id = auth.uid()));

ALTER POLICY "battles read class" ON public.battles
  USING (((is_public = true) AND ((student_class_id(auth.uid()) = class_id) OR (creator_user_id = auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)) OR (has_role(auth.uid(), 'principal'::app_role) AND same_school(school_id)) OR teacher_teaches_class(auth.uid(), class_id))));

ALTER POLICY "battles read invited duel" ON public.battles
  USING ((EXISTS ( SELECT 1
   FROM battle_invites bi
  WHERE ((bi.battle_id = battles.id) AND (bi.invited_user_id = auth.uid())))));

ALTER POLICY boards_read ON public.boards
  USING ((auth.uid() IS NOT NULL));

ALTER POLICY chapters_read ON public.chapters
  USING ((auth.uid() IS NOT NULL));

ALTER POLICY "chat_conversations participant read" ON public.chat_conversations
  USING (((school_id = get_my_school_id()) AND is_chat_participant(id, auth.uid())));

ALTER POLICY chat_conversations_select ON public.chat_conversations
  USING (((school_id = get_my_school_id()) AND (EXISTS ( SELECT 1
   FROM chat_participants p
  WHERE ((p.conversation_id = chat_conversations.id) AND (p.user_id = auth.uid()))))));

ALTER POLICY "chat_participants self read" ON public.chat_participants
  USING (((user_id = auth.uid()) OR is_chat_participant(conversation_id, auth.uid())));

ALTER POLICY "chat_participants self update read" ON public.chat_participants
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY chat_participants_select ON public.chat_participants
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM chat_participants me
  WHERE ((me.conversation_id = chat_participants.conversation_id) AND (me.user_id = auth.uid()))))));

ALTER POLICY class_groups_write_admin ON public.class_groups
  USING ((same_school(school_id) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((same_school(school_id) AND has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "timetable write" ON public.class_timetables
  USING (((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)) OR (has_role(auth.uid(), 'principal'::app_role) AND same_school(school_id)) OR (EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.user_id = auth.uid()) AND (t.class_teacher_of = class_timetables.class_id))))))
  WITH CHECK (((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)) OR (has_role(auth.uid(), 'principal'::app_role) AND same_school(school_id)) OR (EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.user_id = auth.uid()) AND (t.class_teacher_of = class_timetables.class_id))))));

ALTER POLICY "classes admin and principal write" ON public.classes
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY classes_school_read ON public.classes
  USING ((same_school(school_id) OR (id = student_class_id(auth.uid())) OR teacher_teaches_class(auth.uid(), id) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.class_id = classes.id) AND (s.parent_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM ((parent_students ps
     JOIN students s ON ((s.id = ps.student_id)))
     JOIN parents pr ON ((pr.id = ps.parent_id)))
  WHERE ((s.class_id = classes.id) AND (pr.user_id = auth.uid()))))));

ALTER POLICY "doubt answer attachments insert" ON public.community_doubt_answer_attachments
  WITH CHECK ((EXISTS ( SELECT 1
   FROM (community_doubt_answers a
     JOIN community_doubts d ON ((d.id = a.doubt_id)))
  WHERE ((a.id = community_doubt_answer_attachments.answer_id) AND (a.user_id = auth.uid()) AND ((d.class_id = student_class_id(auth.uid())) OR teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id))))));

ALTER POLICY "doubt answer attachments read" ON public.community_doubt_answer_attachments
  USING ((EXISTS ( SELECT 1
   FROM (community_doubt_answers a
     JOIN community_doubts d ON ((d.id = a.doubt_id)))
  WHERE ((a.id = community_doubt_answer_attachments.answer_id) AND ((d.class_id = student_class_id(auth.uid())) OR teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id) OR (same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))))));

ALTER POLICY "community answers insert" ON public.community_doubt_answers
  WITH CHECK (((user_id = auth.uid()) AND (EXISTS ( SELECT 1
   FROM community_doubts d
  WHERE ((d.id = community_doubt_answers.doubt_id) AND ((d.class_id = student_class_id(auth.uid())) OR teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id)))))));

ALTER POLICY "community answers school read" ON public.community_doubt_answers
  USING ((EXISTS ( SELECT 1
   FROM community_doubts d
  WHERE ((d.id = community_doubt_answers.doubt_id) AND ((d.class_id = student_class_id(auth.uid())) OR teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id) OR (same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))))));

ALTER POLICY "doubt attachments insert" ON public.community_doubt_attachments
  WITH CHECK ((EXISTS ( SELECT 1
   FROM community_doubts d
  WHERE ((d.id = community_doubt_attachments.doubt_id) AND (d.user_id = auth.uid()) AND (d.class_id = student_class_id(auth.uid()))))));

ALTER POLICY "doubt attachments read" ON public.community_doubt_attachments
  USING ((EXISTS ( SELECT 1
   FROM community_doubts d
  WHERE ((d.id = community_doubt_attachments.doubt_id) AND ((d.class_id = student_class_id(auth.uid())) OR teacher_teaches_class_subject(auth.uid(), d.class_id, d.subject, d.subject_id) OR (same_school(d.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))))));

ALTER POLICY "community views own read" ON public.community_doubt_views
  USING ((user_id = auth.uid()));

ALTER POLICY "community votes own read" ON public.community_doubt_votes
  USING ((user_id = auth.uid()));

ALTER POLICY "community doubts insert student" ON public.community_doubts
  WITH CHECK (((user_id = auth.uid()) AND (class_id = student_class_id(auth.uid())) AND has_role(auth.uid(), 'student'::app_role)));

ALTER POLICY "community doubts student class read" ON public.community_doubts
  USING (((class_id = student_class_id(auth.uid())) OR teacher_teaches_class_subject(auth.uid(), class_id, subject, subject_id) OR (same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)))));

ALTER POLICY "community reputation school read" ON public.community_reputation
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = community_reputation.user_id) AND same_school(p.school_id))))));

ALTER POLICY "mastery self" ON public.concept_mastery
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY curriculum_classes_read ON public.curriculum_classes
  USING ((auth.uid() IS NOT NULL));

ALTER POLICY curriculum_subjects_read ON public.curriculum_subjects
  USING ((auth.uid() IS NOT NULL));

ALTER POLICY "device_tokens admin read" ON public.device_tokens
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY "device_tokens self all" ON public.device_tokens
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY exam_accounts_select_own ON public.exam_accounts
  USING ((account_id = auth.uid()));

ALTER POLICY exams_delete ON public.exams
  USING ((same_school(school_id) AND (
CASE active_membership_role()
    WHEN 'admin'::app_role THEN true
    WHEN 'teacher'::app_role THEN teacher_teaches_class(auth.uid(), class_id)
    ELSE false
END OR (is_super_admin() AND super_admin_has_any_access()))));

ALTER POLICY exams_insert ON public.exams
  WITH CHECK ((same_school(school_id) AND (
CASE active_membership_role()
    WHEN 'admin'::app_role THEN true
    WHEN 'teacher'::app_role THEN teacher_teaches_class(auth.uid(), class_id)
    ELSE false
END OR (is_super_admin() AND super_admin_has_any_access()))));

ALTER POLICY exams_update ON public.exams
  USING ((same_school(school_id) AND (
CASE active_membership_role()
    WHEN 'admin'::app_role THEN true
    WHEN 'teacher'::app_role THEN teacher_teaches_class(auth.uid(), class_id)
    ELSE false
END OR (is_super_admin() AND super_admin_has_any_access()))))
  WITH CHECK ((same_school(school_id) AND (
CASE active_membership_role()
    WHEN 'admin'::app_role THEN true
    WHEN 'teacher'::app_role THEN teacher_teaches_class(auth.uid(), class_id)
    ELSE false
END OR (is_super_admin() AND super_admin_has_any_access()))));

ALTER POLICY "fees admin all" ON public.fees
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY "fees principal read" ON public.fees
  USING ((has_role(auth.uid(), 'principal'::app_role) AND same_school(school_id)));

ALTER POLICY "fees teacher read" ON public.fees
  USING ((EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = fees.student_id) AND teacher_teaches_class(auth.uid(), s.class_id)))));

ALTER POLICY "homework admin all" ON public.homework
  USING ((( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) AND (school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids))))
  WITH CHECK ((( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) AND (school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids))));

ALTER POLICY "homework principal read" ON public.homework
  USING ((( SELECT has_role(auth.uid(), 'principal'::app_role) AS has_role) AND (school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids))));

ALTER POLICY "homework student read" ON public.homework
  USING (((class_id = ( SELECT student_class_id(auth.uid()) AS student_class_id)) AND (status = 'published'::text) AND (deleted_at IS NULL)));

ALTER POLICY homework_soft_delete_fence ON public.homework
  USING (((deleted_at IS NULL) OR ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));

ALTER POLICY "hw_sub admin read" ON public.homework_submissions
  USING ((( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) AND (school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids))));

ALTER POLICY "hw_sub principal read" ON public.homework_submissions
  USING ((( SELECT has_role(auth.uid(), 'principal'::app_role) AS has_role) AND (school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids))));

ALTER POLICY invitations_select_invitee ON public.invitations
  USING ((EXISTS ( SELECT 1
   FROM account_identifiers ai
  WHERE ((ai.account_id = auth.uid()) AND (ai.type = invitations.identifier_type) AND (ai.value = invitations.identifier_value)))));

ALTER POLICY resources_delete ON public.learning_resources
  USING ((same_school(school_id) AND has_role(auth.uid(), 'teacher'::app_role) AND (created_by = auth.uid())));

ALTER POLICY resources_select ON public.learning_resources
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role) OR (is_published AND ((class_id IS NULL) OR (class_id = student_class_id(auth.uid())) OR is_class_of_my_child(class_id))))));

ALTER POLICY resources_update ON public.learning_resources
  USING ((same_school(school_id) AND has_role(auth.uid(), 'teacher'::app_role) AND (created_by = auth.uid()) AND ((class_id IS NULL) OR teacher_teaches_class(auth.uid(), class_id))))
  WITH CHECK ((same_school(school_id) AND has_role(auth.uid(), 'teacher'::app_role) AND (created_by = auth.uid()) AND (class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), class_id)));

ALTER POLICY resources_write ON public.learning_resources
  WITH CHECK ((same_school(school_id) AND has_role(auth.uid(), 'teacher'::app_role) AND (class_id IS NOT NULL) AND teacher_teaches_class(auth.uid(), class_id)));

ALTER POLICY "leave decisions applicant read" ON public.leave_decisions
  USING ((EXISTS ( SELECT 1
   FROM leave_requests lr
  WHERE ((lr.id = leave_decisions.leave_request_id) AND (lr.applicant_user_id = auth.uid())))));

ALTER POLICY "leave decisions class teacher" ON public.leave_decisions
  USING ((EXISTS ( SELECT 1
   FROM leave_requests lr
  WHERE ((lr.id = leave_decisions.leave_request_id) AND (lr.student_id IS NOT NULL) AND is_class_teacher_of_student(auth.uid(), lr.student_id)))));

ALTER POLICY "leave decisions principal admin" ON public.leave_decisions
  USING ((is_principal_or_admin(auth.uid()) AND same_school(school_id)));

ALTER POLICY "leaves applicant insert" ON public.leave_requests
  WITH CHECK (((applicant_user_id = auth.uid()) AND (school_id = get_my_school_id())));

ALTER POLICY "leaves applicant read" ON public.leave_requests
  USING ((applicant_user_id = auth.uid()));

ALTER POLICY "leaves class teacher read" ON public.leave_requests
  USING (((student_id IS NOT NULL) AND is_class_teacher_of_student(auth.uid(), student_id)));

ALTER POLICY "leaves class teacher review" ON public.leave_requests
  USING (((student_id IS NOT NULL) AND is_class_teacher_of_student(auth.uid(), student_id)))
  WITH CHECK (((student_id IS NOT NULL) AND is_class_teacher_of_student(auth.uid(), student_id)));

ALTER POLICY "leaves principal admin all" ON public.leave_requests
  USING ((is_principal_or_admin(auth.uid()) AND same_school(school_id)))
  WITH CHECK ((is_principal_or_admin(auth.uid()) AND same_school(school_id)));

ALTER POLICY memberships_select_own ON public.memberships
  USING ((account_id = auth.uid()));

ALTER POLICY "message_attachments participant read" ON public.message_attachments
  USING ((EXISTS ( SELECT 1
   FROM messages m
  WHERE ((m.id = message_attachments.message_id) AND (m.school_id = get_my_school_id()) AND ((m.sender_id = auth.uid()) OR (m.receiver_id = auth.uid()) OR ((m.conversation_id IS NOT NULL) AND is_chat_participant(m.conversation_id, auth.uid())))))));

ALTER POLICY "messages mark read" ON public.messages
  USING (((school_id = get_my_school_id()) AND ((receiver_id = auth.uid()) OR (sender_id = auth.uid()) OR ((conversation_id IS NOT NULL) AND is_chat_participant(conversation_id, auth.uid())))))
  WITH CHECK (((school_id = get_my_school_id()) AND ((receiver_id = auth.uid()) OR (sender_id = auth.uid()) OR ((conversation_id IS NOT NULL) AND is_chat_participant(conversation_id, auth.uid())))));

ALTER POLICY "messages read participants" ON public.messages
  USING (((school_id = get_my_school_id()) AND ((sender_id = auth.uid()) OR (receiver_id = auth.uid()) OR ((conversation_id IS NOT NULL) AND is_chat_participant(conversation_id, auth.uid())))));

ALTER POLICY "messages send" ON public.messages
  WITH CHECK (((sender_id = auth.uid()) AND (school_id = get_my_school_id()) AND (((conversation_id IS NOT NULL) AND is_chat_participant(conversation_id, auth.uid())) OR ((conversation_id IS NULL) AND (receiver_id IS NOT NULL) AND chat_can_dm(auth.uid(), receiver_id)))));

ALTER POLICY "messages soft delete own" ON public.messages
  USING ((sender_id = auth.uid()))
  WITH CHECK ((sender_id = auth.uid()));

ALTER POLICY "notices admin full" ON public.notices
  USING (has_role(auth.uid(), 'admin'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role));

ALTER POLICY "notices principal full" ON public.notices
  USING (has_role(auth.uid(), 'principal'::app_role))
  WITH CHECK (has_role(auth.uid(), 'principal'::app_role));

ALTER POLICY "notices publisher own" ON public.notices
  USING ((posted_by = auth.uid()))
  WITH CHECK ((posted_by = auth.uid()));

ALTER POLICY "notices read class" ON public.notices
  USING (((audience = 'class'::notice_audience) AND (class_id IS NOT NULL) AND ((student_class_id(auth.uid()) = class_id) OR teacher_teaches_class(auth.uid(), class_id) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.parent_user_id = auth.uid()) AND (s.class_id = s.class_id)))))));

ALTER POLICY "notices read parents" ON public.notices
  USING (((audience = 'parents'::notice_audience) AND has_role(auth.uid(), 'parent'::app_role)));

ALTER POLICY "notices read section" ON public.notices
  USING (((audience = 'section'::notice_audience) AND (class_id IS NOT NULL) AND ((student_class_id(auth.uid()) = class_id) OR teacher_teaches_class(auth.uid(), class_id) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.parent_user_id = auth.uid()) AND (s.class_id = s.class_id)))))));

ALTER POLICY "notices read students" ON public.notices
  USING (((audience = 'students'::notice_audience) AND has_role(auth.uid(), 'student'::app_role)));

ALTER POLICY "notices read teachers" ON public.notices
  USING (((audience = 'teachers'::notice_audience) AND has_role(auth.uid(), 'teacher'::app_role)));

ALTER POLICY "notices teacher class" ON public.notices
  USING ((has_role(auth.uid(), 'teacher'::app_role) AND ((class_id IS NULL) OR teacher_teaches_class(auth.uid(), class_id))))
  WITH CHECK ((has_role(auth.uid(), 'teacher'::app_role) AND ((class_id IS NULL) OR teacher_teaches_class(auth.uid(), class_id))));

ALTER POLICY parent_students_admin_write ON public.parent_students
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY parent_students_select ON public.parent_students
  USING ((same_school(school_id) AND (((active_membership_role() = 'parent'::app_role) AND (parent_id = active_local_person_id())) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY parents_admin_write ON public.parents
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY parents_school_select ON public.parents
  USING ((same_school(school_id) AND (((user_id = auth.uid()) AND (id = active_local_person_id()) AND (active_membership_role() = 'parent'::app_role)) OR has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY parents_self_update ON public.parents
  USING ((same_school(school_id) AND (user_id = auth.uid()) AND (id = active_local_person_id()) AND (active_membership_role() = 'parent'::app_role)));

ALTER POLICY "practice sessions select self" ON public.practice_sessions
  USING ((user_id = auth.uid()));

ALTER POLICY "profiles admin all" ON public.profiles
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY "profiles self read" ON public.profiles
  USING (((auth.uid() = id) OR (has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id))));

ALTER POLICY "profiles self update" ON public.profiles
  USING ((auth.uid() = id))
  WITH CHECK (((auth.uid() = id) AND (NOT (school_id IS DISTINCT FROM ( SELECT p.school_id
   FROM profiles p
  WHERE (p.id = auth.uid())))) AND (NOT (is_active IS DISTINCT FROM ( SELECT p.is_active
   FROM profiles p
  WHERE (p.id = auth.uid()))))));

ALTER POLICY progression_history_self_read ON public.progression_history
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = progression_history.user_id) AND same_school(p.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)))))));

ALTER POLICY progression_league_history_self_read ON public.progression_league_history
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = progression_league_history.user_id) AND same_school(p.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)))))));

ALTER POLICY "question attempts select self" ON public.question_attempts
  USING ((user_id = auth.uid()));

ALTER POLICY qb_staff_read ON public.question_bank
  USING ((( SELECT is_principal_or_admin(auth.uid()) AS is_principal_or_admin) OR ( SELECT has_role(auth.uid(), 'teacher'::app_role) AS has_role)));

ALTER POLICY report_cards_read ON public.report_cards
  USING (((student_id IN ( SELECT my_own_or_children_student_ids() AS my_own_or_children_student_ids)) OR (student_id IN ( SELECT my_class_teacher_student_ids() AS my_class_teacher_student_ids)) OR (exam_id IN ( SELECT my_manageable_exam_ids() AS my_manageable_exam_ids)) OR ( SELECT is_principal_or_admin(auth.uid()) AS is_principal_or_admin)));

ALTER POLICY "revision self" ON public.revision_queue
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY activity_feed_select ON public.school_activity_feed
  USING (((school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids)) AND ( SELECT (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role) OR (is_super_admin() AND super_admin_has_any_access())))));

ALTER POLICY calendar_manage ON public.school_calendar_events
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'teacher'::app_role))));

ALTER POLICY "complaints read own" ON public.school_complaints
  USING (((submitted_by = auth.uid()) OR (same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)))));

ALTER POLICY "complaints staff delete" ON public.school_complaints
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY "complaints staff update" ON public.school_complaints
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY "complaints submit" ON public.school_complaints
  WITH CHECK (((submitted_by = auth.uid()) AND (school_id = get_my_school_id()) AND has_role(auth.uid(), 'parent'::app_role)));

ALTER POLICY schools_admin_update ON public.schools
  USING (((id = get_my_school_id()) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY section_subjects_write_admin ON public.section_subjects
  USING ((same_school(school_id) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((same_school(school_id) AND has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY sessions_delete_own ON public.sessions
  USING ((account_id = auth.uid()));

ALTER POLICY sessions_insert_own ON public.sessions
  WITH CHECK ((account_id = auth.uid()));

ALTER POLICY sessions_select_own ON public.sessions
  USING ((account_id = auth.uid()));

ALTER POLICY sessions_update_own ON public.sessions
  USING ((account_id = auth.uid()))
  WITH CHECK ((account_id = auth.uid()));

ALTER POLICY "brain self" ON public.student_academic_brain
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY student_achievements_self_read ON public.student_achievements
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = student_achievements.user_id) AND same_school(p.school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role)))))));

ALTER POLICY "badges school read" ON public.student_badges
  USING (((user_id = auth.uid()) OR (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = student_badges.user_id) AND same_school(p.school_id))))));

ALTER POLICY "badges self insert" ON public.student_badges
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY student_enrolments_write_admin ON public.student_enrolments
  USING ((same_school(school_id) AND has_role(auth.uid(), 'admin'::app_role)))
  WITH CHECK ((same_school(school_id) AND has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY "improvement plans self" ON public.student_improvement_plans
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY "mistakes self" ON public.student_mistakes
  USING ((user_id = auth.uid()))
  WITH CHECK ((user_id = auth.uid()));

ALTER POLICY "sqh self read" ON public.student_question_history
  USING ((user_id = auth.uid()));

ALTER POLICY "xp self read" ON public.student_xp
  USING ((user_id = auth.uid()));

ALTER POLICY "students admin and principal all" ON public.students
  USING (((school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids)) AND (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) OR ( SELECT has_role(auth.uid(), 'principal'::app_role) AS has_role))))
  WITH CHECK (((school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids)) AND (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) OR ( SELECT has_role(auth.uid(), 'principal'::app_role) AS has_role))));

ALTER POLICY students_exit_hides_from_guardian ON public.students
  USING (((exit_date IS NULL) OR (exit_date > CURRENT_DATE) OR (NOT ( SELECT has_role(auth.uid(), 'parent'::app_role) AS has_role))));

ALTER POLICY students_hide_soft_deleted ON public.students
  USING (((deleted_at IS NULL) OR ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));

ALTER POLICY students_read ON public.students
  USING (((school_id IN ( SELECT my_accessible_school_ids() AS my_accessible_school_ids)) AND (( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role) OR ( SELECT has_role(auth.uid(), 'principal'::app_role) AS has_role) OR ((( SELECT active_membership_role() AS active_membership_role) = 'student'::app_role) AND (user_id = ( SELECT auth.uid() AS uid)) AND (id = ( SELECT active_local_person_id() AS active_local_person_id))) OR ((( SELECT active_membership_role() AS active_membership_role) = 'parent'::app_role) AND ((parent_user_id = ( SELECT auth.uid() AS uid)) OR (id IN ( SELECT my_guardian_student_ids() AS my_guardian_student_ids)))) OR (class_id IN ( SELECT my_teacher_class_ids() AS my_teacher_class_ids)))));

ALTER POLICY subjects_admin ON public.subjects
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY teacher_assignments_write_staff ON public.teacher_assignments
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY "tc admin all" ON public.teacher_classes
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY "tc principal read" ON public.teacher_classes
  USING ((has_role(auth.uid(), 'principal'::app_role) AND same_school(school_id)));

ALTER POLICY "tc school read" ON public.teacher_classes
  USING ((same_school(school_id) OR (EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.id = teacher_classes.teacher_id) AND (t.user_id = auth.uid()))))));

ALTER POLICY teacher_remarks_hide_soft_deleted ON public.teacher_remarks
  USING (((deleted_at IS NULL) OR has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY teacher_remarks_school_select ON public.teacher_remarks
  USING ((same_school(school_id) AND (is_principal_or_admin(auth.uid()) OR (EXISTS ( SELECT 1
   FROM teachers t
  WHERE ((t.id = teacher_remarks.teacher_id) AND (t.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = teacher_remarks.student_id) AND (s.user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = teacher_remarks.student_id) AND (s.parent_user_id = auth.uid())))) OR (EXISTS ( SELECT 1
   FROM (parent_students ps
     JOIN parents p ON ((p.id = ps.parent_id)))
  WHERE ((ps.student_id = teacher_remarks.student_id) AND (p.user_id = auth.uid())))))));

ALTER POLICY teacher_remarks_teacher_write ON public.teacher_remarks
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = teacher_remarks.student_id) AND teacher_teaches_class(auth.uid(), s.class_id)))))))
  WITH CHECK ((same_school(school_id) AND (EXISTS ( SELECT 1
   FROM students s
  WHERE ((s.id = teacher_remarks.student_id) AND teacher_teaches_class(auth.uid(), s.class_id))))));

ALTER POLICY "teachers admin all" ON public.teachers
  USING ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND same_school(school_id)));

ALTER POLICY "teachers school staff read" ON public.teachers
  USING ((same_school(school_id) AND (((user_id = auth.uid()) AND (id = active_local_person_id()) AND (active_membership_role() = 'teacher'::app_role)) OR has_role(auth.uid(), 'principal'::app_role) OR has_role(auth.uid(), 'admin'::app_role))));

ALTER POLICY "teachers self read" ON public.teachers
  USING ((same_school(school_id) AND (user_id = auth.uid()) AND (id = active_local_person_id()) AND (active_membership_role() = 'teacher'::app_role)));

ALTER POLICY teachers_hide_soft_deleted ON public.teachers
  USING (((deleted_at IS NULL) OR has_role(auth.uid(), 'admin'::app_role)));

ALTER POLICY test_attempts_staff_read ON public.test_attempts
  USING ((( SELECT is_principal_or_admin(auth.uid()) AS is_principal_or_admin) OR (EXISTS ( SELECT 1
   FROM tests t
  WHERE ((t.id = test_attempts.test_id) AND (t.created_by = ( SELECT auth.uid() AS uid)))))));

ALTER POLICY test_questions_staff_read ON public.test_questions
  USING ((( SELECT is_principal_or_admin(auth.uid()) AS is_principal_or_admin) OR (EXISTS ( SELECT 1
   FROM tests t
  WHERE ((t.id = test_questions.test_id) AND (t.created_by = ( SELECT auth.uid() AS uid)))))));

ALTER POLICY test_questions_write ON public.test_questions
  USING ((( SELECT is_principal_or_admin(auth.uid()) AS is_principal_or_admin) OR (EXISTS ( SELECT 1
   FROM tests t
  WHERE ((t.id = test_questions.test_id) AND (t.created_by = ( SELECT auth.uid() AS uid)))))))
  WITH CHECK ((( SELECT is_principal_or_admin(auth.uid()) AS is_principal_or_admin) OR (EXISTS ( SELECT 1
   FROM tests t
  WHERE ((t.id = test_questions.test_id) AND (t.created_by = ( SELECT auth.uid() AS uid)))))));

ALTER POLICY tests_hide_soft_deleted ON public.tests
  USING (((deleted_at IS NULL) OR ( SELECT has_role(auth.uid(), 'admin'::app_role) AS has_role)));

ALTER POLICY timetable_slots_manage ON public.timetable_slots
  USING ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))))
  WITH CHECK ((same_school(school_id) AND (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'principal'::app_role))));

ALTER POLICY topics_insert_staff ON public.topics
  WITH CHECK ((has_role(auth.uid(), 'teacher'::app_role) OR has_role(auth.uid(), 'admin'::app_role) OR is_super_admin()));

ALTER POLICY "roles admin write" ON public.user_roles
  USING ((has_role(auth.uid(), 'admin'::app_role) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = user_roles.user_id) AND same_school(p.school_id))))))
  WITH CHECK ((has_role(auth.uid(), 'admin'::app_role) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = user_roles.user_id) AND same_school(p.school_id))))));

ALTER POLICY "roles self read" ON public.user_roles
  USING (((user_id = auth.uid()) OR (has_role(auth.uid(), 'admin'::app_role) AND (EXISTS ( SELECT 1
   FROM profiles p
  WHERE ((p.id = user_roles.user_id) AND same_school(p.school_id)))))));

DO $restored$
DECLARE _n int;
BEGIN
  SELECT count(*) INTO _n FROM pg_policies p
    JOIN (VALUES ('academic_agent_cache', 'agent cache self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('academic_audit', 'academic_audit_admin_select', '54878f75c7e031a661ac27164a745b92'),
          ('academic_daily_activity', 'activity self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('academic_taxonomy_terms', 'academic_taxonomy_terms_write_operators', '89e260b55253be9e7a14f9815b451274'),
          ('academic_terms', 'terms_admin', 'eca4263493f120016c2ec31991f5f711'),
          ('academic_years', 'academic_years_admin_write', '50674d959d5fd89d3c794005b6ced365'),
          ('academic_years', 'academic_years_school_select', 'd0c57dc2a332ce88e95a5367597e634b'),
          ('account_identifiers', 'account_identifiers_select_own', 'ca768c640b7c7b16cb30ccc29f3210bc'),
          ('accounts', 'accounts_select_own', 'bd301ab91c482f43f9fd893c5783c3c0'),
          ('admission_enquiries', 'admission_enquiries insert own school signed in', '27a8939e9cdcf7b333d33eec2eac8659'),
          ('admission_enquiries', 'admission_enquiries staff manage', 'b0a365bcfe15f0669930525fc63dc08c'),
          ('ai_benchmark_fixtures', 'ai_benchmark fixtures read admin', 'dd31fad6fc681418053c041e3330858f'),
          ('ai_benchmark_runs', 'ai_benchmark runs read admin', 'dd31fad6fc681418053c041e3330858f'),
          ('ai_benchmark_runs', 'ai_benchmark runs write admin', 'bff4dda025df070ff5434bc1751d243c'),
          ('ai_benchmark_suite_defs', 'ai_benchmark defs read admin', 'dd31fad6fc681418053c041e3330858f'),
          ('ai_budget_quotas', 'ai_budget_quotas read school', '78eae696323f36afd5809029640b4669'),
          ('ai_budget_quotas', 'ai_budget_quotas write admin', 'd2adbf5124fd621a00320a56d551eecc'),
          ('ai_budget_usage', 'ai_budget_usage read admin', 'b08a4be5253aa417f8fff47fbae63ef5'),
          ('ai_embedding_jobs', 'ai_embedding_jobs staff read', '9ddd75cbc0ba1c12a2b687a193b6ebbb'),
          ('ai_explanations', 'ai_expl insert own', 'a1938162f0e531455a35e8598e753df9'),
          ('ai_explanations', 'ai_expl read tenant', '170e9c96b27b3ae41c553b7ad9579854'),
          ('ai_feature_flags', 'ai_flags read authenticated', '3dbd65234990ff417c97736529982fc7'),
          ('ai_feature_flags', 'ai_flags write admin', '941bab324b26eab29d968d4c81e8e9fe'),
          ('ai_feedback_signals', 'ai_feedback insert own', 'c4e8270377baf85837405e8094712617'),
          ('ai_feedback_signals', 'ai_feedback read own or admin', 'ab07d0cca16a923b65d2c6d0076bd2d1'),
          ('ai_kms_approval_audit', 'ai_kms_audit staff read', 'f10f07fa332cea19ab89c3a592288f2d'),
          ('ai_kms_chunks', 'ai_kms_chunks staff read', '3a28b7e9f607f66a7955c7d09b82d8be'),
          ('ai_kms_chunks', 'ai_kms_chunks staff write', 'f21d3d23f62e49d47d80219aeafe758a'),
          ('ai_kms_document_versions', 'ai_kms_versions staff read', 'f1f19f36dfc914248e94c9032347e706'),
          ('ai_kms_document_versions', 'ai_kms_versions staff write', '07b4bedb0e23ad4eca8ace6db4826fc4'),
          ('ai_kms_documents', 'ai_kms_documents staff read', '368e0a95755f68385f25964ad32b6175'),
          ('ai_kms_documents', 'ai_kms_documents staff write', 'bba9d4e5ea50337951ffe94059a241e7'),
          ('ai_prompt_library', 'ai_prompt_library read admin', 'dd31fad6fc681418053c041e3330858f'),
          ('ai_prompt_library', 'ai_prompt_library write admin', 'bff4dda025df070ff5434bc1751d243c'),
          ('ai_request_decisions', 'ai_decisions read own school', 'ab07d0cca16a923b65d2c6d0076bd2d1'),
          ('ai_session_memory', 'ai_session_memory own read', '6be436e350f4557e002e5fd983ec0840'),
          ('ai_session_memory', 'ai_session_memory own write', '5cf20d027a42e6d7209037062c5aab5c'),
          ('ai_workflow_registry', 'ai_workflow_registry read admin', 'dd31fad6fc681418053c041e3330858f'),
          ('app_settings', 'app settings write', 'eca4263493f120016c2ec31991f5f711'),
          ('approval_requests', 'approvals_select', '1bdc77153ef871fe62186b63d6d54929'),
          ('approval_requests', 'approvals_write', 'd604225de4d1e0b6dfbd6f10804ba2b0'),
          ('attendance', 'att admin all', 'd9dc11bad4006278a662e3bd15f928d0'),
          ('attendance', 'att teacher write class', 'c539a5a06d1950b163f37716b619afcf'),
          ('attendance', 'attendance_principal_never_writes', '04e89f7e31727cb42c1b2ab5e1f30f66'),
          ('attendance', 'attendance_read', '491c369474c4e3adb503ad5dc3d3fa01'),
          ('attendance_submissions', 'attendance_submissions_admin_all', '21c1dda43feeb97f84b14c7d64bcd35e'),
          ('attendance_submissions', 'attendance_submissions_class_teacher_insert', 'fa0cc6088d52e3e7cd9120ce7bec269e'),
          ('attendance_submissions', 'attendance_submissions_principal_never_writes', '04e89f7e31727cb42c1b2ab5e1f30f66'),
          ('battle_answers', 'ba self all', '3e4751229a9d9b99b3cd1a5dcecaeda2'),
          ('battle_events', 'be read', 'e5c43a15a1a0c279bc465fd12d7395b5'),
          ('battle_invites', 'invites creator insert', 'ce8945b411d9dfcf0216fb250452d8b3'),
          ('battle_invites', 'invites read mine', 'd25ca288e810f4b3a180b2239904def2'),
          ('battle_invites', 'invites update mine', '929fec1c6fc712f5ce8907779dccd4ef'),
          ('battle_participants', 'bp read class', 'fc18465a8ab8c32c2c4a34ba8d8a05ad'),
          ('battle_participants', 'bp read private duel participants', '4e06f20a7f520c8474a62a39a835deb7'),
          ('battle_participants', 'bp self insert', 'bceb115cf6a01414dbbb3bd5ed12ef63'),
          ('battle_participants', 'bp self update', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('battle_questions', 'bq creator manage', '766c22a03616cb6e685fa90761e6f18e'),
          ('battle_questions', 'bq read', '386154058fe711fe8a67ac62efd65a0d'),
          ('battle_reports', 'br ai update self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('battle_reports', 'br self read', '5eebdfba311617743b110b29a41f23a0'),
          ('battles', 'battles admin all', 'eca4263493f120016c2ec31991f5f711'),
          ('battles', 'battles creator manage', 'e0d7308404370fd3032a10e705f25287'),
          ('battles', 'battles read class', 'ddb553dbf01deda41520b0ebc2d9771e'),
          ('battles', 'battles read invited duel', 'de7883bd408eac66ce1cd936cf39510f'),
          ('boards', 'boards_read', 'b3b3b08777360546899db966610ec99a'),
          ('chapters', 'chapters_read', 'b3b3b08777360546899db966610ec99a'),
          ('chat_conversations', 'chat_conversations participant read', 'c0d4022041308416a1d37e0754743ef9'),
          ('chat_conversations', 'chat_conversations_select', 'bd3e5217b7344ef6e2a4eabbdeb95752'),
          ('chat_participants', 'chat_participants self read', '0fab01b392a635c00cf59973f914ebb6'),
          ('chat_participants', 'chat_participants self update read', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('chat_participants', 'chat_participants_select', '676a302f06fdefc500f98f47c4ca920e'),
          ('class_groups', 'class_groups_write_admin', 'e9e3fda9c04fd96987b622780ccafdfc'),
          ('class_timetables', 'timetable write', 'cc580e7c55238610e372bcdfc74917ef'),
          ('classes', 'classes admin and principal write', 'b0a365bcfe15f0669930525fc63dc08c'),
          ('classes', 'classes_school_read', '19873ca3751c33d0cd6c6ec7d0e63519'),
          ('community_doubt_answer_attachments', 'doubt answer attachments insert', '3463a5cd39214522bd9d05f7e145923b'),
          ('community_doubt_answer_attachments', 'doubt answer attachments read', 'be030a09e9cb6d6f400a3ac68a7ae416'),
          ('community_doubt_answers', 'community answers insert', 'caf0a13117408a8e1c0080329c263d5a'),
          ('community_doubt_answers', 'community answers school read', '69258c68e90b3e51bef3b5a9fce54a4d'),
          ('community_doubt_attachments', 'doubt attachments insert', '290d972239cea3aa3150a6fd963cec91'),
          ('community_doubt_attachments', 'doubt attachments read', '2c603c28e196f4cb1f5a04ecb5792639'),
          ('community_doubt_views', 'community views own read', '5eebdfba311617743b110b29a41f23a0'),
          ('community_doubt_votes', 'community votes own read', '5eebdfba311617743b110b29a41f23a0'),
          ('community_doubts', 'community doubts insert student', 'cac73693e2274a6b8364e74bc11ee3a7'),
          ('community_doubts', 'community doubts student class read', 'f2f05d22ca0e1fc060525b2b10146ffe'),
          ('community_reputation', 'community reputation school read', '1fec9c13a5645ea7fe89e2884c0d0511'),
          ('concept_mastery', 'mastery self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('curriculum_classes', 'curriculum_classes_read', 'b3b3b08777360546899db966610ec99a'),
          ('curriculum_subjects', 'curriculum_subjects_read', 'b3b3b08777360546899db966610ec99a'),
          ('device_tokens', 'device_tokens admin read', '54878f75c7e031a661ac27164a745b92'),
          ('device_tokens', 'device_tokens self all', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('exam_accounts', 'exam_accounts_select_own', 'ca768c640b7c7b16cb30ccc29f3210bc'),
          ('exams', 'exams_delete', '0555c27cc3f59983754063abcd04ec32'),
          ('exams', 'exams_insert', '584bdc065731a0abdff52499c83864de'),
          ('exams', 'exams_update', '8d75db60ad16863233eaece43e792bee'),
          ('fees', 'fees admin all', 'eca4263493f120016c2ec31991f5f711'),
          ('fees', 'fees principal read', 'd95c6c6ae09f70833cb597e2a7751ec6'),
          ('fees', 'fees teacher read', 'a05fc0356a988b7fb693b03d4d8c67c4'),
          ('homework', 'homework admin all', 'd9dc11bad4006278a662e3bd15f928d0'),
          ('homework', 'homework principal read', '9e922da398bec5ee57005299ae36e99f'),
          ('homework', 'homework student read', 'f946b8d77512d4a8c2a6a994304b7a0f'),
          ('homework', 'homework_soft_delete_fence', '71f5519c0614c8ca47d4188b06399dfe'),
          ('homework_submissions', 'hw_sub admin read', '9286ce365c4fea96a88521782a21f34b'),
          ('homework_submissions', 'hw_sub principal read', '9e922da398bec5ee57005299ae36e99f'),
          ('invitations', 'invitations_select_invitee', '5848ca89063f77217bc32583107faec5'),
          ('learning_resources', 'resources_delete', '16b055b3c2730f1758d30720ed5b3a65'),
          ('learning_resources', 'resources_select', 'ab19967864eea16d49b73fd7267fb642'),
          ('learning_resources', 'resources_update', '33777a77935a0aa4e600578feb8f786d'),
          ('learning_resources', 'resources_write', '6da6bc48c91f56a6025059b043b13981'),
          ('leave_decisions', 'leave decisions applicant read', '5a3f463d99ff531bfdd7bed480318e93'),
          ('leave_decisions', 'leave decisions class teacher', '4cb12757e5d3a20474667df78ba4360e'),
          ('leave_decisions', 'leave decisions principal admin', '1fbacfb273c05fa2e9b298c68d3fb6dd'),
          ('leave_requests', 'leaves applicant insert', '03100af3318b9b03c9f432b60c447e4f'),
          ('leave_requests', 'leaves applicant read', '81628619887866aa0fe63b80f09cb3ee'),
          ('leave_requests', 'leaves class teacher read', '4a12ac9b7d48718441171ffc5d6010d4'),
          ('leave_requests', 'leaves class teacher review', 'c41a40d59f4d15b0c64ffbc794bece5a'),
          ('leave_requests', 'leaves principal admin all', '50674d959d5fd89d3c794005b6ced365'),
          ('memberships', 'memberships_select_own', 'ca768c640b7c7b16cb30ccc29f3210bc'),
          ('message_attachments', 'message_attachments participant read', '7e03ca1e063d19cf36940f15b95a3023'),
          ('messages', 'messages mark read', '3702fb8d03cfdbb60750b7bba5c66b23'),
          ('messages', 'messages read participants', '83786de5c71f44920d0bbeda8015d04b'),
          ('messages', 'messages send', 'c90b1a37fd049d8951e59813fa948ae3'),
          ('messages', 'messages soft delete own', '9a419983ca4d67805aca5b83da1a49e6'),
          ('notices', 'notices admin full', 'b46d9c3b7c1d4143bf5128b497368d12'),
          ('notices', 'notices principal full', 'ed41aaeca766650115edfd0e0f0f8d3e'),
          ('notices', 'notices publisher own', '9b82038c24154d05ec87c403157aed17'),
          ('notices', 'notices read class', 'd1ea31e171644053e9d4a03bdbb39135'),
          ('notices', 'notices read parents', 'c3b37381061be90efa537f7d926d9c3a'),
          ('notices', 'notices read section', 'abf7142415064c523e5c20f340557657'),
          ('notices', 'notices read students', '1eea32136847161da7f95e2d60af1a48'),
          ('notices', 'notices read teachers', '42b343cf53833aa6d5df062cfeb6cf1b'),
          ('notices', 'notices teacher class', 'bbc5d07f8e1d36e1506875a7b758c9f4'),
          ('parent_students', 'parent_students_admin_write', 'eca4263493f120016c2ec31991f5f711'),
          ('parent_students', 'parent_students_select', '8fde82389fca765f68d68349a891775e'),
          ('parents', 'parents_admin_write', 'eca4263493f120016c2ec31991f5f711'),
          ('parents', 'parents_school_select', '24c36d55a29156fafadc5b787bdbcf70'),
          ('parents', 'parents_self_update', '2c1cef7e12336ab70d3e6b176406ed0f'),
          ('practice_sessions', 'practice sessions select self', '5eebdfba311617743b110b29a41f23a0'),
          ('profiles', 'profiles admin all', 'eca4263493f120016c2ec31991f5f711'),
          ('profiles', 'profiles self read', 'bc2e955586fafc018d7af7c98eb387c8'),
          ('profiles', 'profiles self update', 'b86c481212a86a46574fb1e1eeb187a6'),
          ('progression_history', 'progression_history_self_read', '8cc9b8556674debcd1a6eaf5086785c2'),
          ('progression_league_history', 'progression_league_history_self_read', '9ee40380cd14f7e1060045685bf0355f'),
          ('question_attempts', 'question attempts select self', '5eebdfba311617743b110b29a41f23a0'),
          ('question_bank', 'qb_staff_read', '73ceb83b9a0a0d379d4bb65e473ad0aa'),
          ('report_cards', 'report_cards_read', '69c498d9145fee741b89c0e7435f01e3'),
          ('revision_queue', 'revision self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('school_activity_feed', 'activity_feed_select', 'e774549d118f8e750b290ae61217dd5d'),
          ('school_calendar_events', 'calendar_manage', '30b343ab94c1b97d0a7cb2080f2395dd'),
          ('school_complaints', 'complaints read own', 'ee320d208182225884148e178e263ae6'),
          ('school_complaints', 'complaints staff delete', 'ca21c1a983685630b98f6043feedde2f'),
          ('school_complaints', 'complaints staff update', 'b0a365bcfe15f0669930525fc63dc08c'),
          ('school_complaints', 'complaints submit', '48763c1d9115feaf64b0786d835f2b49'),
          ('schools', 'schools_admin_update', '4f2a3ddbdb6075df4753ad50156243d8'),
          ('section_subjects', 'section_subjects_write_admin', 'e9e3fda9c04fd96987b622780ccafdfc'),
          ('sessions', 'sessions_delete_own', 'ca768c640b7c7b16cb30ccc29f3210bc'),
          ('sessions', 'sessions_insert_own', '8078522db72e757ede9fd7cf3ed1fe32'),
          ('sessions', 'sessions_select_own', 'ca768c640b7c7b16cb30ccc29f3210bc'),
          ('sessions', 'sessions_update_own', '5bd899ad2317f7436676044d72191da3'),
          ('student_academic_brain', 'brain self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('student_achievements', 'student_achievements_self_read', '3f7c03e56aebd3d8a4a998a5809c5d77'),
          ('student_badges', 'badges school read', 'c4107233dce59254ce2b0df3a777c70a'),
          ('student_badges', 'badges self insert', 'f2ddbc79e24daf371a14e31c92b8402a'),
          ('student_enrolments', 'student_enrolments_write_admin', 'e9e3fda9c04fd96987b622780ccafdfc'),
          ('student_improvement_plans', 'improvement plans self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('student_mistakes', 'mistakes self', '7ea2326acd7022f54ccb7566a1d93f26'),
          ('student_question_history', 'sqh self read', '5eebdfba311617743b110b29a41f23a0'),
          ('student_xp', 'xp self read', '5eebdfba311617743b110b29a41f23a0'),
          ('students', 'students admin and principal all', '65639649d98663fa6677eb7af3a29dab'),
          ('students', 'students_exit_hides_from_guardian', 'fbda2774f9156c7bddea3a33051531fd'),
          ('students', 'students_hide_soft_deleted', '71f5519c0614c8ca47d4188b06399dfe'),
          ('students', 'students_read', 'c1c94ab7af5409faad63ebd3586cf964'),
          ('subjects', 'subjects_admin', 'eca4263493f120016c2ec31991f5f711'),
          ('teacher_assignments', 'teacher_assignments_write_staff', 'b0a365bcfe15f0669930525fc63dc08c'),
          ('teacher_classes', 'tc admin all', 'eca4263493f120016c2ec31991f5f711'),
          ('teacher_classes', 'tc principal read', 'd95c6c6ae09f70833cb597e2a7751ec6'),
          ('teacher_classes', 'tc school read', 'd62c83c69c01652ee707b2a0c3f08f9e'),
          ('teacher_remarks', 'teacher_remarks_hide_soft_deleted', 'fa315971a1201d3d02c3bf55c91f451a'),
          ('teacher_remarks', 'teacher_remarks_school_select', '4bb112bbc862a491afe3134fff74d06f'),
          ('teacher_remarks', 'teacher_remarks_teacher_write', '72c6c997db9e3c6978f868f336a145ca'),
          ('teachers', 'teachers admin all', 'eca4263493f120016c2ec31991f5f711'),
          ('teachers', 'teachers school staff read', 'dbe840c986b8dd3e31d1667745caec9a'),
          ('teachers', 'teachers self read', '3e5ec0f68039a39ff44f9d3206c69417'),
          ('teachers', 'teachers_hide_soft_deleted', 'fa315971a1201d3d02c3bf55c91f451a'),
          ('test_attempts', 'test_attempts_staff_read', 'fcfa362028c9c10d0804252ac3b70cdc'),
          ('test_questions', 'test_questions_staff_read', 'e370a2b0346b52d0a45da08c18a2561e'),
          ('test_questions', 'test_questions_write', 'c54fc38b88ad8b0cd49ebf4afa1e6420'),
          ('tests', 'tests_hide_soft_deleted', '71f5519c0614c8ca47d4188b06399dfe'),
          ('timetable_slots', 'timetable_slots_manage', 'b0a365bcfe15f0669930525fc63dc08c'),
          ('topics', 'topics_insert_staff', 'c49c5057b7d44b5fa0b645e20e212388'),
          ('user_roles', 'roles admin write', 'dc3d50acfe4a84014118d7afcf3e8b3d'),
          ('user_roles', 'roles self read', 'faa3fab4faaad830055c1c80df8c6079')) v(t, n, h)
      ON p.schemaname = 'public' AND p.tablename = v.t AND p.policyname = v.n
   WHERE md5(coalesce(p.qual,'') || '|' || coalesce(p.with_check,'')) = v.h;
  IF _n <> 193 THEN
    RAISE EXCEPTION 'ROLLBACK FAILED: % of 193 policies read as before', _n;
  END IF;
END $restored$;

COMMIT;
