import { readFileSync, existsSync } from "node:fs";
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
const state = JSON.parse(readFileSync(join(ROOT, "e2e-evidence/.auth/exam_cuet.json"), "utf8"));
let uid;
for (const o of state.origins ?? []) {
  for (const i of o.localStorage ?? []) {
    if (String(i.name).includes("auth-token")) uid = JSON.parse(i.value).user?.id;
  }
}
const q = `
DELETE FROM public.student_mistakes
 WHERE user_id = '${uid}' AND source = 'screen_capture';
DELETE FROM public.student_capture_questions WHERE owner_id = '${uid}';
SELECT 1 AS ok;
`;
const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
  method: "POST",
  headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
  body: JSON.stringify({ query: q }),
});
console.log(await r.text());
