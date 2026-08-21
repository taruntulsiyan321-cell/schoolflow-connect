/**
 * Apply question-bank + demo seed to remote Supabase.
 *
 * Option A — Supabase Personal Access Token (recommended):
 *   1. https://supabase.com/dashboard/account/tokens → New token
 *   2. Add to .env.local: SUPABASE_ACCESS_TOKEN=sbp_...
 *   3. npm run db:seed
 *
 * Option B — Direct Postgres (Settings → Database → connection string):
 *   Add to .env.local: DATABASE_URL=postgresql://postgres.[ref]:[PASSWORD]@...
 *   npm run db:seed
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");

function loadEnvFile(name) {
  const path = join(ROOT, name);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*"?([^"]*)"?\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
}

loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";

const seedPath = join(ROOT, "supabase", "SEED_DEMO_DATA.sql");
const sql = readFileSync(seedPath, "utf8");

async function viaManagementApi(token) {
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
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

async function viaPg(url) {
  const pg = await import("pg");
  const client = new pg.default.Client({ connectionString: url, ssl: { rejectUnauthorized: false } });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function verify() {
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "arjun.mehta@wisdomcampus.com",
      password: "DemoPass123!",
    }),
  });
  const body = await auth.json();
  if (auth.ok) {
    console.log("OK: demo student login works (arjun.mehta@wisdomcampus.com)");
    return;
  }
  console.warn("Login check:", auth.status, body.msg || body.error_description || body);
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  if (token) {
    console.log("Applying seed via Supabase Management API…");
    await viaManagementApi(token);
  } else if (dbUrl) {
    console.log("Applying seed via DATABASE_URL…");
    await viaPg(dbUrl);
  } else {
    console.error(`
Missing credentials. Create .env.local with ONE of:

  SUPABASE_ACCESS_TOKEN=sbp_xxxx   (from supabase.com/dashboard/account/tokens)

  DATABASE_URL=postgresql://...    (from Project Settings → Database)

Then run: npm run db:seed

Or paste supabase/SEED_DEMO_DATA.sql in Supabase Dashboard → SQL Editor → Run.
`);
    process.exit(1);
  }

  console.log("Seed SQL executed.");
  await verify();
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
