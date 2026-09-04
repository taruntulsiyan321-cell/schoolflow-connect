/**
 * Apply Supabase migrations via Management API or DATABASE_URL.
 *
 * Setup (.env.local) — use ONE:
 *   SUPABASE_ACCESS_TOKEN=sbp_...   https://supabase.com/dashboard/account/tokens
 *   DATABASE_URL=postgresql://...
 *
 * Run:
 *   npm run db:migrate          # PENDING migrations on/after RECENT_SINCE
 *   npm run db:migrate:all      # every PENDING file in supabase/migrations/
 *
 * "Pending" means "not already in public.schema_migrations". Add --replay to
 * ignore the ledger and re-run the selection anyway; that was the behaviour
 * before, and it could not complete (see appliedVersions below).
 *
 * To apply exactly one file, use scripts/apply-one-migration.mjs instead.
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");

/**
 * Default npm run db:migrate applies every migration whose filename is on/after
 * this cutoff (panel era to current). Avoids a stale hand-maintained prefix list
 * that previously skipped 70+ Aug 2026 security/integrity migrations.
 * Use npm run db:migrate:all for the full folder including pre-cutoff files.
 */
const RECENT_SINCE = "20260509000000";

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

function listMigrations({ all }) {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort();
  const selected = all ? files : files.filter((f) => f >= RECENT_SINCE);
  return selected.map((f) => join(MIGRATIONS_DIR, f));
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";

const useAll = process.argv.includes("--all");
/** Ignore the ledger and re-run everything selected (the old behaviour). */
const replay = process.argv.includes("--replay");

async function runSql(sql, label) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  if (token) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query: sql }),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`${label}: API ${res.status}: ${text.slice(0, 400)}`);
    return;
  }

  if (dbUrl) {
    const pg = await import("pg");
    const client = new pg.default.Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      await client.query(sql);
    } finally {
      await client.end();
    }
    return;
  }

  throw new Error("missing_credentials");
}

/** Same two credential paths as runSql, but hands back the rows. */
async function queryRows(sql, label) {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  if (token) {
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
      {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ query: sql }),
      },
    );
    const text = await res.text();
    if (!res.ok) throw new Error(`${label}: API ${res.status}: ${text.slice(0, 400)}`);
    try {
      return JSON.parse(text);
    } catch {
      return [];
    }
  }

  if (dbUrl) {
    const pg = await import("pg");
    const client = new pg.default.Client({
      connectionString: dbUrl,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    try {
      return (await client.query(sql)).rows;
    } finally {
      await client.end();
    }
  }

  throw new Error("missing_credentials");
}

/**
 * Versions already recorded in the ledger.
 *
 * WHY THIS EXISTS. This script used to run EVERY file at or after
 * RECENT_SINCE on every invocation — 356 of them — and depended on all of them
 * being idempotent. At least one is not:
 *
 *   FAILED: 20260509064250_0d3a48e5-...sql
 *   ERROR: 42710: policy "locks read auth" for table "attendance_locks" already exists
 *
 * It exits 1 there, so nothing after it is ever reached and `npm run db:migrate`
 * could not complete at all. That version WAS in schema_migrations the whole
 * time (373 rows, going back to 20260503) — the ledger was written and then
 * never read.
 *
 * A missing table means a fresh database, so everything is pending. Any other
 * failure aborts rather than silently replaying the folder, because "I could
 * not tell what was applied" must not look like "nothing was applied".
 */
async function appliedVersions() {
  try {
    const rows = await queryRows(
      "SELECT version FROM public.schema_migrations",
      "read schema_migrations",
    );
    return new Set((rows ?? []).map((r) => r.version).filter(Boolean));
  } catch (e) {
    if (/does not exist|undefined_table|42P01/i.test(e.message)) {
      console.log("schema_migrations does not exist yet — treating every file as pending.\n");
      return new Set();
    }
    throw new Error(
      `Could not read schema_migrations, so it is not known what is already applied.\n` +
        `  Refusing to replay the folder blind. Underlying error:\n  ${e.message}`,
    );
  }
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;
  if (!token && !dbUrl) {
    console.error(`
No database credentials in .env.local

Add SUPABASE_ACCESS_TOKEN or DATABASE_URL, then run: npm run db:migrate
Verify with: npm run db:check-migrations
`);
    process.exit(1);
  }

  const files = listMigrations({ all: useAll });
  const applied = replay ? new Set() : await appliedVersions();

  console.log(`Project: ${PROJECT_REF}`);
  console.log(`Mode: ${useAll ? "all migrations" : "recent only"} (${files.length} file(s))`);

  const pending = files.filter(
    (p) => !applied.has(p.split(/[/\\]/).pop().replace(/\.sql$/, "")),
  );
  const skipped = files.length - pending.length;
  console.log(
    replay
      ? `--replay: the ledger is ignored, all ${files.length} file(s) will run\n`
      : `Ledger: ${applied.size} recorded, ${skipped} skipped, ${pending.length} pending\n`,
  );
  if (!pending.length) {
    console.log("Nothing to apply.");
    return;
  }

  for (const path of pending) {
    if (!existsSync(path)) {
      console.warn(`Skip (missing): ${path}`);
      continue;
    }
    const name = path.split(/[/\\]/).pop();
    const version = name.replace(/\.sql$/, "");
    console.log(`Running ${name}…`);
    const sql = readFileSync(path, "utf8");
    try {
      await runSql(sql, name);
      // Record in the ledger (scripts/verify-database-integrity.mjs and any
      // future tooling read this instead of a hand-maintained marker list).
      // Best-effort: a pre-ledger environment or a race with the ledger's
      // own migration shouldn't fail an otherwise-successful apply.
      await runSql(
        `INSERT INTO public.schema_migrations (version) VALUES ('${version.replace(/'/g, "''")}') ON CONFLICT (version) DO NOTHING;`,
        `${name} (ledger record)`,
      ).catch((e) => console.warn(`  (ledger record skipped: ${e.message})`));
      console.log(`  OK: ${name}`);
    } catch (e) {
      if (e.message === "missing_credentials") throw e;
      console.error(`  FAILED: ${name}`);
      console.error(e.message || e);
      // process.exit() after a fetch trips a libuv assertion and the shell sees
      // 127 instead of this code. Set the code and let the process end.
      process.exitCode = 1;
      return;
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exitCode = 1;
});