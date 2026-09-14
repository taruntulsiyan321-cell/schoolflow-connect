/**
 * Apply Riverside Public School E2E org structure (no academic demo noise).
 *
 * Requires .env.local with SUPABASE_ACCESS_TOKEN or DATABASE_URL.
 *   npm run db:seed:e2e-school
 *   npm run db:seed:e2e-school:remove
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
const remove = process.argv.includes("--remove");
const sqlPath = join(
  ROOT,
  "supabase",
  "fixtures",
  remove ? "E2E_SCHOOL_STRUCTURE_REMOVE.sql" : "E2E_SCHOOL_STRUCTURE.sql",
);
const sql = readFileSync(sqlPath, "utf8");

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
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 800)}`);
  return text;
}

async function viaPg(url) {
  const pg = await import("pg");
  const client = new pg.default.Client({
    connectionString: url,
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query(sql);
  } finally {
    await client.end();
  }
}

async function verifyLogin() {
  if (remove) return;
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    console.warn("Skip login verify: VITE_SUPABASE_URL / PUBLISHABLE_KEY missing");
    return;
  }
  const auth = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "principal@rps.e2e.test",
      password: "E2eSchool123!",
    }),
  });
  const body = await auth.json();
  if (auth.ok) {
    console.log("OK: principal@rps.e2e.test login works");
    return;
  }
  console.warn("Login check:", auth.status, body.msg || body.error_description || body);
}

async function main() {
  const token = process.env.SUPABASE_ACCESS_TOKEN;
  const dbUrl = process.env.DATABASE_URL;

  console.log(remove ? "Removing E2E school…" : "Applying E2E school structure…");

  if (token) {
    console.log("Via Supabase Management API…");
    const out = await viaManagementApi(token);
    if (out && out !== "[]" && out !== "null") console.log(out.slice(0, 400));
  } else if (dbUrl) {
    console.log("Via DATABASE_URL…");
    await viaPg(dbUrl);
  } else {
    console.error(`
Missing credentials. Add to .env.local:

  SUPABASE_ACCESS_TOKEN=sbp_xxxx
  # or
  DATABASE_URL=postgresql://...
`);
    process.exit(1);
  }

  await verifyLogin();
  console.log(remove ? "Done (removed)." : "Done. Password for all RPS logins: E2eSchool123!");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
