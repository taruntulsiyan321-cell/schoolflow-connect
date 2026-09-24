import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(name) {
  const p = join(ROOT, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))
      v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env");
const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const MGMT = process.env.SUPABASE_ACCESS_TOKEN;
const q = `
SELECT qb.id::text AS id, qb.question AS question_text, qb.chapter_id::text AS chapter_id,
       qb.exam_id::text AS exam_id
  FROM public.question_bank qb
 WHERE qb.exam_id IS NOT NULL
   AND qb.embed_status = 'embedded'
   AND qb.chapter_id IS NOT NULL
   AND qb.is_active
   AND length(qb.question) BETWEEN 40 AND 200
 ORDER BY qb.created_at
 LIMIT 1`;
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
});
const rows = JSON.parse(await r.text());
const row = Array.isArray(rows) ? rows[0] : null;
if (!row?.question_text) {
  console.error("no stem", rows);
  process.exit(1);
}
writeFileSync(
  join(ROOT, "e2e-evidence/fixtures/screen-capture/bank-match-stem.json"),
  JSON.stringify(row, null, 2),
);
console.log("wrote stem", row.id, row.exam_id, row.question_text.slice(0, 80));
