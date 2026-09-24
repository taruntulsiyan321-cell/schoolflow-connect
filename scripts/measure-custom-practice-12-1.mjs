/**
 * §12.1 refusal battery — same assertions as e2e-evidence/custom-practice.spec.ts,
 * runnable without Playwright when the browser harness is mid-install.
 *
 *   node scripts/measure-custom-practice-12-1.mjs
 *
 * Exit 0 only when six refusals + one accept pass with zero-row / ≥3-question
 * positive controls. Exit 2 if credentials missing (not a pass).
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv(name) {
  const p = join(ROOT, name);
  if (!existsSync(p)) return;
  for (const line of readFileSync(p, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/);
    if (!m || process.env[m[1]] !== undefined) continue;
    let v = m[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    process.env[m[1]] = v;
  }
}
loadEnv(".env.local");
loadEnv(".env");

const FIX = join(ROOT, "e2e-evidence", "fixtures", "custom-practice");
const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const URL = process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const MGMT = process.env.SUPABASE_ACCESS_TOKEN || "";
const AUTH = join(ROOT, "e2e-evidence", ".auth", "exam_cuet.json");

const REFUSE = [
  "refuse-timetable.png",
  "refuse-blurry-dark.png",
  "refuse-prose.png",
  "refuse-receipt.png",
  "refuse-blank.png",
  "refuse-chat.png",
];

function loadToken() {
  if (!existsSync(AUTH)) return null;
  const state = JSON.parse(readFileSync(AUTH, "utf8"));
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (String(item.name).includes("auth-token") && item.value) {
        const v = JSON.parse(item.value);
        if (v.access_token) return v.access_token;
      }
    }
  }
  return null;
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const text = await r.text();
  const body = JSON.parse(text);
  if (!r.ok) throw new Error(`SQL ${r.status}: ${body?.message || text.slice(0, 200)}`);
  return Array.isArray(body) ? body : body?.data ?? body;
}

async function countDownstream(uploadId) {
  const [q, n, a, m] = await Promise.all([
    sql(`SELECT count(*)::int AS c FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`),
    sql(`SELECT count(*)::int AS c FROM public.student_upload_notes WHERE upload_id = '${uploadId}'`),
    sql(
      `SELECT count(*)::int AS c FROM public.question_attempts qa
        JOIN public.student_uploads u ON u.id = '${uploadId}'
       WHERE qa.user_id = u.owner_id AND qa.source = 'upload'
         AND qa.created_at >= u.created_at`,
    ),
    sql(
      `SELECT count(*)::int AS c FROM public.student_mistakes sm
        JOIN public.student_uploads u ON u.id = '${uploadId}'
       WHERE sm.user_id = u.owner_id
         AND sm.created_at >= u.created_at
         AND (sm.upload_question_id IN (SELECT id FROM public.student_upload_questions WHERE upload_id = '${uploadId}')
              OR sm.source = 'upload')`,
    ),
  ]);
  return {
    questions: q[0]?.c ?? -1,
    notes: n[0]?.c ?? -1,
    attempts: a[0]?.c ?? -1,
    mistakes: m[0]?.c ?? -1,
  };
}

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

if (!ANON || !MGMT) {
  console.error("BLOCKED: missing anon key or SUPABASE_ACCESS_TOKEN — not a §12.1 pass.");
  process.exit(2);
}
const token = loadToken();
if (!token) {
  console.error("BLOCKED: e2e-evidence/.auth/exam_cuet.json missing — run scripts/mint-exam-auth.mjs");
  process.exit(2);
}
for (const f of [...REFUSE, "accept-real-mcq-paper.pdf"]) {
  if (!existsSync(join(FIX, f))) fail(`fixture missing: ${f}`);
}

const db = createClient(URL, ANON, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: idData, error: idErr } = await db.rpc("rpc_get_my_student_identity");
if (idErr) fail(`identity: ${idErr.message}`);
const id = Array.isArray(idData) ? idData[0] : idData;
const uid = (await db.auth.getUser()).data.user?.id;
if (!uid || !id?.school_id) fail("exam identity incomplete");

console.log("§12.1 measure — Custom Practice refusal battery\n");
console.log(`owner ${uid} school ${id.school_id}\n`);

let refused = 0;
for (const name of REFUSE) {
  process.stdout.write(`  refuse ${name}… `);
  const bytes = readFileSync(join(FIX, name));
  const path = `${uid}/${Date.now()}-${name}`;
  const { error: upErr } = await db.storage.from("student-uploads").upload(path, bytes, {
    contentType: "image/png",
    upsert: false,
  });
  if (upErr) fail(`${name} storage: ${upErr.message}`);

  const { data: row, error: insErr } = await db
    .from("student_uploads")
    .insert({
      owner_id: uid,
      school_id: id.school_id,
      storage_path: path,
      original_filename: name,
      byte_size: bytes.length,
      mime_type: "image/png",
      page_count: 1,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr) fail(`${name} insert: ${insErr.message}`);
  const uploadId = row.id;

  const classify = await fetch(`${URL}/functions/v1/custom-practice-upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ upload_id: uploadId }),
  });
  const body = await classify.json().catch(() => ({}));
  if (!classify.ok && classify.status !== 200) {
    fail(`${name} classify HTTP ${classify.status} ${JSON.stringify(body).slice(0, 200)}`);
  }

  const { data: after } = await db
    .from("student_uploads")
    .select("status, verdict, refusal_reason, confidence")
    .eq("id", uploadId)
    .single();

  if (after?.status !== "unusable" || after?.verdict !== "unusable") {
    fail(`${name} expected unusable, got ${JSON.stringify(after)}`);
  }
  if (!String(after?.refusal_reason || "").trim()) fail(`${name} empty refusal_reason`);

  const counts = await countDownstream(uploadId);
  if (counts.questions !== 0 || counts.notes !== 0 || counts.attempts !== 0 || counts.mistakes !== 0) {
    fail(`${name} downstream not zero: ${JSON.stringify(counts)}`);
  }

  await db.from("student_uploads").delete().eq("id", uploadId);
  await db.storage.from("student-uploads").remove([path]);
  refused += 1;
  console.log(`PASS — ${after.refusal_reason}`);
}

process.stdout.write("  accept accept-real-mcq-paper.pdf… ");
{
  const bytes = readFileSync(join(FIX, "accept-real-mcq-paper.pdf"));
  const path = `${uid}/${Date.now()}-accept-real-mcq-paper.pdf`;
  const { error: upErr } = await db.storage.from("student-uploads").upload(path, bytes, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) fail(`accept storage: ${upErr.message}`);

  const { data: row, error: insErr } = await db
    .from("student_uploads")
    .insert({
      owner_id: uid,
      school_id: id.school_id,
      storage_path: path,
      original_filename: "accept-real-mcq-paper.pdf",
      byte_size: bytes.length,
      mime_type: "application/pdf",
      page_count: 1,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr) fail(`accept insert: ${insErr.message}`);
  const uploadId = row.id;

  const classify = await fetch(`${URL}/functions/v1/custom-practice-upload`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ upload_id: uploadId }),
  });
  const body = await classify.json().catch(() => ({}));
  if (!classify.ok) fail(`accept classify HTTP ${classify.status} ${JSON.stringify(body).slice(0, 300)}`);

  const { data: after } = await db
    .from("student_uploads")
    .select("status, verdict, refusal_reason")
    .eq("id", uploadId)
    .single();
  if (after?.status !== "ready") fail(`accept status ${JSON.stringify(after)}`);
  if (!["questions", "mixed"].includes(after?.verdict)) fail(`accept verdict ${after?.verdict}`);

  const q = await sql(
    `SELECT count(*)::int AS c FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`,
  );
  const n = q[0]?.c ?? 0;
  if (n < 3) fail(`accept expected ≥3 questions, got ${n}`);

  await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`);
  await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${uploadId}'`);
  await sql(`DELETE FROM public.student_uploads WHERE id = '${uploadId}'`);
  await db.storage.from("student-uploads").remove([path]);
  console.log(`PASS — ready/${after.verdict}, ${n} questions`);
}

console.log(`\n§12.1 PASS — ${refused}/6 refused, 1 accepted (positive control)`);
process.exit(0);
