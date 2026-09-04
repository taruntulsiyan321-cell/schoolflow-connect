/**
 * Re-run the security claims of applied migrations AS THE INVOKING ROLE.
 *
 * WHY THIS EXISTS
 *
 * Every migration in this repo ends in a `DO $verify$` block. Those blocks run
 * as the migration role — postgres — which is a superuser and bypasses RLS.
 * So they can prove that a policy EXISTS, that a predicate CONTAINS a string,
 * that a grant was written. They cannot prove that a teacher is refused, that
 * an admin of school A cannot reach school B, or that the role the feature was
 * built for can read it at all.
 *
 * Two live holes reached production behind green verification blocks:
 *
 *   - rpc_restore_from_trash let an admin of school A restore a school B row.
 *     Its migration asserted the guard's DDL was present. It was. It did not
 *     work, because the function is SECURITY DEFINER and the trash view it
 *     consulted therefore ran as the owner and saw every school.
 *
 *   - the trash view was unreadable by admins, because a security_invoker view
 *     needs the CALLER to hold EXECUTE on the functions it calls, and Chunk
 *     9.5 revokes EXECUTE from PUBLIC by default. The verification ran as
 *     postgres, which has it.
 *
 * Both are the same root cause. This script is the countermeasure: it asks the
 * database the question as the person, not as the superuser.
 *
 * HOW
 *
 * Each probe file opens a transaction, creates a temp helper that does
 *   set_config('request.jwt.claims', '{"sub": <uid>, ...}', true)
 *   set_config('role', 'authenticated', true)
 * around an EXECUTE, catches the exception as DATA rather than aborting, and
 * ROLLS BACK. Nothing it writes survives.
 *
 * EVERY DENIAL PROBE IS PAIRED WITH A POSITIVE CONTROL. A first version of
 * probe 4 used invalid SQL; all four inserts failed with a syntax error and
 * three still scored PASS, because the assertion only looked for the word
 * ERROR. A denial test that passes on a typo tests nothing (G11).
 *
 * Usage:  npm run verify:caller-privileges
 */
import { readFileSync, existsSync, readdirSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, "..");
const PROBE_DIR = join(ROOT, "supabase", "migrations", "verification", "caller-privileges");

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

loadEnvFile(".env.local");
loadEnvFile(".env");

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;

if (!TOKEN) {
  console.error(
    "\nBLOCKED: no SUPABASE_ACCESS_TOKEN in .env.local.\n\n" +
      "  This is NOT a pass. Nothing was asked of the database, so nothing is\n" +
      "  known about whether any role is correctly refused.\n",
  );
  process.exit(2);
}

async function runSql(sql, label) {
  const res = await fetch(
    `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: sql }),
    },
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`${label}: API ${res.status}: ${text.slice(0, 500)}`);
  return text;
}

const files = readdirSync(PROBE_DIR).filter((f) => /^probe\d+\.sql$/.test(f)).sort();
if (!files.length) {
  console.error(`No probe files in ${PROBE_DIR}`);
  process.exit(2);
}

let pass = 0;
let fail = 0;
const failures = [];

console.log(`Re-running verification AS THE CALLER — ${files.length} probe file(s)\n`);

for (const f of files) {
  let out;
  try {
    out = await runSql(readFileSync(join(PROBE_DIR, f), "utf8"), f);
  } catch (e) {
    console.error(`  ${f}: COULD NOT RUN — ${e.message}`);
    failures.push(`${f}: probe did not execute`);
    fail += 1;
    continue;
  }
  let rows;
  try {
    rows = JSON.parse(out);
  } catch {
    console.error(`  ${f}: unparseable result`);
    failures.push(`${f}: unparseable`);
    fail += 1;
    continue;
  }
  if (!Array.isArray(rows) || rows.length === 0) {
    console.error(`  ${f}: returned no probe rows — the file asserted nothing`);
    failures.push(`${f}: no assertions`);
    fail += 1;
    continue;
  }
  for (const r of rows) {
    const ok = r.verdict === "PASS";
    ok ? (pass += 1) : (fail += 1);
    if (!ok) failures.push(`${r.area} [${r.role_tested}] expected ${r.expected}, got ${r.observed}`);
    console.log(
      `  ${ok ? "ok   " : "FAIL "} ${String(r.area).padEnd(44)} ${String(r.role_tested).padEnd(28)} ${r.observed}`,
    );
  }
}

console.log("");
if (fail === 0) {
  console.log(
    `PASS: ${pass} assertion(s) held under the caller's own privileges.\n` +
      `  Narrower than "the schema is secure": it covers the roles and paths\n` +
      `  these probes name, and nothing else.`,
  );
  process.exit(0);
}
console.error(`FAIL: ${fail} of ${pass + fail} assertion(s) did not hold as the caller:`);
for (const m of failures) console.error(`  - ${m}`);
process.exit(1);
