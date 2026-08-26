// Applies exactly ONE migration file and records it in public.schema_migrations.
// Deliberately not scripts/apply-pending-migrations.mjs: that runs every file
// from the 20260509 cutoff, which would also fire the unapplied destructive
// drop in 20260823100000_drop_school_ops_unused.sql.
import { readFileSync, existsSync } from "fs";

// Same credential lookup the repo's own runner uses: .env.local first.
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

const PROJECT_REF = process.env.PROJECT_REF || process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const TOKEN = process.env.SUPABASE_ACCESS_TOKEN;
const FILE = process.argv[2];
const RECORD = process.argv[3] !== "--no-ledger";

if (!TOKEN) { console.error("no token"); process.exit(2); }
if (!FILE) { console.error("usage: apply-one.mjs <file> [--no-ledger]"); process.exit(2); }

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
  if (!res.ok) throw new Error(`${label}: API ${res.status}\n${text.slice(0, 40000)}`);
  return text;
}

const name = FILE.split(/[/\\]/).pop();
const version = name.replace(/\.sql$/, "");
const sql = readFileSync(FILE, "utf8");

console.log(`Applying ${name} (${sql.length} bytes) to ${PROJECT_REF}…`);
try {
  const out = await runSql(sql, name);
  console.log("APPLIED OK");
  if (out && out.trim() && out.trim() !== "[]") console.log("  returned:", out.slice(0, 800));
} catch (e) {
  console.error("FAILED — nothing was committed (the file is one implicit transaction).");
  console.error(e.message);
  process.exit(1);
}

if (RECORD) {
  await runSql(
    `INSERT INTO public.schema_migrations (version) VALUES ('${version.replace(/'/g, "''")}') ON CONFLICT (version) DO NOTHING;`,
    "ledger",
  );
  console.log(`Ledger recorded: ${version}`);
}
