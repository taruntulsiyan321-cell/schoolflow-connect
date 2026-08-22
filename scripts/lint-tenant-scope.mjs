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
};

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
