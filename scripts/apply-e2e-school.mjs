/**
 * Riverside Public School — the E2E organisation — onto the live project, or off it.
 *
 *   npm run db:seed:e2e-school          apply 20260925220000 if the ledger does not hold it, then sign its leaders in
 *   npm run db:seed:e2e-school:remove   roll it back (the whole school and everyone added into it) and drop its ledger row
 *
 * The migration is the school as it is handed over — its year, its twelve sections, its admin and its principal —
 * and nothing else. Its teachers, students and parents are added by the admin THROUGH THE APP (the owner's ruling of
 * 2026-09-15), so no script writes a person into it. Applied through scripts/apply-one-migration.mjs, the one applier
 * and ledger writer.
 *
 * After applying, the admin and the principal sign in through Supabase Auth. That proves the accounts, NOT that the
 * app's /auth form admits them (KNOWN_ISSUES 57): the e2e-evidence/zz-riverside-* specs do.
 *
 * Requires .env.local with SUPABASE_ACCESS_TOKEN.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "20260925220000_riverside_public_school_awaits_its_people";
const remove = process.argv.includes("--remove");

function envFrom(file, key) {
  const path = join(ROOT, file);
  if (!existsSync(path)) return undefined;
  const m = readFileSync(path, "utf8").match(new RegExp(`^\\s*${key}\\s*=\\s*"?([^"\\r\\n]*)"?\\s*$`, "m"));
  return m?.[1];
}

async function sql(query) {
  const token = envFrom(".env.local", "SUPABASE_ACCESS_TOKEN");
  const ref = envFrom(".env", "VITE_SUPABASE_PROJECT_ID") || "psqxykzqfvxgsvkmgurn";
  if (!token) throw new Error("no SUPABASE_ACCESS_TOKEN in .env.local");
  const res = await fetch(`https://api.supabase.com/v1/projects/${ref}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Management API ${res.status}: ${text.slice(0, 400)}`);
  return JSON.parse(text);
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

async function verifyLogins() {
  const url = envFrom(".env", "VITE_SUPABASE_URL");
  const key = envFrom(".env", "VITE_SUPABASE_PUBLISHABLE_KEY");
  if (!url || !key) throw new Error("VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY missing from .env");
  for (const email of ["admin@rps.e2e.test", "principal@rps.e2e.test"]) {
    const res = await fetch(`${url}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: key, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password: "E2eSchool123!" }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(`${email} cannot sign in: ${res.status} ${body.msg || body.error_description || ""}`);
    }
    console.log(`OK: ${email} signs in`);
  }
}

const applied = (await sql(`SELECT 1 FROM public.schema_migrations WHERE version = '${MIGRATION}'`)).length > 0;

if (remove) {
  if (!applied) {
    console.log(`not applied: ${MIGRATION}`);
  } else {
    apply(join(ROOT, "supabase", "migrations", "rollback", `${MIGRATION}.rollback.sql`), "--no-ledger");
    await sql(`DELETE FROM public.schema_migrations WHERE version = '${MIGRATION}'`);
    console.log(`Ledger row removed: ${MIGRATION}`);
  }
} else {
  if (applied) console.log(`already applied: ${MIGRATION}`);
  else apply(join(ROOT, "supabase", "migrations", `${MIGRATION}.sql`));
  await verifyLogins();
}
