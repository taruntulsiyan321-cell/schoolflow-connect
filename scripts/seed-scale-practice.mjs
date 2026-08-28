/**
 * Scale fixture, practice half (G8).
 *
 * "The seed must cover every table the gates measure." The six existing
 * practice tables hold 0-17 rows between them, so the timing gate measures
 * nothing there and Chunk 7B batch 2's fence rewrite would have no before/after
 * worth reporting. This gives them real candidate volume.
 *
 * It lives in the SCALE institution, never the demo school, so the demo stays
 * at 13 students and readable.
 *
 * Practice rows are per-user and every one of the six tables FKs
 * user_id -> auth.users, so this has to mint real auth accounts before it can
 * seed anything. It creates them for a subset of Northfield students, links
 * them to their students rows, then hands off to SQL for the bulk insert.
 *
 *   node scripts/seed-scale-practice.mjs [count]     (default 40)
 *
 * Idempotent: existing accounts are reused, and the SQL half is ON CONFLICT
 * DO NOTHING with deterministic ids.
 *
 * The service_role key is fetched at runtime and held in memory only.
 */
import { readFileSync, existsSync } from "fs";

if (existsSync(".env.local")) {
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}

const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const URL_BASE = process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
const COUNT = Number(process.argv[2] || 40);
const SCHOOL = "00000000-0000-4000-8000-000000000002";

if (!MGMT) {
  console.error("No SUPABASE_ACCESS_TOKEN in .env.local");
  process.exit(2);
}

const sql = async (query) => {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  try {
    return JSON.parse(text);
  } catch {
    return { __error: `HTTP ${r.status}: ${text.slice(0, 200)}` };
  }
};

const keyRes = await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys?reveal=true`, {
  headers: { Authorization: `Bearer ${MGMT}` },
});
if (!keyRes.ok) {
  console.error(`Could not read project API keys: HTTP ${keyRes.status}`);
  process.exit(1);
}
const SERVICE = (await keyRes.json()).find((k) => k.name === "service_role")?.api_key;
if (!SERVICE) {
  console.error("No service_role key returned");
  process.exit(1);
}
const authHeaders = {
  apikey: SERVICE,
  Authorization: `Bearer ${SERVICE}`,
  "Content-Type": "application/json",
};

/**
 * Northfield students, in the fixture's own deterministic order, so the same
 * N students get accounts on every run.
 */
const rows = await sql(`
  SELECT s.id, s.full_name, s.admission_number
    FROM public.students s
   WHERE s.school_id = '${SCHOOL}'
   ORDER BY s.admission_number
   LIMIT ${COUNT}`);
if (!Array.isArray(rows) || rows.length === 0) {
  console.error(
    `No students in the scale institution. Run supabase/fixtures/SCALE_FIXTURE.sql first. (${JSON.stringify(rows).slice(0, 200)})`,
  );
  process.exit(1);
}

let created = 0;
let reused = 0;
let failed = 0;

for (const s of rows) {
  const email = `${s.admission_number.toLowerCase()}@northfield.test`;
  const res = await fetch(`${URL_BASE}/auth/v1/admin/users`, {
    method: "POST",
    headers: authHeaders,
    body: JSON.stringify({
      email,
      email_confirm: true,
      user_metadata: { full_name: s.full_name, scale_fixture: true },
    }),
  });

  if (res.ok) {
    created += 1;
  } else {
    const body = await res.text();
    // Already present is the idempotent path, not a failure.
    if (res.status === 422 || /already been registered|already exists/i.test(body)) {
      reused += 1;
    } else {
      failed += 1;
      console.error(`  ${email}: HTTP ${res.status} ${body.slice(0, 140)}`);
    }
  }
}

console.log(`auth accounts: ${created} created, ${reused} reused, ${failed} failed`);
if (failed > 0) {
  // G10: a partial fixture that reports success would make the timing gate
  // measure less volume than it claims to.
  console.error("Refusing to seed practice data on a partial account set.");
  process.exit(1);
}

// Link the accounts to their students rows, then seed the practice volume.
const link = await sql(`
  UPDATE public.students s
     SET user_id = u.id
    FROM auth.users u
   WHERE s.school_id = '${SCHOOL}'
     AND u.email = lower(s.admission_number) || '@northfield.test'
     AND s.user_id IS DISTINCT FROM u.id`);
if (link?.__error) {
  console.error(`linking students to accounts failed: ${link.__error}`);
  process.exit(1);
}

const fixture = readFileSync("supabase/fixtures/SCALE_PRACTICE.sql", "utf8");
const out = await sql(fixture);
if (out?.__error) {
  console.error(`practice fixture failed: ${out.__error}`);
  process.exit(1);
}
// The fixture's final SELECT is the receipt. Anything else — including a bare
// success with no rows — means it did not run to the end, and reporting that
// as seeded would leave the timing gate measuring volume that is not there.
const receipt = Array.isArray(out) ? out.find((r) => r?.status === "SCALE_PRACTICE_OK") : null;
if (!receipt) {
  console.error(
    `practice fixture did not return its receipt: ${JSON.stringify(out).slice(0, 400)}`,
  );
  process.exit(1);
}
console.log(
  `seeded  accounts=${receipt.accounts} sessions=${receipt.sessions} ` +
    `attempts=${receipt.attempts} mistakes=${receipt.mistakes} ` +
    `mastery=${receipt.mastery} revision=${receipt.revision} history=${receipt.history}`,
);
