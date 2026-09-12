// Applies the eight 2026-09-20 test-flow migrations to the live project, in
// order, stopping at the first one that does not hold.
//
// WHY A RUNNER AND NOT EIGHT COMMANDS
//   The order matters — 20260920040000 redefines a function 20260920000000
//   installed, and 20260920060000's policy calls a function 20260920030000
//   creates — and a human applying eight files by hand at 1am will eventually
//   skip one. Every file is still applied by `apply-one-migration.mjs`: this
//   loops that, it does not reimplement it (one applier, one ledger writer).
//
// EACH FILE PROVES ITSELF. They carry DO blocks that build a fixture, exercise
// the thing they changed as the real caller, assert on what came back and clean
// up — and RAISE if the assertion fails, which rolls the file back. So a
// failure here means the change did not do what it claims on THIS database, and
// stopping is the right response: the files after it assume it landed.
//
//   node scripts/apply-test-flow-migrations.mjs            apply
//   node scripts/apply-test-flow-migrations.mjs --check    preconditions only
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
  "20260920000000_a_test_answer_is_school_data_and_the_report_stops_lying.sql",
  "20260920010000_one_activity_bump_not_two.sql",
  "20260920020000_an_online_test_is_all_mcq_and_marks_are_whole.sql",
  "20260920030000_the_class_sees_the_test_leaderboard.sql",
  "20260920040000_the_principal_sees_the_marks_not_the_paper.sql",
  "20260920050000_a_student_can_review_the_paper_they_handed_in.sql",
  "20260920060000_a_classmates_mark_is_readable_once_you_have_sat_the_test.sql",
  "20260920070000_the_tests_list_knows_what_it_is_showing.sql",
];

function fail(msg) {
  console.error(`\n${msg}\n`);
  process.exit(2);
}

// ── Preconditions, each named rather than left to fail obscurely ────────────
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

// What the ledger already holds, so a re-run is a no-op rather than a surprise.
const ledger = await fetch(`https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({
    query: `SELECT version FROM public.schema_migrations WHERE version LIKE '202609200%' ORDER BY version`,
  }),
});
const applied = new Set(
  (JSON.parse(await ledger.text()) || []).map((r) => String(r.version)),
);

console.log(`project ${PROJECT_REF}`);
console.log(`already in the ledger: ${applied.size ? [...applied].join(", ") : "none of the eight"}\n`);

if (CHECK_ONLY) {
  console.log("--check: preconditions hold. Re-run without --check to apply.");
  process.exit(0);
}

for (const file of FILES) {
  const version = file.split("_")[0];
  if (applied.has(version)) {
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
        `  Rollback for anything already applied: supabase/migrations/rollback/`,
    );
  }
}

console.log(
  "\nAll eight applied. Now run, in this order:\n" +
    "  npm run db:check-migrations        # the ledger agrees with the files\n" +
    "  npm run verify:caller-privileges   # probe44 is the test journey, 25 claims\n" +
    "  npm run db:verify-integrity",
);
