/**
 * Dry-run one migration against live via Management API, then ROLLBACK.
 *   node scripts/dry-run-one-migration.mjs <path-to.sql>
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

const FILE = process.argv[2];
if (!FILE) {
  console.error("usage: dry-run-one-migration.mjs <file.sql>");
  process.exit(2);
}
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
if (!TOKEN) {
  console.error("no SUPABASE_ACCESS_TOKEN");
  process.exit(2);
}

let sql = readFileSync(FILE, "utf8").replace(/\r\n/g, "\n");
sql = sql.replace(/^\s*BEGIN\s*;/im, "").replace(/\s*COMMIT\s*;\s*$/im, "");
const wrapped = `BEGIN;\n${sql}\nROLLBACK;`;

const res = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${TOKEN}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: wrapped }),
});
const text = await res.text();
console.log(`dry-run ${FILE} → HTTP ${res.status}`);
console.log(text.slice(0, 1200));
process.exit(res.ok ? 0 : 1);
