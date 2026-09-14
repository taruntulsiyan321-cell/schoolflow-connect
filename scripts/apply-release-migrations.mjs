// Applies this release's sixteen migrations to the live project — the ten of the
// test feature, then the six of homework — in order, stopping at the first one
// that does not hold.
//
// WHY A RUNNER AND NOT SIXTEEN COMMANDS
//   The order matters — 20260925040000 redefines a function 20260925000000
//   installed, 20260925060000's policy calls a function 20260925030000 creates,
//   and each homework migration builds on the one before — and a human applying
//   sixteen files by hand will eventually skip one. Every file is still applied
//   by `apply-one-migration.mjs`: this loops that, it does not reimplement it
//   (one applier, one ledger writer).
//
// EACH FILE PROVES ITSELF. They carry DO blocks that build a fixture, exercise
// the thing they changed, assert on what came back and roll the fixture back —
// and RAISE if an assertion fails, which rolls the whole file back (the
// Management API runs a file as one implicit transaction). So a failure here
// means the change did not do what it claims on THIS database, and stopping is
// the right response: the files after it assume it landed.
//
// THE LEDGER is `public.schema_migrations`, one row per file, `version` holding
// the file name without `.sql`. A file counts as applied only when its FULL name
// is there. A different migration recorded under the same timestamp is a version
// collision — another branch's work — and stops the run before anything is
// applied, rather than being mistaken for this file.
//
//   node scripts/apply-release-migrations.mjs            apply
//   node scripts/apply-release-migrations.mjs --check    preconditions only
import { readFileSync, existsSync } from "fs";
import { spawnSync } from "child_process";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const CHECK_ONLY = process.argv.includes("--check");
const PROJECT_REF = process.env.PROJECT_REF || process.env.VITE_SUPABASE_PROJECT_ID?.replace(/"/g, "") || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

/** In dependency order. Do not sort this by anything but the timestamp. */
const FILES = [
  // The test feature (docs/gurukul-spec-rules.md, "The test flow — RULED 2026-09-12").
  "20260925000000_a_test_answer_is_school_data_and_the_report_stops_lying.sql",
  "20260925010000_one_activity_bump_not_two.sql",
  "20260925020000_an_online_test_is_all_mcq_and_marks_are_whole.sql",
  "20260925030000_the_class_sees_the_test_leaderboard.sql",
  "20260925040000_the_principal_sees_the_marks_not_the_paper.sql",
  "20260925050000_a_student_can_review_the_paper_they_handed_in.sql",
  "20260925060000_a_classmates_mark_is_readable_once_you_have_sat_the_test.sql",
  "20260925070000_the_tests_list_knows_what_it_is_showing.sql",
  "20260925080000_a_submitted_paper_reaches_the_other_screens.sql",
  "20260925090000_the_report_says_which_question_cost_the_class_its_time.sql",
  // Homework (docs/gurukul-spec-rules.md, "Homework — RULED 2026-09-13").
  "20260925100000_homework_reaches_students_only_when_published.sql",
  "20260925110000_homework_is_one_file_and_two_decisions.sql",
  "20260925120000_the_event_queue_is_drained_by_a_scheduler.sql",
  "20260925130000_homework_is_counted_in_one_place.sql",
  "20260925140000_a_handed_in_file_cannot_change.sql",
  "20260925150000_the_family_is_told_accepted_or_rejected.sql",
];

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(2);
}

// ── Preconditions, each named rather than left to fail obscurely ────────────
for (const file of FILES) {
  if (!existsSync(`supabase/migrations/${file}`)) fail(`Missing migration file: supabase/migrations/${file}`);
  const rollback = `supabase/migrations/rollback/${file.replace(/\.sql$/, ".rollback.sql")}`;
  if (!existsSync(rollback)) fail(`Missing rollback: ${rollback}. Every file in this release ships one.`);
}

if (!TOKEN) {
  fail(
    "No SUPABASE_ACCESS_TOKEN.\n" +
      "  Put it in .env.local (it is gitignored, and must never be a repository secret):\n" +
      "      SUPABASE_ACCESS_TOKEN=sbp_...\n" +
      "  Create one at https://supabase.com/dashboard/account/tokens",
  );
}

const probe = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}`, {
  headers: { Authorization: `Bearer ${TOKEN}` },
}).catch((e) => ({ ok: false, status: 0, text: async () => String(e.message) }));

if (!probe.ok) {
  const body = (await probe.text()).slice(0, 300);
  fail(
    `Cannot reach the project (HTTP ${probe.status}).\n  ${body}\n\n` +
      "  A 403 saying \"Host not in allowlist\" is the ENVIRONMENT, not the token:\n" +
      "  add api.supabase.com (and *.supabase.co) to the network egress settings\n" +
      "  of this Claude Code environment, or run this from a machine without that\n" +
      "  restriction.",
  );
}

const ledgerRes = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: `SELECT version FROM public.schema_migrations ORDER BY version` }),
});
if (!ledgerRes.ok) fail(`Could not read public.schema_migrations (HTTP ${ledgerRes.status}): ${(await ledgerRes.text()).slice(0, 300)}`);
const ledger = (JSON.parse(await ledgerRes.text()) || []).map((r) => String(r.version));
const applied = new Set(ledger);

const collisions = [];
for (const file of FILES) {
  const version = file.replace(/\.sql$/, "");
  const stamp = version.split("_")[0];
  for (const row of ledger) if (row.split("_")[0] === stamp && row !== version) collisions.push(`${file}  <->  ledger ${row}`);
}

console.log(`project ${PROJECT_REF}`);
const done = FILES.filter((f) => applied.has(f.replace(/\.sql$/, "")));
console.log(`already in the ledger: ${done.length ? done.join(", ") : `none of the ${FILES.length}`}`);
if (collisions.length) {
  fail(`VERSION COLLISION — another migration is recorded under this release's timestamps:\n  ${collisions.join("\n  ")}\n  Renumber before applying anything.`);
}

if (CHECK_ONLY) {
  console.log("\n--check: preconditions hold. Re-run without --check to apply.");
  process.exit(0);
}

for (const file of FILES) {
  if (applied.has(file.replace(/\.sql$/, ""))) {
    console.log(`── ${file}\n     already applied, skipping`);
    continue;
  }
  console.log(`── ${file}`);
  const r = spawnSync("node", ["scripts/apply-one-migration.mjs", `supabase/migrations/${file}`], {
    stdio: "inherit",
    env: process.env,
  });
  if (r.status !== 0) {
    fail(
      `STOPPED at ${file} (exit ${r.status}).\n` +
        "  Its own proof block refused to commit, so nothing from this file was\n" +
        "  written and the files after it have NOT been applied. Read the error\n" +
        "  above: it names the assertion that did not hold on this database.\n" +
        `  Rollbacks for anything already applied: supabase/migrations/rollback/`,
    );
  }
}

console.log(
  `\nAll ${FILES.length} applied. Now run, in this order:\n` +
    "  npm run db:check-migrations        # the ledger agrees with the files\n" +
    "  npm run verify:caller-privileges   # probe43 homework, probe44 the test journey\n" +
    "  npm run db:verify-integrity\n" +
    "  then deploy ai-gateway and mcp, which read the new schema",
);
