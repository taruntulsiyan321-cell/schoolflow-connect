/**
 * Riverside Public School — the E2E organisation — onto the live project, or off it.
 *
 *   npm run db:seed:e2e-school          apply the migration (and record it in the ledger)
 *   npm run db:seed:e2e-school:remove   apply its rollback (and remove the ledger row)
 *
 * The organisation is ONE file: supabase/migrations/20260925200000_riverside_public_school_is_a_real_organisation.sql.
 * It was a fixture (supabase/fixtures/E2E_SCHOOL_STRUCTURE.sql) until the owner ruled on 2026-09-15 that
 * it is applied as a migration; a second copy here would drift from the first (G9), so this script
 * applies that file through scripts/apply-one-migration.mjs, the one applier and ledger writer, and
 * then checks that a Riverside login works.
 *
 * Requires .env.local with SUPABASE_ACCESS_TOKEN.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const NAME = "20260925200000_riverside_public_school_is_a_real_organisation";
const MIGRATION = join(ROOT, "supabase", "migrations", `${NAME}.sql`);
const ROLLBACK = join(ROOT, "supabase", "migrations", "rollback", `${NAME}.rollback.sql`);
const remove = process.argv.includes("--remove");

function envFrom(file, key) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return undefined;
  const m = readFileSync(path, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]*)"?\\s*$`, "m"));
  return m?.[1];
}

function apply(file, ...flags) {
  const r = spawnSync("node", [join(ROOT, "scripts", "apply-one-migration.mjs"), file, ...flags], {
    cwd: ROOT,
    encoding: "utf8",
  });
  process.stdout.write(r.stdout ?? "");
  process.stderr.write(r.stderr ?? "");
  if (r.status !== 0) process.exit(r.status ?? 1);
}

async function dropLedgerRow() {
  const token = envFrom(".env.local", "SUPABASE_ACCESS_TOKEN");
  const ref = envFrom(".env", "VITE_SUPABASE_PROJECT_ID") || "psqxykzqfvxgsvkmgurn";
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: `DELETE FROM public.schema_migrations WHERE version = '${NAME}'` }),
  });
  if (!res.ok) throw new Error(`removing the ledger row failed: HTTP ${res.status}`);
  console.log(`Ledger row removed: ${NAME}`);
}

async function verifyLogin() {
  const url = envFrom(".env", "VITE_SUPABASE_URL");
  const key = envFrom(".env", "VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env");
  const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: { apikey: key, "Content-Type": "application/json" },
    body: JSON.stringify({ email: "principal@rps.e2e.test", password: "E2eSchool123!" }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(`principal@rps.e2e.test cannot sign in: ${res.status} ${body.msg || body.error_description || ""}`);
  }
  console.log("OK: principal@rps.e2e.test signs in");
}

if (remove) {
  apply(ROLLBACK, "--no-ledger");
  await dropLedgerRow();
} else {
  apply(MIGRATION);
  await verifyLogin();
}
