/**
 * Static, credential-free guardrail against the exact bug class that caused
 * the match_question_bank / match_ai_answer_cache cross-school leak
 * (2026-08-21): a SQL function that reads/writes a tenant-scoped table but
 * never references school_id anywhere in its body, relying entirely on RLS
 * for isolation -- which silently stops being true the moment its only real
 * caller uses a service-role client (RLS never runs for service_role).
 *
 * This is a heuristic, not a prover: it flags "no mention of school_id at
 * all" in the LATEST (CREATE OR REPLACE-superseding) definition of every
 * function that touches a table known to carry a school_id column. A flagged
 * function is not automatically wrong -- some are legitimately fine because
 * every real caller goes through a client that respects RLS. Those get an
 * explicit allowlist entry with a one-line reason, so the check stays
 * meaningful (a growing allowlist of unexplained exceptions defeats the
 * point) instead of either crying wolf forever or missing the next real one.
 *
 * Run: node scripts/lint-tenant-scope.mjs
 * Exit 0 = no unexplained gaps. Exit 1 = at least one function needs either
 * a real fix or an allowlist entry with a reason.
 */
import { readFileSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

// Snapshot taken live 2026-08-21 (`SELECT table_name FROM information_schema.columns
// WHERE table_schema='public' AND column_name='school_id'`) -- 92 tables. Re-run that
// query and update this list if new tenant-scoped tables are added; a table missing
// here just means this check can't see it, not that it's exempt.
const SCHOOL_SCOPED_TABLES = [
  "academic_agent_cache", "academic_audit", "academic_daily_activity", "academic_events",
  "academic_terms", "academic_years", "admission_enquiries", "ai_answer_cache", "ai_budget_quotas", "ai_budget_usage",
  "ai_embedding_jobs", "ai_explanations", "ai_feature_flags", "ai_feedback_signals",
  "ai_kms_documents", "ai_request_decisions", "ai_session_memory", "ai_solution_cache",
  "app_settings", "approval_requests", "attendance",
  "audit_logs", "battle_answers", "battle_events", "battle_invites", "battle_participants",
  "battle_questions", "battle_reports", "battles", "chat_conversations", "chat_participants",
  "class_timetables", "classes", "community_doubt_answer_attachments", "community_doubt_answers",
  "community_doubt_attachments", "community_doubt_views", "community_doubt_votes",
  "community_doubts", "community_reputation", "concept_mastery", "device_tokens", "dpp_answers",
  "dpp_attempts", "dpp_questions", "dpps", "exams", "fees", "homework", "homework_submissions",
  "learning_resources", "leave_requests", "marks",
  "messages", "notices", "notifications", "parent_academic_alerts",
  "parent_students", "parents", "practice_sessions", "profiles", "progression_history",
  "progression_league_history", "question_attempts", "question_bank", "question_records",
  "question_templates",
  "revision_queue", "school_activity_feed", "school_calendar_events", "school_complaints",
  "student_academic_brain", "student_academic_profiles",
  "student_badges", "student_improvement_plans", "student_mistakes", "student_question_history",
  "student_xp", "students", "subjects", "teacher_classes", "teacher_remarks", "teachers",
  "timetable_slots",
];

// Functions confirmed safe despite touching a school-scoped table with no
// school_id reference -- each entry MUST say why, and the why must still be
// true (re-check on any change to the function or its callers).
const ALLOWLIST = {
  // --- An exam is an account, 2026-09-23 ---
  rpc_set_my_display_name:
    "OWNER-scoped, which is strictly tighter than an institution predicate: `_uid uuid := auth.uid()` with a RAISE when it is null, and both writes are keyed on that one person -- `UPDATE public.profiles ... WHERE id = _uid` and `UPDATE public.students ... WHERE user_id = _uid`. It takes ONE argument, the name itself, so there is no target parameter to point at another student; same_school() would admit thousands of accounts where auth.uid() admits one, so adding it would widen the check, not narrow it, and would restate a fence the owner predicate already imposes (G9). It writes nothing but full_name, and reads nothing back. EXECUTE is revoked from PUBLIC and anon and granted to authenticated only (20261046000000). Checkable: the body must contain `auth.uid()` and both `WHERE id = _uid` and `WHERE user_id = _uid`, and must NOT contain has_role, same_school, or any _student_id/_user_id parameter. It exists because an individual exam account's name has two homes the panel reads -- the profile and the student row -- and writing one without the other is the two-sources-of-truth shape. Read body 2026-09-23.",

  ai_embedding_jobs_process_batch:
    "Confirmed 2026-08-21: a single shared service-role-only batch worker (analogous to a cron job), not a per-tenant request handler. FOR UPDATE SKIP LOCKED prevents cross-worker double-claim races; each returned job is already tagged with its own school_id so no cross-tenant data mixing occurs downstream.",
  bump_ai_answer_cache_hit:
    "Confirmed 2026-08-21: SECURITY INVOKER (prosecdef=false) on ai_answer_cache, which has RLS enabled with zero policies -- any authenticated/anon caller's UPDATE is blocked by RLS regardless of the id argument, so the missing school_id check is structurally unreachable, not just unlikely.",

  // --- Phase 5 audit, 2026-08-22 ---
  // Trigger functions: fire per-row on already-authorized INSERT/UPDATE/DELETE
  // of the single NEW/OLD row that triggered them; they never look up other
  // tenants' rows, so a school_id check inside them is a category error, not
  // a missing check. Individually read every body before allowlisting.
  tg_reject_locked_attendance_write: "Trigger (BEFORE INSERT/UPDATE on attendance): looks up a lock by NEW.submission_id and either returns NEW or RAISEs. The submission it names is already fenced by attendance_submissions' own tenant fence, so a cross-institution submission_id cannot be reached to be locked against. Returns no data, grants nothing. Read body 2026-08-26 (Chunk 4.6).",
  tg_attendance_one_row_per_student_per_day: "Trigger (BEFORE INSERT/UPDATE on attendance): counts existing attendance for NEW.student_id on the submission's date purely to REFUSE a duplicate. It restricts writes and never widens them; a school_id predicate would be a category error. Preserves the guarantee the dropped UNIQUE(student_id, date) carried. Read body 2026-08-26 (Chunk 4.6).",
  tg_student_section_must_match: "Trigger (BEFORE INSERT/UPDATE on attendance, homework_submissions, marks): reads students.class_id for NEW.student_id purely to compare it with the section the record itself names, and either returns NEW unchanged or RAISEs. It only ever RESTRICTS a write an already-authorized caller is making; it returns no data and can grant nothing, so a school_id predicate would be a category error. Read body 2026-08-26 (Chunk 2, 20260826140000).",
  tg_homework_compute_is_late: "DROPPED by 20260925110000_homework_is_one_file_and_two_decisions.sql, with is_late itself: nothing can be handed in after the deadline, so there is no late. The entry stays because this lint reads migration FILES and 20260822160000 still contains the CREATE -- migration history is append-only. While it existed the reason was: trigger operating only on NEW, the single row already being written by an already-authorized caller, and unattached to any table since Chunk 5.",
  _backfill_question_bank_concepts:
    "DROPPED by 20261020010000_the_old_topic_labels_leave_the_bank.sql (line 1227); absent from pg_proc on live (measured 2026-09-22). The entry stays because this lint reads migration FILES and 20260613000000 still contains the CREATE — history is append-only. It was a one-off backfill of the concept column the topic migration removed.",
  _backfill_battle_question_concepts:
    "DROPPED by 20261020010000_the_old_topic_labels_leave_the_bank.sql (line 1228); absent from pg_proc on live (measured 2026-09-22). Listed only because 20260613000000 still contains the CREATE.",
  _backfill_template_concepts:
    "DROPPED by 20261020010000_the_old_topic_labels_leave_the_bank.sql (line 1229); absent from pg_proc on live (measured 2026-09-22). Listed only because 20260613000000 still contains the CREATE.",

  // --- Homework ruling, 2026-09-13 ---
  homework_file_is_fixed: "Self-scoped, and strictly tighter than an institution predicate: its first predicate is split_part(_object_name, '/', 1) = auth.uid()::text, so it answers only for an object in the CALLER'S OWN academic-files folder and is false for everyone else's -- one person, where same_school() would admit thousands. Given that, it asks whether homework_submissions.file or homework.question_file names that exact path, and returns one boolean. Its callers are the academic-files UPDATE and DELETE storage policies, which run the same folder check first. Definer only because a teacher may no longer be able to read the homework row that references their own question file. 20260925140000's verify asserts the false answer for another person's folder, and its break battery proves that check fires. Read body 2026-09-13.",
  my_guardian_student_ids:
    "SECURITY DEFINER, no parameters. SELECT student_id FROM parent_students WHERE active_membership_role() = 'parent' AND parent_id = active_local_person_id(): the students linked to the ONE parent person the caller's own active membership is bound to. Owner-scoped, strictly tighter than same_school(), which thousands of same-school accounts satisfy. Anyone not acting as a parent gets nothing. EXECUTE: authenticated (it is read inside students_read and parent policies), anon revoked (measured live 2026-09-22: anon=false). Re-read live 2026-09-22 (20260925160000).",
  my_children_class_ids:
    "SECURITY DEFINER, no parameters. Returns an EMPTY array unless the caller acts as a parent; otherwise the class ids of the students in my_own_or_children_student_ids() — the caller's own children, by the same owner-scoped binding as my_guardian_student_ids. A parent learns only which classes their own children sit in, which is what the homework and notice policies need to read those classes' rows. EXECUTE: authenticated, anon revoked (measured live 2026-09-22). Re-read live 2026-09-22 (20260925160000).",
  tg_notification_push_queue:
    "Trigger (BEFORE INSERT on notifications): operates only on NEW, the one row already being written by an authorized writer, and sets NEW.pushed_at — NULL when the recipient NEW.user_id has a registered device, now() otherwise — ignoring whatever the writer put there. It reads device_tokens only for NEW.user_id and returns nothing to any caller; it can restrict or schedule a write, never widen one. EXECUTE revoked from anon and authenticated (measured live 2026-09-22). Re-read live 2026-09-22 (20260925190000).",
  claim_notifications_for_push:
    "Platform drain, not a request handler: called only by the notification-push edge function with the service role, to claim (FOR UPDATE SKIP LOCKED, pushed_at := now()) up to 1,000 unpushed notifications from the last 30 minutes across the platform and return each with its OWN recipient's device tokens. There is no single institution to scope a platform-wide delivery queue to, and nothing is mixed: every row it returns goes to the user it names. EXECUTE: service_role only (measured live 2026-09-22: anon=false, authenticated=false, service_role=true). Same shape as dispatch_notification_push. Re-read live 2026-09-22 (20260925190000).",

  // --- Answer withholding, 2026-09-22 ---
  //
  // Context for all three: question_bank is a G2 GLOBAL table (Chunk 7A --
  // "shared across every school. No institution_id"), so it has no school_id
  // to predicate on. What these functions guard is not which SCHOOL may see a
  // question -- every school sees every question -- but whether the CALLER
  // has earned the answer to it. That is an owner fence, which is strictly
  // tighter than a school one.
  rpc_question_review:
    "SECURITY DEFINER. Reads question_bank (G2 GLOBAL, no school_id column exists) " +
    "and question_attempts. Owner-scoped by construction: the WHERE clause admits a " +
    "row only when `EXISTS (SELECT 1 FROM question_attempts qa WHERE qa.user_id = auth.uid() " +
    "AND qa.bank_question_id = q.id)`, i.e. only for a question this caller has actually " +
    "attempted, or when the caller is staff (is_principal_or_admin / has_role 'teacher'). " +
    "It takes an array of QUESTION ids, never a user id, so there is no target parameter " +
    "to point at another student. Checkable: the body must contain `qa.user_id = _uid` " +
    "inside an EXISTS, and must NOT contain a _student_id or _user_id parameter. " +
    "Verified live 2026-09-22 as the signed-in student: 1 row for an attempted question, " +
    "ZERO rows for three unattempted ones, 1 row as a teacher.",

  _attempt_verdict:
    "SECURITY DEFINER and callable by nobody through the API: 20261047000000 REVOKEs it " +
    "from anon and authenticated, and a student calling it directly was measured on " +
    "2026-09-22 returning 403 'permission denied for function _attempt_verdict' against " +
    "ANOTHER student's attempt id. Its only callers are the three RETURN paths of " +
    "rpc_record_question_attempt, which has already established that the attempt row is " +
    "the caller's own -- it created it. Reads question_attempts by primary key and " +
    "question_bank (G2 global). Checkable: pg_proc.proacl must not grant EXECUTE to " +
    "authenticated, and its only caller must be rpc_record_question_attempt.",

  rpc_question_hint:
    "SECURITY DEFINER. Touches question_bank and NOTHING ELSE — no per-student table in the body, so no tenant data in reach. It takes one question id and selects by primary key with is_approved: nothing a caller can steer, nothing to enumerate. NO CALLER SINCE THE 2026-09-22 RELEASE: the practice ruling of 2026-09-18 removed the hint, because the bank has no hint text and the 'hint' was the worked solution's first 120 characters — the whole answer for 39% of servable questions (8,557 of 21,717) — so the release kept the ruling and removed PracticeService.questionHint. The function is live and unused; dropping it is a migration waiting on database access. Checkable: the body must reference no table other than question_bank.",

  // --- Chunk 6.6, 2026-08-27 ---
  rpc_get_battle_report:
    "Reads battle_reports for ONE participant and returns it only when _r.user_id = auth.uid(). The literal school_id vanished from this body in Chunk 7B batch 2d, and its disappearance is the fix rather than a regression: the clause that carried it was `has_role(admin) AND same_school(_r.school_id) OR has_role(principal) AND same_school(...) OR teacher_teaches_class(...)`, which is exactly the leak 2d closed — a battle report holds topics.weak and a per-question questions[] list, and §10.8 makes that the student's alone. What replaced it is STRICTLY TIGHTER than an institution predicate: auth.uid() identifies one person, so an owner check cannot be satisfied across institutions the way same_school() can be satisfied by any of thousands of same-school users. Adding same_school() back on top would narrow nothing and would restate the fence twice (G9). Checkable: the body must contain `_r.user_id <> auth.uid()` and must NOT contain teacher_teaches_class or has_role — CHUNK7B_BATCH2D_VERIFY item 1 asserts the behaviour by calling it as a teacher and requiring a RAISE, and item 6 negative-controls that assertion. Read body 2026-08-29 (Chunk 7B batch 2d, 20260828220000).",

  my_class_teacher_student_ids: "Set helper (students whose class this caller is CLASS TEACHER of). The institution predicate is present but one level down, which is why the literal school_id does not appear in this body: it resolves through my_class_teacher_class_ids(), whose own body filters t.school_id IN (SELECT public.my_accessible_school_ids()). Inlining the predicate here would restate the same fence twice and is exactly the two-sources-of-truth shape G9 warns about. It also TIGHTENS what it replaced: the scalar is_class_teacher_of_student() it was derived from carries no institution predicate at all. Read body 2026-08-27 (Chunk 6.6, 20260827160000).",

  // --- Chunk 6, 2026-08-27 ---
  tg_report_card_requires_every_subject: "Trigger (BEFORE INSERT OR UPDATE OF exam_id, student_id on report_cards): counts exam_subjects for NEW.exam_id and the marks against them for NEW.student_id, then either returns NEW or RAISEs 'never partial'. It returns no data and can only REFUSE a write an already-authorized caller is making. Both rows it reaches are pinned to NEW.school_id in the schema, not merely by RLS: report_cards_exam_fk is FOREIGN KEY (exam_id, school_id) REFERENCES exams (id, school_id) and report_cards_student_fk is FOREIGN KEY (student_id, school_id) REFERENCES students (id, school_id) -- both with all four columns NOT NULL, so MATCH SIMPLE cannot null-skip either. exam_subjects and marks are reached only through that pinned exam. The student FK was single-column when this lint first flagged the function; Section 18 of 20260827110000 made it composite, which is why the reason is checkable at all. Read body 2026-08-27 (Chunk 6).",

  // --- Chunk 5, 2026-08-26 ---
  tg_homework_answer_autograde: "DROPPED by 20260925110000_homework_is_one_file_and_two_decisions.sql, with homework_answers (there is no typed or digital homework submission). The entry stays because this lint reads migration FILES and 20260826220000 still contains the CREATE -- migration history is append-only. While it existed the reason was: it read the G2 GLOBAL question_bank by primary key to grade NEW, which homework_answers' own tenant fence already bounded.",
  tg_homework_submission_lock_at_due: "DROPPED by 20260925110000_homework_is_one_file_and_two_decisions.sql: students no longer write submission rows, and rpc_homework_submit refuses a hand-in at or after closes_at itself. The entry stays because this lint reads migration FILES and 20260826220000 still contains the CREATE -- migration history is append-only. While it existed the reason was: it read NEW's own homework, already tenant-fenced, purely to refuse a late write.",
  tg_homework_topic_matches_chapter: "Trigger (BEFORE INSERT/UPDATE on homework): compares NEW.topic_id's chapter with NEW.chapter_id and RAISEs on mismatch. Both topics and chapters are G2 GLOBAL tables with no school_id, so no tenant predicate exists to add. Restricts writes only. Read body 2026-08-26 (Chunk 5 correction).",
  tg_homework_answer_topic_matches_chapter: "DROPPED by 20260925110000_homework_is_one_file_and_two_decisions.sql, with homework_answers. The entry stays because this lint reads migration FILES, which still contain the CREATE -- migration history is append-only. While it existed the reason was the one above, on the answer row: global topics/chapters, single NEW row.",
  rpc_purge_deleted_homework: "DROPPED LIVE on 2026-09-04 by 20260904130000_chunk9_trash_registry.sql, which replaced it with rpc_purge_expired. The entry stays because this lint reads migration FILES and 20260826240000_chunk5_purge_job_guard.sql still contains the CREATE -- migration history is append-only. While it existed the reason was: platform maintenance job applying G6's uniform 7-day homework retention across all institutions, with no per-user caller (body RAISEs when auth.uid() IS NOT NULL) and EXECUTE revoked from public/anon/authenticated.",
  _parent_weekly_digest: "Scoped by PARENT IDENTITY, not by institution, which is strictly tighter: it selects only the children linked to the _parent it is given (students.parent_user_id, or a parents/parent_students row), and a parent-student link is itself school-scoped, so no other tenant's child is reachable to predicate against. It is also UNREACHABLE DIRECTLY -- proacl is postgres/service_role only, verified 2026-09-04 (authenticated=false, anon=false). Its two callers supply the parent: rpc_parent_weekly_digest passes auth.uid() behind a parent-role gate, and rpc_send_parent_weekly_digests is the cron job. Adding same_school() here would restate a fence the parent link already imposes -- the G9 shape this lint sits downstream of. Read body 2026-09-04.",
  rpc_purge_expired_battle_reports: "Platform maintenance job, not a request handler: it collects battle_reports past their own expires_at across all institutions, so there is no correct institution to scope to. Same shape and same reason as rpc_purge_expired directly below. Structurally unreachable by any user, not merely revoked -- the body RAISEs when auth.uid() IS NOT NULL, and proacl is postgres/service_role only (measured 2026-09-08: anon EXECUTE false, authenticated EXECUTE false). probe10 asserts all three halves as the caller: a signed-in caller is refused, an expired report is collected, and an UNEXPIRED one SURVIVES -- without that last one a bare DELETE would pass. Read body 2026-09-08.",
  rpc_question_bank_review_queue: "Reads question_bank, which has NO school_id column at all (measured 2026-09-08: 0 of 33 columns) -- it is a G2 GLOBAL table, 7A: 'Shared across every school. No institution_id'. There is no tenant predicate available to add, which is the same reason _recovery_variant_pool carries below. What bounds it instead is the ACTOR: the body opens with IF NOT (SELECT public.is_super_admin()) THEN RAISE 'only a super admin may review the central question bank (§10.20)', and §10.20 gives the central bank to the super admin precisely because it belongs to no school. probe30 asserts the refusal and the admission as the caller. Read body 2026-09-08.",
  rpc_review_question: "Same table and same reason as rpc_question_bank_review_queue above: question_bank has no school_id to predicate on. Gated on the actor -- IF NOT (SELECT public.is_super_admin()) THEN RAISE 'only a super admin may approve or reject a question (§10.20)' -- and defended a second time at the row level by tg_question_bank_approval_is_super_admin_only, so a direct UPDATE that bypassed this function is refused too. probe30 asserts a teacher cannot self-approve. Read body 2026-09-08.",
  rpc_purge_expired: "Platform maintenance job, not a request handler: it applies G6's uniform retention (test 7d, homework 7d, student 30d, teacher 30d) across all institutions, so there is no correct institution to scope to. Made structurally unreachable by any user rather than merely revoked -- the body RAISEs when auth.uid() IS NOT NULL, and EXECUTE is granted only to service_role (asserted by 20260904150000_trash_view_grant_fix.sql). Replaces the homework-only purge, which carried this same reason for one entity type. Read body 2026-09-04.",
  tg_homework_submission_student_guard: "DROPPED by 20260925110000_homework_is_one_file_and_two_decisions.sql: RLS on homework_submissions is read-only for every role, so there is no student write left to guard. The entry stays because this lint reads migration FILES, which still contain the CREATE -- migration history is append-only. While it existed the reason was: it compared NEW/OLD on the single row being updated only.",
  tg_marks_within_max: "Trigger (BEFORE INSERT/UPDATE on marks): validates NEW.marks_obtained against NEW's own exam_id's max_marks, single row only. Read body 2026-08-22.",
  tg_students_prevent_orphan_history: "Trigger (BEFORE DELETE on students): checks whether OLD.id (the one row being deleted) has related history rows; no cross-tenant lookup. Read body 2026-08-22.",
  trg_messages_notify_receiver: "Trigger (AFTER INSERT on messages): notifies only the participants of NEW's own conversation_id/receiver_id, both already tenant-scoped upstream. Read body 2026-08-22.",

  // RLS-policy scoping primitives: pure boolean/scalar predicates used
  // directly inside USING/WITH CHECK clauses on other tables. They MUST stay
  // executable by `authenticated` for RLS itself to evaluate -- revoking
  // would break every policy that references them. Reading arbitrary IDs
  // through them leaks at most a yes/no fact (e.g. "is X the teacher of
  // class Y"), not row data.
  is_class_teacher_of_class: "RLS-policy primitive (used directly in USING clauses); must remain callable by authenticated. Pure boolean, no row data exposed.",
  is_class_teacher_of_student: "RLS-policy primitive; same as is_class_teacher_of_class.",
  teacher_teaches_class: "RLS-policy primitive; same reasoning.",
  teacher_teaches_class_subject: "RLS-policy primitive; same reasoning.",
  student_class_id: "RLS-policy/helper primitive returning a single scalar (class_id), no row data.",
  is_chat_participant: "RLS-policy primitive; pure boolean.",
  is_battle_participant: "RLS-policy primitive; pure boolean.",

  // Internal helpers revoked from anon/authenticated in this audit
  // (20260822180000_phase5_revoke_internal_helper_execute.sql,
  // 20260822190000_phase5_parent_join_table_and_snapshot_lockdown.sql) after
  // confirming zero direct external callers (grepped src/ and
  // supabase/functions/ for `.rpc("name"` -- no matches for any of these).
  // A revoked function can no longer be reached with an attacker-controlled
  // argument at all, which is what the missing school_id check would have
  // guarded against -- the access-control fix supersedes the need for a
  // school_id predicate for these specifically.
  _award_engagement_badges: "Revoked from anon/authenticated 2026-08-22 (internal helper, zero external callers).",
  _build_concept_recovery_report: "Revoked from anon/authenticated 2026-08-22.",
  _bump_academic_activity: "Revoked from anon/authenticated 2026-08-22 (both overloads).",
  _class_grade: "Revoked from anon/authenticated 2026-08-22.",
  _community_author_name: "Revoked from anon/authenticated 2026-08-22.",
  _community_refresh_reputation: "Revoked from anon/authenticated 2026-08-22.",
  _dim_consistency: "Revoked from anon/authenticated 2026-08-22.",
  _dim_evidence_strength: "Revoked from anon/authenticated 2026-08-22.",
  _dim_growth_trend: "Revoked from anon/authenticated 2026-08-22.",
  _dim_recovery_need: "Revoked from anon/authenticated 2026-08-22.",
  _dim_retention: "Revoked from anon/authenticated 2026-08-22.",
  _dim_understanding: "Revoked from anon/authenticated 2026-08-22.",
  _maybe_finish_battle: "Revoked from anon/authenticated 2026-08-22.",
  _notify_class_students: "Revoked from anon/authenticated 2026-08-22 (notification-spam vector otherwise).",
  _notify_class_teacher: "Revoked from anon/authenticated 2026-08-22.",
  _notify_student_circle: "Revoked from anon/authenticated 2026-08-22.",
  _notify_student_parents: "Revoked from anon/authenticated 2026-08-22.",
  _peek_teacher_featured_battle: "Revoked from anon/authenticated 2026-08-22.",
  _practice_grade_from_bank: "Revoked from anon/authenticated 2026-08-22.",
  _progression_bump_homework_count: "Revoked from anon/authenticated 2026-08-22.",
  _progression_bump_study_streak: "Revoked from anon/authenticated 2026-08-22.",
  _progression_check_milestones: "Revoked from anon/authenticated 2026-08-22.",
  _rebuild_revision_queue: "Revoked from anon/authenticated 2026-08-22.",
  _recompute_concept_confidence_for_session: "Revoked from anon/authenticated 2026-08-22.",
  _revision_recently_completed: "Revoked from anon/authenticated 2026-08-22.",
  _revision_topic_priority: "Revoked from anon/authenticated 2026-08-22.",
  _snapshot_battle_report: "Revoked from anon/authenticated 2026-08-22.",
  _upsert_concept_mastery: "Revoked from anon/authenticated 2026-08-22 (this was the concrete forgery vector verified live during this audit).",
  _weak_topics_for_user: "Revoked from anon/authenticated 2026-08-22.",
  rpc_student_academic_snapshot_internal: "Revoked from anon/authenticated 2026-08-22 -- this was a real, confirmed private-data leak (any uid's full academic snapshot, no ownership check) until this audit closed it.",
  ensure_student_academic_profile: "Revoked from anon/authenticated 2026-08-22 (letting anyone force a recompute for an arbitrary student; no data leak but no reason to stay public).",
  refresh_student_academic_profile: "Revoked from anon/authenticated 2026-08-22; same reasoning as ensure_student_academic_profile.",
  _battle_event: "Revoked from anon/authenticated 2026-08-22.",
  _exam_readiness: "Revoked from anon/authenticated 2026-08-22 -- was a genuine cross-student privacy leak (arbitrary uid's exam readiness) until access was revoked.",
  _capture_battle_mistakes: "Revoked from anon/authenticated 2026-08-22.",
  _capture_dpp_mistakes: "Revoked from anon/authenticated 2026-08-22.",
  _ensure_student_xp: "Revoked from anon/authenticated 2026-08-22.",
  _community_user_role: "Revoked from anon/authenticated 2026-08-22.",
  _award_achievement: "Revoked from anon/authenticated 2026-08-22.",
  _award_badge: "Revoked from anon/authenticated 2026-08-22.",
  _upsert_question_record: "Revoked from anon/authenticated 2026-08-22.",
  _fanout_announcement_published: "Revoked from anon/authenticated 2026-08-22 (notification-spam vector otherwise).",
  _notify: "Revoked from anon/authenticated 2026-08-22.",
  _featured_system_creator: "Revoked from anon/authenticated 2026-08-22.",
  _fill_featured_battle_questions: "Revoked from anon/authenticated 2026-08-22.",
  _pick_featured_subject: "Revoked from anon/authenticated 2026-08-22.",
  _seed_featured_battle_for_class: "Revoked from anon/authenticated 2026-08-22.",

  // rpc_* functions confirmed to use ownership-via-auth.uid() scoping rather
  // than school_id scoping -- a legitimate, different model for
  // participant/session/assignment-owned data, not a gap. Spot-checked
  // bodies individually 2026-08-22.
  rpc_finish_battle: "Resolves the acting participant row and checks battle_participants.user_id = auth.uid() before any write; ownership-scoped, not school-scoped, by design (a battle's participants can legitimately span the challenger's and opponent's own contexts). Read body 2026-08-22.",

  // Self-contained authorization checks that don't use auth.uid()/has_role
  // but do gate correctly by another mechanism -- read bodies 2026-08-22.
  ai_kms_complete_chunk_embed: "Body starts with `IF current_user <> 'service_role' AND coalesce(auth.role(),'') <> 'service_role' THEN RAISE EXCEPTION`; a non-service-role caller (anon/authenticated) hits this immediately regardless of grants.",
  ai_kms_defer_unset_embeddings: "Same service_role-only guard as ai_kms_complete_chunk_embed.",
  rpc_create_class_group: "Thin wrapper -- immediately delegates to rpc_ensure_class_group, which checks auth.uid(), get_my_school_id(), and chat_can_create_class_group() before any write.",
  rpc_create_teacher_group: "Thin wrapper -- immediately delegates to rpc_ensure_teacher_group, which checks auth.uid(), get_my_school_id(), and the caller's role before any write.",

  // No user-identifying parameters at all -- nothing for an attacker to
  // target regardless of who calls them.
  _generate_battle_code: "No parameters; generates a random code, no table read scoped to any user.",
  _enforce_duel_capacity: "No parameters; checks/enforces a global capacity limit, not user-specific.",
  _backfill_dpp_question_concepts: "No parameters; same pattern over the global dpp_questions catalog.",

  // --- Gap-closure sweep, 2026-08-22: individually read every one of these
  // (the last of the originally-flagged 114). Each is self-scoped -- every
  // query is filtered to `user_id = auth.uid()` (or a table already scoped
  // that way, e.g. chat_participants.user_id), and any additional
  // parameter (a session/source/battle/class id) is used only as an EXTRA
  // filter alongside that self-scoping, never as the sole lookup key -- a
  // foreign id yields zero rows, not someone else's data. None of these
  // take an arbitrary target-user-id the way the fixed functions above
  // did. Fixed the genuinely unsafe ones (12 admin/principal-bypass RPCs +
  // 2 community-vote functions + battle_participants RLS + the
  // rpc_*_concept_analytics nested-aggregate bug) earlier in this same
  // sweep; these are the remainder, confirmed safe by reading the body.
  rpc_student_academic_snapshot: "Self-scoped: _uid := auth.uid(), every query filtered to that uid. Read body 2026-08-22.",
  rpc_compute_session_analytics: "Self-scoped; _session_id is an additional filter alongside user_id = auth.uid(), never the sole key.",
  rpc_get_concept_recovery_report: "Self-scoped; _source_id is an additional filter alongside user_id = auth.uid().",
  rpc_post_assessment_concept_analysis: "Self-scoped; same pattern as rpc_get_concept_recovery_report.",
  rpc_save_practice_session: "WHERE id = _session_id AND user_id = auth.uid() -- ownership-scoped.",
  rpc_record_concept_mistake: "Self-scoped via auth.uid(); _source_id/_question_id are opaque grouping keys, not lookups into another user's data (read body earlier this session).",
  rpc_challenge_student: "Explicitly checks student_class_id(_opponent_user_id) matches the caller's own class before allowing a challenge -- can't target a cross-class/cross-school opponent (read body 2026-08-22).",
  rpc_accept_battle_invite: "Checks _inv.invited_user_id = auth.uid() before accepting -- ownership-scoped (read body 2026-08-22).",
  rpc_mark_group_messages_read: "WHERE conversation_id = _id AND user_id = auth.uid() -- only ever touches the caller's own read receipt.",
  rpc_record_community_doubt_view: "Self-scoped view-count increment; worst case is a 1-count inflation on a foreign school's doubt, not a data leak. Read body 2026-08-22.",
  require_active_profile: "No parameters; operates on the caller's own profile via auth.uid().",
  get_chat_unread_total: "No parameters; auth.uid()-scoped unread count for the caller only.",
  rpc_cache_agent_insight: "Self-scoped agent-insight cache keyed by auth.uid().",
  rpc_get_cached_agent_insight: "Self-scoped; same cache as rpc_cache_agent_insight.",
  rpc_get_academic_brain: "No parameters; self-scoped via auth.uid().",
  rpc_academic_revision_plan: "No parameters; self-scoped via auth.uid().",
  rpc_student_performance_charts: "No parameters; self-scoped via auth.uid().",
  rpc_student_revision_queue: "No parameters; self-scoped via auth.uid().",

  // The 7C recovery/revision engine. chapter_state, recovery_sessions and
  // revision_sessions all carry school_id and all have the same RESTRICTIVE
  // tenant fence, but none of these three functions names it — they do not
  // have to. Each resolves the student from auth.uid() and takes no argument
  // that could point at another row, so there is nothing for a school_id
  // predicate to narrow that auth.uid() has not already narrowed to one user.
  rpc_student_chapter_states: "No parameters; self-scoped via auth.uid(). Reads chapter_state/chapters/curriculum_subjects for that one user only.",
  rpc_student_recovery_queue: "No parameters; self-scoped via auth.uid(). Groups the caller's own open student_mistakes and LEFT JOINs their own chapter_state.",
  rpc_student_practice_analytics:
    "Every one of its six aggregates filters `WHERE qa.user_id = _uid` or `WHERE sm.user_id = _uid`, with `_uid := auth.uid()` and a RAISE when it is null. It reads question_attempts and student_mistakes and returns only the caller's own rows, so it is OWNER-scoped — strictly tighter than a school predicate, which any of thousands of same-school users can satisfy. It takes no arguments at all, so there is no target parameter to point at another student. Adding same_school() would narrow nothing and would restate the fence twice (G9), and it would be the wrong fence: what this returns (per-topic accuracy, per-question times, the questions a student keeps getting wrong) is the student's alone under §10.8, not their school's. Checkable: the body must contain `_uid uuid := auth.uid()` and every FROM must be followed by a `user_id = _uid` predicate; it must NOT contain has_role, teacher_teaches_class or any _student_id/_user_id parameter. First read 2026-09-19 (20261040000000, on claude/busy-shannon-nymdhd); re-read 2026-09-22 after 20261045000000 regrouped by_topic by (topic, chapter), which added no table and no parameter.",

  // Takes two ids and reads them BOTH under auth.uid() before touching
  // anything: the recovery session by (id, user_id), the practice session by
  // (id, user_id), and the answers by (session_id, user_id). The tier counts
  // are then joined to that recovery session's own stored question ids, so a
  // handed-over id belonging to somebody else selects nothing rather than
  // scoring something. Its writes are UPDATE ... WHERE id = the row already
  // proved to be the caller's, and chapter_state WHERE user_id = auth.uid().
  // There is no argument through which another school's row is reachable, so
  // there is nothing for a school_id predicate to narrow. Read body 2026-09-14.
  rpc_submit_recovery_session: "Every read and write is scoped to auth.uid() before use; the two id arguments are verified against the caller and the per-tier counts join to that session's own stored question ids.",

  // BEFORE INSERT/UPDATE on student_mistakes. It reads exactly one row of
  // question_bank — WHERE qb.id = NEW.question_id — and writes only
  // NEW.chapter_id. question_bank is the shared national bank and carries no
  // school_id of its own, so there is no tenant column to predicate on, and
  // the only row it can reach is the one the writer already named. The
  // student_mistakes row itself is fenced by that table's own policy.
  tg_student_mistakes_set_chapter_id: "Trigger on student_mistakes: derives NEW.chapter_id from the one question_bank row NEW.question_id names. Writes only NEW; reads no tenant-scoped row.",

  // Dropped from the database by 20260926000000_one_recovery_engine.sql along
  // with recovery_assignments and recovery_assignment_questions. This linter
  // scans migration FILES, so the CREATE statements that defined them are
  // still on disk and still scanned; the functions themselves no longer
  // exist and cannot be called. Verified live after the drop: zero functions
  // in pg_proc mention recovery_assignment at all.
  rpc_assign_concept_recovery: "Dropped by 20260926000000; only the historical CREATE in 20260821120000 remains on disk.",
  rpc_complete_recovery_assignment: "Dropped by 20260926000000; only the historical CREATE remains on disk.",
  rpc_get_recovery_assignment: "Dropped by 20260926000000; only the historical CREATE in 20260617000000 remains on disk.",
  rpc_student_recovery_zone: "Dropped by 20260926000000; only the historical CREATE in 20260802330000 remains on disk.",
  rpc_submit_recovery_answer: "Dropped by 20260926000000; only the historical CREATE remains on disk.",
  rpc_complete_revision: "Dropped by 20260926000000 together with its only caller, PracticeService.completeRevision; only the historical CREATE in 20260616000000 remains on disk.",
  rpc_student_improvement_plans: "No parameters; self-scoped via auth.uid().",
  rpc_student_concept_mastery: "No parameters; self-scoped via auth.uid().",
  rpc_weak_areas_v2: "No parameters; self-scoped via auth.uid().",
  rpc_revision_plan_v2: "No parameters; self-scoped via auth.uid().",
  rpc_recovery_v2: "No parameters; self-scoped via auth.uid().",
  rpc_list_practice_history: "No target-user parameter; self-scoped via auth.uid().",
  rpc_refresh_academic_brain: "No parameters; self-scoped via auth.uid(). Also independently checked for the nested-aggregate bug found in the two _concept_analytics functions -- already uses the correct row_data/plain-column ORDER BY pattern.",
  rpc_create_template_solo_battle: "Creates a battle owned by the caller (creator_user_id = auth.uid()); no cross-user target.",
  rpc_set_featured_badges: "Self-scoped; sets the caller's own featured badge selection via auth.uid().",
  rpc_set_equipped_badge:
    "Self-scoped, and strictly tighter than an institution predicate: _uid is auth.uid() with no target-user parameter at all, and every statement is keyed to it -- the earned-badge check reads student_badges WHERE user_id = _uid, and the write is UPDATE student_xp ... WHERE user_id = _uid. One person, where same_school() would admit thousands. Same shape and same reason as rpc_set_featured_badges directly above, for the neighbouring column on the same table; it exists because 20260905000000_xp_engine_owned.sql revoked the client's direct write to student_xp, so equip needed a definer path. school_id is set, when the row is first created, by _ensure_student_xp from the student's own record. Read body 2026-09-04.",
  rpc_classmates: "Self-scoped; resolves the caller's own class via auth.uid() before listing classmates in that same class.",
  rpc_battle_feed: "uses_teacher_scope_helper; already gated by role + class-teacher check, no cross-school target parameter.",
  rpc_battle_curriculum: "Global curriculum/topic catalog (one overload since 20261020010000), no user-specific data -- same reasoning as rpc_pick_question_templates.",
  rpc_pick_question_templates: "Global question_templates catalog by subject/class/chapter, no user-specific data.",
  process_pending_academic_events: "Platform queue worker, not a request handler: it drains academic_events for every institution, so there is no correct institution to scope to. Since 20260925120000_the_event_queue_is_drained_by_a_scheduler.sql its only caller is pg_cron job process-pending-academic-events, every minute; EXECUTE is revoked from PUBLIC, anon and authenticated and held by service_role, and the client-side sync engine that used to drain it on page loads is deleted. FOR UPDATE SKIP LOCKED prevents cross-worker double-processing. That migration's verify refuses a signed-in and an anon drain.",
  rpc_rotate_featured_battles: "Confirmed caller: battleExperienceService.ts, client-triggered lazy-scheduler pattern (the one scheduled homework used until 20260925100000 moved it to a pg_cron job). Idempotent UPDATE on globally-shared featured-battle state, not per-tenant.",
  rpc_refresh_featured_battles: "Same lazy-scheduler pattern and caller as rpc_rotate_featured_battles.",
  rpc_ensure_featured_battles_all: "Checks auth.uid() and resolves the caller's own class via student_class_id() -- self-scoped despite touching the shared featured-battle system.",
  rpc_parent_concept_analytics: "has_role('admin') is a GATE to enter the function (parent OR admin), not a data-access bypass -- the actual query is `WHERE s.parent_user_id = _parent OR EXISTS(parent_students...)` keyed on _parent := auth.uid() regardless of role, so an admin who isn't also a linked parent just gets zero rows back, not another school's data. Re-read 2026-08-22 specifically to distinguish this from the 12 fixed admin-bypass functions.",
  rpc_parent_weekly_digest: "Same gate-not-bypass pattern as rpc_parent_concept_analytics.",

  // --- Chunk 7C-C part 1, 2026-08-29 ---
  // All three are SECURITY INVOKER, which is not a footnote here but the whole
  // design. An invoker function cannot bypass RLS, so every table it touches is
  // read under the caller's own rights and each table's own fence applies. The
  // claim is cross-checkable by a DIFFERENT gate rather than by reading this
  // sentence: lint-definer-doors.mjs inventories every SECURITY DEFINER in the
  // schema, and none of these three appears in it.
  _recovery_chapter_is_mine:
    "SECURITY INVOKER (no DEFINER clause in 20260829310000; absent from lint-definer-doors' definer inventory, which is the cross-check). Touches chapters — a G2 GLOBAL table with no school_id to predicate on — plus section_subjects and students, both of which carry their own RESTRICTIVE tenant fences that apply BECAUSE this runs as the caller. Adding a school_id predicate would restate those fences a second time, which is the G9 shape this lint exists downstream of. What the body does add is strictly TIGHTER than an institution predicate: st.user_id = auth.uid() identifies one person, where same_school() is satisfied by any of thousands of same-school users. Probed live 2026-08-29 as the demo student: students=1 row visible (own only), section_subjects=7 (own school), chapters=665 (global).",
  _recovery_variant_pool:
    "SECURITY INVOKER. Reads question_bank and nothing else — a G2 GLOBAL table with NO school_id column (7A: 'Shared across every school. No institution_id'), so there is no tenant predicate to add. Since 20261049000000 dropped qb_select_approved_board, question_bank has NO policy a student satisfies, so the old reason given here — 'the board filter lives in that policy and applies because this is not a definer' — no longer holds, and it never held on the path that matters: this is only ever called from _recovery_session_plan_for under the definer rpc_start_recovery_session, where it reads as the owner. What scopes the result is its own WHERE: source_question_id = the student's own mistake's question, the tier, is_active and not replaced, so it can only return variants of a question the caller already got wrong. Called directly by a student it returns nothing at all (no readable bank rows), so it can widen nothing. Re-read live 2026-09-22.",
  _student_difficulty_rank:
    "Owner-scoped by construction, and tighter than a school predicate. It takes ONE argument, a chapter id, and reads `auth.uid()` itself — there is no user-id parameter to point at another student. Both of its queries filter `qa.user_id = _uid` over question_attempts joined to question_bank (G2 GLOBAL, no school_id column), and it returns a single integer 1-3: the mean difficulty of the questions this caller has answered, which is a fact about the caller and nobody else. A same_school() predicate would widen nothing and would restate a fence that auth.uid() already closes (G9), and §10.8 makes practice the student's own rather than their school's — the same reason rpc_student_practice_analytics carries above. With no JWT subject it returns 2 (medium) without reading a row. Checkable: the body must contain `_uid uuid := auth.uid()`, every FROM public.question_attempts must be followed by `qa.user_id = _uid`, and it must declare no _user_id/_student_id parameter. NOT YET APPLIED — the migration is written and blocked on the database token (KNOWN_ISSUES 75, 81).",
  send_learning_reminders:
    "Platform maintenance job, not a request handler: the 'learning-reminders' cron entry (daily, 04:00 UTC = 09:30 IST, 20261057000000) writes ONE batched revision/recovery reminder per student per day (§4.1b, §5, §9). It takes no parameters at all, so there is nothing a caller could point at another tenant, and there is no single institution to scope a platform-wide sweep to — it must consider every student. Nothing is mixed: each notification it writes names its own recipient, and _notify derives that row's school_id from the recipient's own profile, so the tenant of every row is the student's own. It reads chapter_state, recovery_sessions and notifications, all per user_id, and writes nothing else. Reachable only by cron: EXECUTE is revoked from PUBLIC, anon and authenticated in the same migration. Same shape and same reason as dispatch_notification_push beside it. NOT YET APPLIED — the migration is written and blocked on the database token (KNOWN_ISSUES 75, 81); re-read it against live when it lands.",
  dispatch_notification_push:
    "Platform maintenance job, not a request handler: the 'push-notifications-to-phones' cron entry (every minute, 20260925190000) settles notifications older than 30 minutes and hands the rest to the notification-push edge function with the drain secret from vault — which is why it is a definer. It carries no tenant parameter and there is no single institution to scope a platform-wide queue drain to; each notification it forwards already names its own recipient, so nothing is mixed across tenants downstream. Structurally unreachable by any user: EXECUTE is revoked from PUBLIC, anon and authenticated (measured live 2026-09-18: anon=false, authenticated=false, service_role=true). Same shape and same reason as dispatch_variant_generation and dispatch_question_embedding beside it.",

  // --- The generated-question door and its drain, 2026-09-17/18 ---
  store_generated_questions:
    "The one write door into question_bank for AI-generated questions, and question_bank is a G2 GLOBAL table with no school_id to scope to — a variant generated for one student's mistake is shared with every school by design (§4.2: 'every variant is saved to the shared bank so the cache warms and cost falls'). It takes nothing from a caller that could name a tenant: the class, subject, board and chapter of every row it writes are DERIVED from the source question's own topic through the curriculum tree, and a row whose labels disagree with that topic is skipped with a reason rather than stored. Reachable only by the generators: EXECUTE is revoked from PUBLIC, anon and authenticated (measured live 2026-09-18: anon=false, authenticated=false, service_role=true), so its callers are the ai-recovery-variants edge function and the variant-generation cron, both service_role. 20261020020000's own proof asserts the derivation (2 inserted, 6 skipped) and that a sabotaged copy fails.",

  // --- Practice pickers and the embedding drain, 2026-09-17/18 ---
  rpc_practice_bank_catalog:
    "SECURITY DEFINER since 20261050000000 (it was an invoker until 20261049000000 dropped the only policy that let a student read question_bank, after which it returned zero rows and the practice picker was empty). Reads question_bank and nothing else — G2 GLOBAL, no school_id column — and returns no user data: one row per (subject, chapter) with a count, never a question, an option or an answer. The class, board, stream and subject are PARAMETERS: the app passes the student's own resolved scope (practiceService.listBankCatalog), but a caller could pass another board and see that board's chapter counts. The bank is shared across schools by design, so that exposes nothing private; it is nevertheless a second home for 'which board is this student', disagreeing in principle with question_bank_student, which derives the board from the caller's school. Re-read live 2026-09-22; the one-home fix (derive the board from get_my_school_id(), drop the parameter) is a migration waiting on database access (HANDOFF, release 2026-09-22).",
  dispatch_question_embedding:
    "Platform maintenance job, not a request handler: the 'embed-pending-questions' cron entry calls it to hand question_bank rows awaiting an embedding to the question-embedding-drain edge function. It touches question_bank, a G2 GLOBAL table with no school_id to scope to, and reads the drain secret from vault — which is why it is a definer. Structurally unreachable by any user: EXECUTE is revoked from PUBLIC, anon and authenticated (measured live 2026-09-18: anon=false, authenticated=false, service_role=true), so the only callers are cron and service_role. Same shape as dispatch_variant_generation and dispatch_notification_push beside it.",
  rpc_recovery_session_plan:
    "SECURITY INVOKER, one line: SELECT _recovery_session_plan_for(auth.uid(), _chapter_id) — the caller's own id, never a parameter. What it reads: student_mistakes filtered user_id = _uid (the caller), and question_bank (G2 global, no school_id). Entitlement comes first: _recovery_chapter_is_for raises unless the chapter is taught to, or was practised by, the caller's own section (CHUNK7C_C1_VERIFY item 6 asserts the RAISE). Since 20261049000000 no student-facing policy on question_bank exists, so a student calling this directly gets a plan built from their own mistakes and an empty bank — degraded, never wider. The app does not call it: recovery starts through the definer rpc_start_recovery_session (src/academic/services/recoveryEngineService.ts). Re-read live 2026-09-22.",

  // --- Chunk 7F, 2026-09-15 ---
  // The loop was rebuilt so a recovery session is prepared when the practice
  // session ENDS. That step runs as a background part of the finish path,
  // where auth.uid() is not available, so the two functions above were split
  // into an implementation taking the user explicitly and an auth.uid() form
  // delegating to it. These are the implementations.
  _recovery_chapter_is_for:
    "SECURITY INVOKER (no DEFINER clause in 20261009000000 or 20261044000000; absent from lint-definer-doors' definer inventory, which is the cross-check). A chapter is the student's if it is taught to their section OR they have practised it (20261044000000, KNOWN_ISSUES 58). The taught half touches chapters (G2 GLOBAL, no school_id to predicate on) plus section_subjects and students, both of which carry their own RESTRICTIVE tenant fences that apply BECAUSE this runs as the caller. The practised half reads question_attempts filtered to user_id = _uid — under an invoker caller its own policy admits only the caller's rows — joined to question_bank, a G2 GLOBAL table with no school_id column at all. The _uid parameter does not widen either half: the fences still bound what this caller can see of students, section_subjects and question_attempts, so passing another user's id returns false rather than that user's entitlement. Practice serves only the student's own class, so a practised chapter is never another class's content. Its callers are _recovery_chapter_is_mine (auth.uid()) and _recovery_session_plan_for, which passes the student's own id. 20261044000000's proof asserts that a chapter neither taught nor practised is still refused, as the student.",
  _enqueue_variant_generation:
    "SECURITY DEFINER, and callable by nobody: 20261012000000 REVOKEs it from anon and authenticated, so the only caller is _ensure_recovery_session inside the practice-finish path. It reads question_bank and writes variant_generation_queue, and NEITHER carries a school_id. question_bank is a G2 GLOBAL table (7A: 'Shared across every school. No institution_id'); the queue is keyed on (source question, tier) and deliberately not on the student, because §4.2a's economics depend on one generation serving every student who fails that question — adding a school_id would be the bug, not the fix, since it would make forty schools pay forty times for the same variant. The jsonb plan it is handed is produced by _recovery_session_plan_for for one named student, so the question ids it can reach are that student's own mistakes.",
  dispatch_variant_generation:
    "SECURITY DEFINER cron drain, REVOKEd from anon and authenticated by 20261012000000; its only caller is the pg_cron job drain-variant-generation, running as postgres. It touches variant_generation_queue (no school_id — see above) and reads question_bank (G2 global, no school_id column exists) to resolve finished jobs. It reads no per-student table at all: a job names a QUESTION and a tier, never a user, which is the whole point of caching by question. The one credential it handles is the vault secret variant_generation_drain, deliberately not the service-role key, so a reader of pg_proc finds a single-purpose token rather than a master one. Same shape as dispatch_notification_push, already in production.",
  rpc_revision_session_plan:
    "SECURITY INVOKER (no DEFINER clause in 20261008000000). Reads student_mistakes (own rows only, via its user_id = auth.uid() policy), question_bank (G2 GLOBAL, no school_id column to predicate on, board-filtered by qb_select_approved_board because this is not a definer), question_attempts (own rows only, same shape) and chapter_state (own rows only). Every row in reach is either the caller's own or a globally shared bank question, so there is no other tenant's data to predicate against. Entitlement is enforced BEFORE any read by _recovery_chapter_is_mine, which raises rather than filtering — the same fence rpc_recovery_session_plan carries, and for the same reason: a Class 5 student must never be served Class 8 content, enforced in the query layer. CHUNK7F_REVISION_CONTENT_VERIFY drives it under set_config('request.jwt.claims') as a real student, so the policies are live during that suite.",
  _recovery_session_plan_for:
    "SECURITY INVOKER. The body of rpc_recovery_session_plan with auth.uid() lifted into a parameter; the entry above is now a one-line delegation to it. Reads student_mistakes and question_bank, exactly as before. student_mistakes' own policy is user_id = auth.uid(), which is what actually bounds the read — so under a caller who is not _uid the function returns an empty ladder rather than another student's mistakes, and the _uid parameter cannot be used to read across users. Entitlement is still enforced before any read, by _recovery_chapter_is_for. CHUNK7F_LADDER_SIZED_BY_MISTAKES_VERIFY drives it under set_config('request.jwt.claims') as a real student, so the policy is live during that suite rather than bypassed.",
};

// Lower-priority, NOT fixed by this audit (documented, not silently ignored):
// process_pending_academic_events, rpc_refresh_featured_battles,
// rpc_rotate_featured_battles have no auth.uid() check and no service_role
// guard, so any authenticated (or anon) caller can trigger them on demand.
// All three operate on GLOBAL, non-tenant-scoped state (a shared event queue
// / the shared featured-battle rotation), so unauthorized triggering forces
// early/duplicate processing rather than leaking or corrupting any one
// school's data -- annoying, not a tenant-isolation breach. Left off the
// allowlist deliberately (they still show up in the FAIL list below) rather
// than allowlisted, since "low impact" isn't the same as "confirmed safe" --
// they should still eventually get a service_role-only guard.

function listMigrationFiles() {
  return readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort(); // filename timestamp prefix == chronological order == CREATE OR REPLACE supersession order
}

/** Extract every top-level CREATE [OR REPLACE] FUNCTION public.<name>(...) ... $$ ... $$; block. */
function extractFunctions(sql, file) {
  const out = [];
  const re = /CREATE\s+(?:OR\s+REPLACE\s+)?FUNCTION\s+public\.(\w+)\s*\(/gi;
  let m;
  while ((m = re.exec(sql))) {
    const name = m[1];
    const startIdx = m.index;
    // Body is delimited by a dollar-quote tag (AS $$ ... $$; or AS $function$ ... $function$;).
    const tagMatch = sql.slice(m.index).match(/AS\s+(\$[a-zA-Z_]*\$)/);
    if (!tagMatch) continue;
    const tag = tagMatch[1];
    const bodyStart = m.index + tagMatch.index + tagMatch[0].length;
    const bodyEndRel = sql.slice(bodyStart).indexOf(tag);
    if (bodyEndRel === -1) continue;
    const fullDef = sql.slice(startIdx, bodyStart + bodyEndRel + tag.length);
    out.push({ name, file, def: fullDef });
  }
  return out;
}

function touchesSchoolScopedTable(def) {
  const lower = def.toLowerCase();
  return SCHOOL_SCOPED_TABLES.some((t) => {
    const re = new RegExp(`\\b(from|join|into|update|references)\\s+(public\\.)?${t}\\b`, "i");
    return re.test(lower);
  });
}

function mentionsSchoolId(def) {
  return /school_id/i.test(def);
}

function main() {
  const files = listMigrationFiles();
  const latestByName = new Map(); // name -> { file, def }

  for (const file of files) {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8");
    for (const fn of extractFunctions(sql, file)) {
      latestByName.set(fn.name, fn); // later files overwrite earlier ones for the same name
    }
  }

  const flagged = [];
  const allowlisted = [];
  for (const [name, fn] of latestByName) {
    if (!touchesSchoolScopedTable(fn.def)) continue;
    if (mentionsSchoolId(fn.def)) continue;
    if (ALLOWLIST[name]) {
      allowlisted.push({ name, file: fn.file, reason: ALLOWLIST[name] });
      continue;
    }
    flagged.push({ name, file: fn.file });
  }

  console.log(`Scanned ${files.length} migration files, ${latestByName.size} distinct function names.\n`);

  if (allowlisted.length) {
    console.log(`${allowlisted.length} allowlisted (touch a tenant table, no school_id, confirmed safe):`);
    for (const a of allowlisted) console.log(`  - ${a.name} (${a.file}): ${a.reason}`);
    console.log("");
  }

  if (flagged.length === 0) {
    console.log("PASS: no unexplained tenant-scoping gaps.");
    process.exit(0);
  }

  console.log(`FAIL: ${flagged.length} function(s) touch a tenant-scoped table with no school_id reference anywhere in their body:`);
  for (const f of flagged) console.log(`  - ${f.name}  (defined in ${f.file})`);
  console.log(
    "\nEach one needs either a real fix (add a school_id parameter/predicate, matching " +
      "the table's own RLS policy) or an ALLOWLIST entry above with a specific, checkable reason.",
  );
  process.exit(1);
}

main();
