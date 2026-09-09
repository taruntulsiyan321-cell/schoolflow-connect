/**
 * WHICH MIGRATIONS IN THIS TREE HAVE NOT REACHED THE DATABASE.
 *
 *   npm run db:check-migrations
 *
 * Exit 0 = every migration file is in the ledger.
 * Exit 1 = at least one is not.
 * Exit 2 = BLOCKED — no credential, so nothing was compared and nothing is known.
 *
 * ── WHY THIS FILE WAS REWRITTEN, 2026-09-09 ──────────────────────────────
 *
 * The previous version asked a hand-written list of 27 QUESTIONS — "does
 * `rpc_leaderboard` exist", "does `battle_events` exist" — one per migration
 * somebody had thought to add a marker for. The newest marker was
 * `20260620000000`. The repository has **414 migration files**. So 387 of them
 * could not be reported pending by any input, and the script printed its
 * verdict and **exited 0 either way**: a gate with no failing exit, and no
 * inputs at all for 94% of its subject.
 *
 * It also went wrong in both directions on the markers it did have, and the
 * comments it left behind said so — `20260604000000` looked for a `dpps` table
 * that migration never created, and reported an applied migration as pending
 * for as long as the DPP removal stood; `20260618000000`'s marker probed a
 * column a LATER migration adds, and so answered for a different migration
 * than the one it named. Both were found by reading, not by the gate failing,
 * because the gate could not fail.
 *
 * ── WHAT REPLACES IT ─────────────────────────────────────────────────────
 *
 * `public.schema_migrations` is the real ledger — the table
 * `scripts/apply-one-migration.mjs` and `apply-pending-migrations.mjs` both
 * write to. (NOT the CLI's `supabase_migrations.schema_migrations`, which is
 * stale at 255 rows, which is why "the ledger" has to be named precisely.) The
 * comparison is the set difference against the filenames on disk: no marker to
 * maintain, no migration outside its reach, and a new file that was never
 * applied fails it the day it is written.
 *
 * ── WHAT THIS DELIBERATELY DOES NOT DO ───────────────────────────────────
 *
 * The other direction — APPLIED, with no file in this tree — belongs to
 * `scripts/check-foreign-migrations.mjs`, which `npm run preflight` runs, and
 * which also checks committed-ness and rollback coverage. It is reported here
 * as context and never failed on: two gates failing on one fact is how a red
 * build stops being read.
 *
 * Bounded, and worth saying: this compares NAMES. A migration whose file was
 * edited after it was applied is in the ledger and passes here. Nothing
 * compares the applied SQL to the file on disk.
 */
import { readdirSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  queryRows,
  connectionMode,
  describeConnection,
  closeConnection,
} from "./lib/readonly-db.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIG_DIR = join(ROOT, "supabase", "migrations");

/** The ledger holds a mix of bare timestamps and full filenames. Match on the stamp. */
const stamp = (s) => (s.match(/^(\d{14})/) ?? [])[1] ?? s;

async function main() {
  if (connectionMode() === "none") {
    console.error("BLOCKED: nothing was compared, so nothing is known about what is pending.");
    console.error("");
    console.error("  Needs ONE of, in the environment or in .env.local:");
    console.error("    CI_READONLY_DATABASE_URL   read-only role — what CI should use");
    console.error("    SUPABASE_ACCESS_TOKEN      local convenience path");
    console.error("");
    console.error("  This is NOT a pass and NOT a failure. Do not read it as either.");
    return 2;
  }

  if (!existsSync(MIG_DIR)) {
    console.error(`BLOCKED: ${MIG_DIR} does not exist — there is nothing to compare.`);
    return 2;
  }

  const files = readdirSync(MIG_DIR).filter((f) => /^\d{14}.*\.sql$/.test(f));
  if (files.length === 0) {
    // An empty input set would otherwise pass silently, which is the
    // check-that-cannot-fail shape this rewrite exists to remove.
    console.error("BLOCKED: no timestamped migration files found — the gate had no input.");
    return 2;
  }

  let rows;
  try {
    rows = await queryRows("SELECT version FROM public.schema_migrations ORDER BY version;");
  } catch (err) {
    console.error("BLOCKED: could not read public.schema_migrations.");
    console.error(`  via ${describeConnection()}`);
    console.error(`  ${err instanceof Error ? err.message : String(err)}`);
    return 2;
  }

  if (!Array.isArray(rows) || rows.length === 0) {
    console.error("BLOCKED: the ledger came back empty or unreadable.");
    console.error(`  ${JSON.stringify(rows).slice(0, 200)}`);
    console.error("  An empty ledger would call every file pending, which is a broken read,");
    console.error("  not a finding.");
    return 2;
  }

  const applied = new Set(rows.map((r) => stamp(String(r.version))));
  const pending = files.filter((f) => !applied.has(stamp(f))).sort();
  const matched = files.length - pending.length;
  const orphanCount = applied.size - matched;

  console.log(`Read the ledger via ${describeConnection()}.`);
  console.log(
    `ledger: ${applied.size} applied · tree: ${files.length} migration file(s) · ${pending.length} pending`,
  );

  if (orphanCount > 0) {
    console.log("");
    console.log(`NOTE: ${orphanCount} ledger entr(ies) have no file in this tree.`);
    console.log("  That is a real problem and it is npm run preflight's to report.");
  }

  if (pending.length === 0) {
    console.log("");
    console.log("PASS: every migration file in this tree is in the ledger.");
    console.log("  Bounded: this compares NAMES. A file edited after it was applied");
    console.log("  still passes — nothing here diffs the applied SQL against disk.");
    return 0;
  }

  console.log("");
  console.log(`IN THIS TREE, NOT APPLIED — ${pending.length}`);
  for (const f of pending) console.log(`  ${f}`);
  console.log("");
  console.log("  Apply with:  node scripts/apply-one-migration.mjs supabase/migrations/<file>");
  console.log("  or:          npm run db:migrate");
  return 1;
}

// SET the exit code, do not CALL process.exit(). Exiting with a handle still
// open aborts inside libuv on Windows — `Assertion failed:
// !(handle->flags & UV_HANDLE_CLOSING)` — and the shell then sees 127 rather
// than the code this gate chose. Measured on the first run of this rewrite,
// which printed PASS and exited 127. A gate that reports the wrong exit code is
// the same defect as one that cannot fail. Same shape as
// check-foreign-migrations.mjs, which is why it ends the same way.
process.exitCode = await main().catch((e) => {
  console.error(`BLOCKED: ${e instanceof Error ? e.message : String(e)}`);
  return 2;
});
await closeConnection();
