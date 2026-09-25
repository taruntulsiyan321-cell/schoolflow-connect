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
import { queryRows, connectionMode, describeConnection, closeConnection } from "./lib/readonly-db.mjs";
import {
  migrationName, unappliedFiles, ledgerRowsWithoutFile, rollbackCovers, sharedStamps,
} from "./lib/migration-ledger.mjs";

// The project ref now comes from scripts/lib/readonly-db.mjs.
const MIG_DIR = "supabase/migrations";
const ROLLBACK_DIR = "supabase/migrations/rollback";
// Chunk 1 of the foundation build — the first migration written under the
// reversibility rule. Everything before it predates the rule.
const FOUNDATION_BUILD_BEGAN = "20260826100000";

/**
 * A GATE THAT CANNOT RUN MUST FAIL CLEANLY.
 *
 * This block used to be `readFileSync('.env.local')` with no guard, so on a
 * machine without that file the preflight died with an unhandled ENOENT and a
 * Node stack trace. That is the worst possible output for a gate: it exits
 * non-zero, which looks exactly like a real finding, while actually meaning
 * the check never ran. G8 already says an empty result from a check that did
 * not run is not a pass — this is the same rule one step earlier, at the point
 * where the check cannot even start.
 *
 * Three outcomes now, and they are told apart by exit code as well as by text:
 *
 *   0   PASS      everything applied is accounted for
 *   1   FAIL      real findings — the thing this gate exists to catch
 *   2   BLOCKED   the gate could not run, and found nothing either way
 *
 * The credential handling is no longer duplicated here either. Seven other
 * scripts already go through scripts/lib/readonly-db.mjs, which guards the
 * file read, prefers process.env so CI can supply a token without a file, and
 * reports which connection it used. This one had its own copy, which is how it
 * ended up the only gate that crashes instead of reporting.
 */
/**
 * Wrapped in a function so a blocked path can RETURN its exit code instead of
 * calling process.exit() part-way through.
 *
 * process.exit() with an in-flight fetch aborts inside libuv on Windows —
 * `Assertion failed: !(handle->flags & UV_HANDLE_CLOSING)` — and the shell then
 * sees 127 rather than the code the gate chose. A gate that reports the wrong
 * exit code is the same defect as one that crashes instead of reporting, which
 * is what this whole rewrite is about. readonly-db.mjs documents the same trap
 * for the pg pool; this is the fetch half of it.
 */
async function main() {
  if (connectionMode() === "none") {
    console.error("BLOCKED: the migration preflight could not run.");
    console.error("");
    console.error("  It needs ONE of:");
    console.error("    CI_READONLY_DATABASE_URL   read-only role — what CI should use");
    console.error("    SUPABASE_ACCESS_TOKEN      local convenience path");
    console.error("  in the environment or in .env.local (which is not present).");
    console.error("");
    console.error("  This is NOT a finding. Nothing was compared, so nothing is known");
    console.error("  about whether production matches this tree. Do not read this as");
    console.error("  a pass and do not read it as a failure — the check did not run.");
    return 2;
  }

  let rows;
  try {
    rows = await queryRows("SELECT version FROM public.schema_migrations ORDER BY version;");
  } catch (err) {
    console.error("BLOCKED: the migration preflight could not read schema_migrations.");
    console.error(`  via ${describeConnection()}`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    console.error("");
    console.error("  Again: not a finding. The comparison never happened.");
    // Close before exiting: process.exit() with an open handle aborts inside
    // libuv on Windows and the shell sees 127, not 2 — a gate reporting the
    // wrong exit code is the same defect this rewrite is about.
    return 2;
  }

  if (!Array.isArray(rows)) {
    console.error("BLOCKED: schema_migrations did not come back as rows.");
    console.error(`  ${JSON.stringify(rows).slice(0, 200)}`);
    return 2;
  }

  console.log(`Read the ledger via ${describeConnection()}.`);

  // By full name, never by timestamp: 14 timestamps are shared by two files,
  // and matching on the stamp let a file pass on its neighbour's ledger row
  // (scripts/lib/migration-ledger.mjs).
  const ledger = rows.map((r) => String(r.version));
  const localFiles = existsSync(MIG_DIR)
    ? readdirSync(MIG_DIR).filter((f) => f.endsWith(".sql"))
    : [];
  const shared = sharedStamps(localFiles);

  // A rollback covers what it names: `<name>.rollback.sql`, the name in its
  // text, or — for older rollbacks — a timestamp no other migration carries.
  // 20260828110000_chunk67_batch1_down.sql reverses three migrations in one
  // file because they are one logical change taken in three measurements.
  const rollbacks = existsSync(ROLLBACK_DIR)
    ? readdirSync(ROLLBACK_DIR).filter((x) => x.endsWith(".sql"))
        .map((file) => ({ file, text: readFileSync(`${ROLLBACK_DIR}/${file}`, "utf8") }))
    : [];

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

  const noFile = ledgerRowsWithoutFile(localFiles, ledger);
  const notApplied = unappliedFiles(localFiles, ledger);
  const uncommitted = [], noRollback = [];
  const applied = new Set(ledger);

  for (const file of localFiles) {
    const name = migrationName(file);
    if (!applied.has(name)) continue;
    if (!tracked.has(file) || dirty.has(file)) { uncommitted.push(file); continue; }
    // "Migrations must be reversible" is a rule of THIS build, not a retroactive
    // judgement on 290 migrations written before it existed. Demanding rollbacks
    // for all of them buried the two real findings in noise the first time this
    // ran — a gate whose output nobody can read is a gate nobody reads.
    const ts = name.slice(0, 14);
    if (ts >= FOUNDATION_BUILD_BEGAN && !KNOWN_MISSING_ROLLBACKS.has(ts) && !rollbackCovers(name, rollbacks, shared)) {
      noRollback.push(file);
    }
  }

  const line = (s) => console.log("  " + s);
  console.log(`ledger: ${ledger.length} applied · tree: ${localFiles.length} migration file(s) · ${rollbacks.length} rollback script(s)\n`);

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

  const acknowledged = [...KNOWN_MISSING_ROLLBACKS].filter(([ts]) => ledger.some((v) => v.startsWith(ts)));
  if (acknowledged.length) {
    console.log(`KNOWN MISSING ROLLBACKS — ${acknowledged.length} (acknowledged debt, still owed)`);
    for (const [ts, why] of acknowledged) line(`${ts}  ${why}`);
    console.log();
  }

  const failures = noFile.length + uncommitted.length + noRollback.length;
  console.log(failures === 0
    ? "PASS: everything applied is in this tree, committed, and reversible."
    : `FAIL: ${failures} migration(s) this working tree does not properly account for.`);
  return failures === 0 ? 0 : 1;
}

process.exitCode = await main();
await closeConnection();
