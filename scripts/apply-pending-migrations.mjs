/**
 * Apply pending Supabase migrations WITHOUT Lovable credits.
 *
 * Setup (.env.local) — use ONE:
 *   SUPABASE_ACCESS_TOKEN=sbp_...   https://supabase.com/dashboard/account/tokens
 *   DATABASE_URL=postgresql://...   Lovable → Project → Settings → Supabase / Database URI
 *
 * Run:
 *   npm run db:migrate          # pending migration files only
 *   npm run db:migrate:all      # full LOVABLE_PASTE_ALL_PENDING.sql (larger)
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "kdmjipeksjdyojjdokbi";

const PENDING_FILES = [
  "20260509065137_35bec001-c627-426a-bdd6-dc992c1d3693.sql",
  "20260516000000_inquiries_complaints.sql",
  "20260604030000_student_panel_fixes.sql",
  "20260604060340_60f4721e-63fc-4ef7-8c92-450cfa872f39.sql",
  "20260604080000_battle_monitor.sql",
  "20260604100000_battleground_phase4.sql",
  "20260605000000_student_portal_login.sql",
  "20260606000000_student_success_platform.sql",
  "20260607000000_student_success_phase2.sql",
  "20260608000000_student_success_phase3.sql",
  "20260604120000_demo_data.sql",
  "20260609000000_fix_quick_battle_overload.sql",
  "20260610000000_battleground_overhaul.sql",
  "20260611000000_question_template_engine.sql",
  "20260612000000_ai_and_audit_fixes.sql",
  "20260613000000_concept_mastery_recovery.sql",
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

OPTION A (easiest if you have a Supabase account):
  1. Open https://supabase.com/dashboard/account/tokens
  2. Create token → copy sbp_...
  3. In .env.local add: SUPABASE_ACCESS_TOKEN=sbp_...
  4. Run: npm run db:migrate

OPTION B (database password — works even when supabase.com blocks the project UI):
  1. In Lovable: open your project → Settings / Integrations → Supabase
  2. Copy the Postgres connection string (URI) or host + password
  3. In .env.local add: DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@...
  4. Run: npm run db:migrate

Then verify: npm run db:check-migrations
`);
    process.exit(1);
  }

  const files = useAll
    ? [join(ROOT, "supabase", "LOVABLE_PASTE_ALL_PENDING.sql")]
    : PENDING_FILES.map((f) => join(ROOT, "supabase", "migrations", f));

  console.log(`Project: ${PROJECT_REF}`);
  console.log(`Mode: ${useAll ? "full bundle" : "pending files only"} (${files.length} file(s))\n`);

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
      console.error("\nStopped. Fix the error above, then re-run (migrations are mostly idempotent).");
      process.exit(1);
    }
  }

  console.log("\nDone. Run: npm run db:check-migrations");
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
