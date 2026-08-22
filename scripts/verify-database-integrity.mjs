/**
 * Canonical, code-based live-database verification. Every check here is a
 * literal SQL query against the running database, not a claim from a text
 * report -- this exists specifically because several "audit" reports handed
 * to this project during 2026-08-21's production-readiness pass repeated
 * already-refuted or already-fixed claims (a 69% mojibake-corruption claim
 * that never reproduced, a battle-XP double-award claim contradicted by a
 * live unique index, an is_late-forgery claim already closed by a trigger)
 * without ever re-checking current state. Anyone -- a person, a future
 * session, CI -- can run this file and get an answer they can trust, instead
 * of a report they have to independently re-verify from scratch.
 *
 * Run: SUPABASE_ACCESS_TOKEN=... node scripts/verify-database-integrity.mjs
 * Exit code 0 = every check passed. Exit code 1 = at least one failed --
 * see the FAIL lines for exactly what and by how much.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error(
    "\nNo SUPABASE_ACCESS_TOKEN in .env.local -- this script needs Management API\n" +
      "access (bypasses RLS) to check things RLS would otherwise hide, like\n" +
      "cross-tenant leaks or orphaned rows with a null owner column.\n",
  );
  process.exit(1);
}

async function query(sql) {
  const res = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(text.slice(0, 500));
  return JSON.parse(text);
}

let failures = 0;
async function check(label, sql, ok) {
  try {
    const rows = await query(sql);
    const pass = ok(rows);
    console.log(`${pass ? "PASS" : "FAIL"}  ${label}${pass ? "" : "  -- " + JSON.stringify(rows)}`);
    if (!pass) failures++;
  } catch (e) {
    console.log(`ERROR ${label}  -- ${e.message.slice(0, 200)}`);
    failures++;
  }
}

const count = (rows) => Number(rows[0]?.count ?? 0);

async function main() {
  console.log(`Verifying live database integrity against ${PROJECT_REF}\n`);

  // --- Migration ledger completeness (G0-4) ---
  const files = readdirSync(join(ROOT, "supabase", "migrations"))
    .filter((f) => f.endsWith(".sql"))
    .map((f) => f.replace(/\.sql$/, ""));
  const ledgerRows = await query("SELECT version FROM public.schema_migrations").catch(() => []);
  const applied = new Set(ledgerRows.map((r) => r.version));
  const missing = files.filter((f) => !applied.has(f));
  console.log(
    `${missing.length === 0 ? "PASS" : "FAIL"}  Migration ledger covers all ${files.length} local migration files` +
      (missing.length ? `  -- missing: ${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ` (+${missing.length - 5} more)` : ""}` : ""),
  );
  if (missing.length) failures++;

  // --- Phase 1 fixes (supabase/migrations/20260821120000_phase1_verified_fixes.sql) ---
  await check(
    "question_bank.class_level 5/null archived (expect 0 active)",
    "SELECT count(*) FROM question_bank WHERE (class_level=5 OR class_level IS NULL) AND is_active=true",
    (r) => count(r) === 0,
  );
  await check(
    "student_xp.level matches progression_level_for_xp(xp) (expect 0 drift)",
    "SELECT count(*) FROM student_xp WHERE level IS DISTINCT FROM progression_level_for_xp(xp)",
    (r) => count(r) === 0,
  );
  await check(
    "recovery_assignments has no open duplicates (expect 0 groups)",
    "SELECT count(*) FROM (SELECT 1 FROM recovery_assignments WHERE status IN ('pending','in_progress') GROUP BY user_id, subject, concept HAVING count(*)>1) x",
    (r) => count(r) === 0,
  );
  await check(
    "revision_queue.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM revision_queue WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "student_academic_brain.school_id fully backfilled (expect 0 null)",
    "SELECT count(*) FROM student_academic_brain WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "recovery_assignments.school_id fully backfilled (expect 0 null; found by lint-tenant-scope.mjs's first run)",
    "SELECT count(*) FROM recovery_assignments WHERE school_id IS NULL",
    (r) => count(r) === 0,
  );
  await check(
    "dpp_attempts.student_id enforced NOT NULL (expect 0 orphans)",
    "SELECT count(*) FROM dpp_attempts WHERE student_id IS NULL",
    (r) => count(r) === 0,
  );

  // --- Tenant-scoping fix (20260821180000_tenant_scope_semantic_search_rpcs.sql) ---
  await check(
    "match_question_bank has a school_id parameter",
    "SELECT pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE proname='match_question_bank'",
    (r) => (r[0]?.args ?? "").includes("p_school_id"),
  );
  await check(
    "match_ai_answer_cache has a school_id parameter",
    "SELECT pg_get_function_identity_arguments(oid) args FROM pg_proc WHERE proname='match_ai_answer_cache'",
    (r) => (r[0]?.args ?? "").includes("p_school_id"),
  );

  // --- Server-side is_late enforcement ---
  await check(
    "homework_submissions.is_late computed server-side by trigger",
    "SELECT count(*) FROM pg_trigger WHERE tgname='trg_homework_is_late'",
    (r) => count(r) === 1,
  );

  // --- 2026-08-22 code-trace fixes ---
  await check(
    "attendance_locks.school_id is NOT NULL (a nullable lock-scope column would silently bypass the lock-check trigger)",
    "SELECT is_nullable FROM information_schema.columns WHERE table_name='attendance_locks' AND column_name='school_id'",
    (r) => r[0]?.is_nullable === "NO",
  );
  await check(
    "no template-path (bank_question_id null) duplicate question_attempts rows",
    "SELECT count(*) FROM (SELECT 1 FROM question_attempts WHERE bank_question_id IS NULL AND attempt_number IS NOT NULL GROUP BY session_id, attempt_number HAVING count(*) > 1) x",
    (r) => count(r) === 0,
  );

  // --- HIGH-tier fixes (20260821200000_high_tier_verified_fixes.sql) ---
  await check(
    "question_bank has no active duplicate (question, class_level, subject) groups",
    "SELECT count(*) FROM (SELECT 1 FROM question_bank WHERE is_active=true GROUP BY question, class_level, subject HAVING count(*)>1) x",
    (r) => count(r) === 0,
  );
  await check(
    "progression_league_for_xp has hysteresis (295xp, currently silver, stays silver)",
    "SELECT progression_league_for_xp(295, 'silver') AS league",
    (r) => r[0]?.league === "silver",
  );
  await check(
    "progression_league_for_xp old 1-arg overload was dropped (no stale duplicate)",
    "SELECT count(*) FROM pg_proc WHERE proname='progression_league_for_xp' AND pronargs=1",
    (r) => count(r) === 0,
  );
  await check(
    "fees.status has a server-side trigger (can't drift from client writes alone)",
    "SELECT count(*) FROM pg_trigger WHERE tgname='trg_fees_compute_status'",
    (r) => count(r) === 1,
  );

  // --- Claims independently checked and refuted -- asserted here so a
  // regression (or a future audit resurrecting the same false claim) gets
  // caught immediately instead of requiring another multi-hour re-investigation. ---
  await check(
    "question_bank contains no literal U+FFFD replacement character (the '69% mojibake' claim never reproduced)",
    "SELECT count(*) FROM question_bank WHERE question LIKE '%�%' OR chapter LIKE '%�%'",
    (r) => count(r) === 0,
  );

  console.log(`\n${failures === 0 ? "All checks passed." : `${failures} check(s) failed.`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
