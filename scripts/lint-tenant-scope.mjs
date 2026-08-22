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
  "academic_terms", "academic_years", "ai_answer_cache", "ai_budget_quotas", "ai_budget_usage",
  "ai_embedding_jobs", "ai_explanations", "ai_feature_flags", "ai_feedback_signals",
  "ai_kms_documents", "ai_request_decisions", "ai_session_memory", "ai_solution_cache",
  "app_settings", "approval_requests", "attendance", "attendance_audit", "attendance_locks",
  "audit_logs", "battle_answers", "battle_events", "battle_invites", "battle_participants",
  "battle_questions", "battle_reports", "battles", "chat_conversations", "chat_participants",
  "class_timetables", "classes", "community_doubt_answer_attachments", "community_doubt_answers",
  "community_doubt_attachments", "community_doubt_views", "community_doubt_votes",
  "community_doubts", "community_reputation", "concept_mastery", "device_tokens", "dpp_answers",
  "dpp_attempts", "dpp_questions", "dpps", "exams", "fees", "homework", "homework_submissions",
  "learning_resources", "leave_requests", "library_books", "library_checkouts", "marks",
  "message_read_receipts", "messages", "notices", "notifications", "parent_academic_alerts",
  "parent_students", "parents", "practice_sessions", "profiles", "progression_history",
  "progression_league_history", "question_attempts", "question_bank", "question_records",
  "question_templates", "recovery_assignment_questions", "recovery_assignments",
  "revision_queue", "school_activity_feed", "school_calendar_events", "school_complaints",
  "school_inquiries", "staff_attendance", "student_academic_brain", "student_academic_profiles",
  "student_badges", "student_improvement_plans", "student_mistakes", "student_question_history",
  "student_xp", "students", "subjects", "teacher_classes", "teacher_remarks", "teachers",
  "timetable_slots",
];

// Functions confirmed safe despite touching a school-scoped table with no
// school_id reference -- each entry MUST say why, and the why must still be
// true (re-check on any change to the function or its callers).
const ALLOWLIST = {
  ai_embedding_jobs_process_batch:
    "Confirmed 2026-08-21: a single shared service-role-only batch worker (analogous to a cron job), not a per-tenant request handler. FOR UPDATE SKIP LOCKED prevents cross-worker double-claim races; each returned job is already tagged with its own school_id so no cross-tenant data mixing occurs downstream.",
  bump_ai_answer_cache_hit:
    "Confirmed 2026-08-21: SECURITY INVOKER (prosecdef=false) on ai_answer_cache, which has RLS enabled with zero policies -- any authenticated/anon caller's UPDATE is blocked by RLS regardless of the id argument, so the missing school_id check is structurally unreachable, not just unlikely.",

  // --- Phase 5 audit, 2026-08-22 ---
  // Trigger functions: fire per-row on already-authorized INSERT/UPDATE/DELETE
  // of the single NEW/OLD row that triggered them; they never look up other
  // tenants' rows, so a school_id check inside them is a category error, not
  // a missing check. Individually read every body before allowlisting.
  tg_homework_compute_is_late: "Trigger (BEFORE INSERT OR UPDATE on homework_submissions): operates only on NEW, the single row already being written by an already-authorized caller. Confirmed by reading the body (this audit's own fix, 20260822160000).",
  tg_homework_submission_student_guard: "Trigger (BEFORE UPDATE on homework_submissions): compares NEW/OLD on the single row being updated only. Read body 2026-08-22.",
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
  _backfill_battle_question_concepts: "No parameters; one-time/idempotent batch backfill over the global battle_questions catalog, not per-tenant.",
  _backfill_dpp_question_concepts: "No parameters; same pattern over the global dpp_questions catalog.",
  _backfill_question_bank_concepts: "No parameters; same pattern over the global question_bank catalog.",
  _backfill_template_concepts: "No parameters; same pattern over the global question_templates catalog.",
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
