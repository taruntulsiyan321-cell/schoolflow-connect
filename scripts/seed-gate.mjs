/**
 * G8 seed gate: prove `npm run db:seed` executes end to end, without committing.
 *
 * "The seed gate exists because it was broken four independent ways and nobody
 * noticed. A broken seed is invisible until the day it matters most — a new
 * developer, a staging rebuild, a recovery."
 *
 * The seed is sent as one multi-statement string, which the API runs as a single
 * implicit transaction. Appending a deliberate RAISE therefore aborts the whole
 * thing: if we get OUR abort back, every statement before it parsed and ran. Any
 * other error is a genuinely broken seed.
 *
 * Nothing is committed either way, so this is safe to run against a live project.
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

const PROJECT_REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("No SUPABASE_ACCESS_TOKEN. Put it in .env.local.");
  process.exit(2);
}

const MARKER = "SEED GATE OK - deliberately rolled back";
const seed = readFileSync("supabase/SEED_DEMO_DATA.sql", "utf8");
const sql = `${seed}\n\nDO $seedgate$ BEGIN RAISE EXCEPTION '${MARKER}'; END $seedgate$;\n`;

const res = await fetch(
  `https://api.supabase.com/v1/projects/${PROJECT_REF}/database/query`,
  {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: sql }),
  },
);
const text = await res.text();

if (res.ok) {
  // It never reached our abort, which means the seed file is empty or the
  // transaction semantics changed. Either way this gate is not proving anything.
  console.error("SEED GATE INCONCLUSIVE: the seed completed without hitting the abort.");
  process.exit(1);
}

if (text.includes(MARKER)) {
  const stmts = (seed.match(/;/g) || []).length;
  console.log(`SEED GATE PASS: the seed ran end to end (~${stmts} statements), then rolled back.`);
  process.exit(0);
}

const m = text.match(/ERROR:\s*([0-9A-Z]{5}):\s*(.{0,300})/);
console.error("SEED GATE FAIL: the seed did not run to completion.");
console.error(m ? `  ${m[1]}: ${m[2].replace(/\\n/g, " ")}` : text.slice(0, 400));
process.exit(1);
