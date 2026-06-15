/**
 * Apply Supabase migrations via Management API or DATABASE_URL.
 *
 * Setup (.env.local) — use ONE:
 *   SUPABASE_ACCESS_TOKEN=sbp_...   https://supabase.com/dashboard/account/tokens
 *   DATABASE_URL=postgresql://...
 *
 * Run:
 *   npm run db:migrate          # recent migration files only
 *   npm run db:migrate:all      # every file in supabase/migrations/
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const MIGRATIONS_DIR = join(ROOT, "supabase", "migrations");
const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "kdmjipeksjdyojjdokbi";

/** Migrations added after the initial Lovable deploy — safe to run on existing DBs. */
const RECENT_PREFIXES = [
  "20260509065137",
  "20260516000000",
  "20260604030000",
  "20260604060340",
  "20260604080000",
  "20260604100000",
  "20260605000000",
  "20260606000000",
  "20260607000000",
  "20260608000000",
  "20260604120000",
  "20260609000000",
  "20260610000000",
  "20260611000000",
  "20260612000000",
  "20260613000000",
  "20260614000000",
  "20260615000000",
  "20260616000000",
  "20260617000000",
  "20260618000000",
  "20260619000000",
  "20260620000000",
];

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
  const selected = all
    ? files
    : files.filter((f) => RECENT_PREFIXES.some((p) => f.startsWith(p)));
  return selected.map((f) => join(MIGRATIONS_DIR, f));
}

loadEnvFile(".env");
loadEnvFile(".env.local");

const useAll = process.argv.includes("--all");

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

  console.log(`Project: ${PROJECT_REF}`);
  console.log(`Mode: ${useAll ? "all migrations" : "recent only"} (${files.length} file(s))\n`);

  for (const path of files) {
    if (!existsSync(path)) {
      console.warn(`Skip (missing): ${path}`);
      continue;
    }
    const name = path.split(/[/\\]/).pop();
    console.log(`Running ${name}…`);
    const sql = readFileSync(path, "utf8");
    try {
      await runSql(sql, name);
      console.log(`  OK: ${name}`);
    } catch (e) {
      if (e.message === "missing_credentials") throw e;
      console.error(`  FAILED: ${name}`);
      console.error(e.message || e);
      console.error("\nStopped. Fix the error above, then re-run.");
      process.exit(1);
    }
  }

  console.log("\nDone. Run: npm run db:check-migrations");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
