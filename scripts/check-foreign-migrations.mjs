/**
 * PREFLIGHT — what reached production that this working tree does not account for.
 *
 * Run this at the START of every chunk, before building anything.
 *
 * Why it exists: three migrations reached production with no rollback script
 * because a second session applied them while this one was working. Nothing
 * was wrong with either session's work — the failure was that neither could
 * see what the other had done, and "remember to check" is not a mechanism.
 *
 * Four questions, in descending order of how badly you want the answer to be
 * "none":
 *
 *   1. Applied to the database, but NO FILE in this tree.
 *      The schema cannot be reproduced from this repo. A fresh environment
 *      would come up different from production and nobody would know why.
 *
 *   2. Applied, file present, but NOT COMMITTED.
 *      Another session applied it. The file exists only on one machine, which
 *      is the state the build doc calls out by name.
 *
 *   3. Applied, committed, but NO ROLLBACK SCRIPT.
 *      "Migrations must be reversible" — a migration in production with no way
 *      back is a one-way change to a live database.
 *
 *   4. File present but NOT APPLIED.
 *      Usually just pending work; reported, not failed.
 *
 * 1-3 exit non-zero. This is a gate, not a note: a preflight that reports a
 * problem and exits 0 is the skipped-check-reported-as-pass shape again.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs";
import { execSync } from "node:child_process";

const REF = "psqxykzqfvxgsvkmgurn";
const MIG_DIR = "supabase/migrations";
const ROLLBACK_DIR = "supabase/migrations/rollback";
// Chunk 1 of the foundation build — the first migration written under the
// reversibility rule. Everything before it predates the rule.
const FOUNDATION_BUILD_BEGAN = "20260826100000";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split("\n").map((l) => l.trim())
    .filter((l) => l && !l.startsWith("#") && l.includes("="))
    .map((l) => {
      const i = l.indexOf("=");
      let v = l.slice(i + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      return [l.slice(0, i).trim(), v];
    }),
);

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${env.SUPABASE_ACCESS_TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: "SELECT version FROM public.schema_migrations ORDER BY version;" }),
});
const rows = await res.json();
if (!Array.isArray(rows)) {
  console.error("Could not read schema_migrations:", JSON.stringify(rows).slice(0, 200));
  process.exit(1);
}

// The ledger holds a mix of bare timestamps and full filenames, so match on the
// leading timestamp rather than on the whole string.
const stamp = (s) => (s.match(/^(\d{14})/) ?? [])[1] ?? s;

const applied = new Map();               // timestamp -> ledger version string
for (const r of rows) applied.set(stamp(r.version), r.version);

const localFiles = existsSync(MIG_DIR)
  ? readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"))
  : [];
const localByStamp = new Map();          // timestamp -> filename
for (const f of localFiles) localByStamp.set(stamp(f), f);

// A rollback file covers its own timestamp AND every version named inside it.
// 20260828110000_chunk67_batch1_down.sql reverses three migrations in one file
// because they are one logical change taken in three measurements; matching on
// filename alone called two of them unreversed.
const rollbacks = new Set();
if (existsSync(ROLLBACK_DIR)) {
  for (const f of readdirSync(ROLLBACK_DIR).filter((x) => x.endsWith(".sql"))) {
    rollbacks.add(stamp(f));
    for (const m of readFileSync(`${ROLLBACK_DIR}/${f}`, "utf8").matchAll(/(?<!\d)(\d{14})(?!\d)/g)) {
      rollbacks.add(m[1]);
    }
  }
}

// Rollbacks that were never written — acknowledged with the date they were
// found, not quietly excused. They are PRINTED on every run. The point is that
// the gate fails on a NEW gap instead of drowning in old ones; it is not that
// these stopped mattering.
const KNOWN_MISSING_ROLLBACKS = new Map([
  ["20260826100000", "Chunk 1 super-admin window caps — predates this gate"],
  ["20260826110000", "Chunk 1 role binding — predates this gate"],
  ["20260826120000", "Chunk 1.5 converge user_roles — predates this gate"],
  ["20260826130000", "Chunk 1.6 practice privacy — predates this gate"],
  ["20260826230000", "Chunk 5 homework topic_id — predates this gate"],
  ["20260826240000", "Chunk 5 purge job guard — predates this gate"],
  ["20260827120000", "Chunk 6.5 converge exam_group_id — predates this gate"],
  ["20260827130000", "session_start_idempotent — applied by another session"],
  ["20260827140000", "exams_policy_dispatch — applied by another session"],
  ["20260827150000", "marks_policy_dispatch — applied by another session"],
]);

// Tracked-and-clean is the only state that means "this repo actually has it".
const tracked = new Set(
  execSync("git ls-files supabase/migrations", { encoding: "utf8" })
    .split("\n").filter(Boolean).map((p) => p.split("/").pop()),
);
const dirty = new Set(
  execSync("git status --porcelain -- supabase/migrations", { encoding: "utf8" })
    .split("\n").filter(Boolean)
    .map((l) => l.slice(3).trim().replace(/^"|"$/g, "").split("/").pop()),
);

const noFile = [], uncommitted = [], noRollback = [], notApplied = [];

for (const [ts, version] of applied) {
  const file = localByStamp.get(ts);
  if (!file) { noFile.push(version); continue; }
  if (!tracked.has(file) || dirty.has(file)) { uncommitted.push(file); continue; }
  // "Migrations must be reversible" is a rule of THIS build, not a retroactive
  // judgement on 290 migrations written before it existed. Demanding rollbacks
  // for all of them buried the two real findings in noise the first time this
  // ran — a gate whose output nobody can read is a gate nobody reads.
  if (ts >= FOUNDATION_BUILD_BEGAN && !rollbacks.has(ts) && !KNOWN_MISSING_ROLLBACKS.has(ts)) {
    noRollback.push(file);
  }
}
for (const [ts, file] of localByStamp) if (!applied.has(ts)) notApplied.push(file);

const line = (s) => console.log("  " + s);
console.log(`ledger: ${applied.size} applied · tree: ${localByStamp.size} migration file(s) · ${rollbacks.size} rollback script(s)\n`);

if (noFile.length) {
  console.log(`APPLIED WITH NO FILE IN THIS TREE — ${noFile.length}`);
  console.log("  The schema cannot be rebuilt from this repo.");
  noFile.forEach(line);
  console.log();
}
if (uncommitted.length) {
  console.log(`APPLIED BUT NOT COMMITTED — ${uncommitted.length}`);
  console.log("  Applied to production and living on one machine. Likely another session.");
  uncommitted.forEach(line);
  console.log();
}
if (noRollback.length) {
  console.log(`APPLIED WITH NO ROLLBACK SCRIPT — ${noRollback.length}`);
  console.log(`  Expected ${ROLLBACK_DIR}/<same timestamp>_*.sql`);
  noRollback.forEach(line);
  console.log();
}
if (notApplied.length) {
  console.log(`PRESENT BUT NOT APPLIED — ${notApplied.length} (reported, not a failure)`);
  notApplied.forEach(line);
  console.log();
}

const acknowledged = [...KNOWN_MISSING_ROLLBACKS].filter(([ts]) => applied.has(ts));
if (acknowledged.length) {
  console.log(`KNOWN MISSING ROLLBACKS — ${acknowledged.length} (acknowledged debt, still owed)`);
  for (const [ts, why] of acknowledged) line(`${ts}  ${why}`);
  console.log();
}

const failures = noFile.length + uncommitted.length + noRollback.length;
console.log(failures === 0
  ? "PASS: everything applied is in this tree, committed, and reversible."
  : `FAIL: ${failures} migration(s) this working tree does not properly account for.`);
process.exit(failures === 0 ? 0 : 1);
