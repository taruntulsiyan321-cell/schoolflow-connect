/**
 * Riverside Public School — the E2E organisation — onto the live project, or off it.
 *
 *   npm run db:seed:e2e-school          apply every Riverside migration the ledger does not hold, in order
 *   npm run db:seed:e2e-school:remove   roll every applied one back, newest first, and drop its ledger row
 *
 * The organisation is these migrations, in this order, and nothing else:
 *   20260925200000_riverside_public_school_is_a_real_organisation   the roster (school, sections, teachers, students)
 *   20260925210000_riverside_is_a_whole_school                      every student's login, their parents, a teacher for every subject
 * Each is applied through scripts/apply-one-migration.mjs — the one applier and ledger writer — and one
 * already in the ledger is not applied again (its proof describes the school as it stood when it ran, so
 * re-running an earlier one over a later one would fail it).
 *
 * After applying, a principal, a teacher, a student and a parent sign in through Supabase Auth. That proves the
 * accounts, NOT that the app's /auth form admits them (KNOWN_ISSUES 57): e2e-evidence/zz-riverside-*.spec.ts does.
 *
 * Requires .env.local with SUPABASE_ACCESS_TOKEN.
 */
import { readFileSync, existsSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import { spawnSync } from "child_process";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATIONS = [
  "20260925200000_riverside_public_school_is_a_real_organisation",
  "20260925210000_riverside_is_a_whole_school",
];
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
  const accounts = ["principal@rps.e2e.test", "teacher01@rps.e2e.test", "student.8a.05@rps.e2e.test", "parent.8a.01@rps.e2e.test"];
  for (const email of accounts) {
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

const rows = await sql(`SELECT version FROM public.schema_migrations WHERE version IN (${MIGRATIONS.map((m) => `'${m}'`).join(", ")})`);
const applied = new Set(rows.map((r) => r.version));

if (remove) {
  for (const name of [...MIGRATIONS].reverse()) {
    if (!applied.has(name)) continue;
    apply(join(ROOT, "supabase", "migrations", "rollback", `${name}.rollback.sql`), "--no-ledger");
    await sql(`DELETE FROM public.schema_migrations WHERE version = '${name}'`);
    console.log(`Ledger row removed: ${name}`);
  }
} else {
  for (const name of MIGRATIONS) {
    if (applied.has(name)) {
      console.log(`already applied: ${name}`);
      continue;
    }
    apply(join(ROOT, "supabase", "migrations", `${name}.sql`));
  }
  await verifyLogins();
}
