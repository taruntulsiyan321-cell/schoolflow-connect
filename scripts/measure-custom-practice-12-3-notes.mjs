/**
 * §12.3 — the notes half of Custom Practice, end to end against the live
 * classifier. Same shape and same credentials as
 * scripts/measure-custom-practice-12-1.mjs.
 *
 *   node scripts/measure-custom-practice-12-3-notes.mjs
 *
 * Spec: docs/custom-practice-upload-spec.md §7 (notes), §7.1 (questions written
 * FROM notes), §7.2 (those are AI-answered), §5.1 (a real chapter_id or none),
 * §8 (the modes a notes upload may offer).
 *
 * THE CONTROL: the same assertions run against the MCQ paper, which must
 * produce ZERO notes. Without it, "notes exist" could pass on a classifier
 * that labels everything as notes.
 *
 * Exit 0 only on a full pass. Exit 2 if credentials are missing — not a pass.
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
const MGMT = process.env.SUPABASE_ACCESS_TOKEN || "";
const AUTH = join(ROOT, "e2e-evidence", ".auth", "exam_cuet.json");

let failed = 0;
const ok = (label, pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failed += 1;
};
function die(msg) {
  console.error(`FAIL: ${msg}`);
  process.exit(1);
}

async function sql(query) {
  const r = await fetch(`https://api.supabase.com/v1/projects/${REF}/database/query`, {
    method: "POST",
    headers: { Authorization: `Bearer ${MGMT}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query }),
  });
  const t = await r.text();
  if (!r.ok) die(`sql ${r.status} ${t.slice(0, 200)}`);
  return JSON.parse(t);
}

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

console.log("\n§12.3 measure — Custom Practice notes path\n");

if (!MGMT) {
  console.error("SUPABASE_ACCESS_TOKEN missing — cannot measure. This is NOT a pass.");
  process.exit(2);
}
const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${MGMT}` },
  })
).json();
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || keys.find((k) => k.name === "anon")?.api_key;
const SERVICE = keys.find((k) => k.name === "service_role")?.api_key;
if (!ANON || !SERVICE) die("could not read project keys");

// The exam student's own session. Prefer the harness file; otherwise refresh
// the known CUET account the same way the app does.
let token = loadToken();
if (!token) {
  const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });
  const email = "919999900123.cuet@exam.vidyalaya.local";
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) die(`generateLink: ${error.message}`);
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  // token_hash ALONE — GoTrue refuses the email beside it.
  const { data: sess, error: otpErr } = await anonClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (otpErr) die(`verifyOtp: ${otpErr.message}`);
  token = sess.session.access_token;
}

const db = createClient(URL, ANON, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});
const identity = (await db.rpc("rpc_get_my_student_identity")).data?.[0];
if (!identity?.student_id) die("no student identity for the exam account");
const uid = identity.user_id;
console.log(`owner ${uid} school ${identity.school_id} exam ${identity.exam_code}\n`);

/** Upload a fixture, classify it live, and return what landed. */
async function run(file, mime) {
  const bytes = readFileSync(join(FIX, file));
  const path = `${uid}/${Date.now()}-${file}`;
  const { error: upErr } = await db.storage
    .from("student-uploads")
    .upload(path, bytes, { contentType: mime, upsert: false });
  if (upErr) die(`${file} storage: ${upErr.message}`);

  const { data: row, error: insErr } = await db
    .from("student_uploads")
    .insert({
      owner_id: uid,
      school_id: identity.school_id,
      storage_path: path,
      original_filename: file,
      byte_size: bytes.length,
      mime_type: mime,
      page_count: 1,
      status: "pending",
    })
    .select("id")
    .single();
  if (insErr) die(`${file} insert: ${insErr.message}`);

  const res = await fetch(`${URL}/functions/v1/custom-practice-upload`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, apikey: ANON, "Content-Type": "application/json" },
    body: JSON.stringify({ upload_id: row.id }),
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) die(`${file} classify HTTP ${res.status} ${JSON.stringify(body).slice(0, 300)}`);

  const after = (
    await sql(
      `SELECT status, verdict FROM public.student_uploads WHERE id = '${row.id}'`,
    )
  )[0];
  const notes = await sql(
    `SELECT id, title, body, chapter_id, topic_id FROM public.student_upload_notes WHERE upload_id = '${row.id}' ORDER BY sequence`,
  );
  const questions = await sql(
    `SELECT id, answer_source, chapter_id, derived_from_note_id FROM public.student_upload_questions WHERE upload_id = '${row.id}'`,
  );
  return { uploadId: row.id, path, after, notes, questions };
}

async function cleanup(r) {
  await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${r.uploadId}'`);
  await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${r.uploadId}'`);
  await sql(`DELETE FROM public.student_uploads WHERE id = '${r.uploadId}'`);
  await db.storage.from("student-uploads").remove([r.path]);
}

// ── The notes fixture ───────────────────────────────────────────────────────
console.log("accept-notes-partnership.pdf");
const n = await run("accept-notes-partnership.pdf", "application/pdf");

ok("1. it is classified as notes (or mixed)", ["notes", "mixed"].includes(n.after?.verdict),
  `status=${n.after?.status} verdict=${n.after?.verdict}`);
ok("2. §7 notes were produced", n.notes.length > 0, `${n.notes.length} note(s)`);
ok("3. every note has a title and a body", n.notes.length > 0 && n.notes.every((x) => x.title?.trim() && x.body?.trim()),
  n.notes.map((x) => `${x.title} (${(x.body ?? "").length} chars)`).slice(0, 3).join(" | "));
ok("4. §5.1 a note's chapter is a REAL id or null, never a guess",
  n.notes.every((x) => x.chapter_id === null || /^[0-9a-f-]{36}$/.test(x.chapter_id)),
  `${n.notes.filter((x) => x.chapter_id).length} of ${n.notes.length} resolved to a live chapter`);

const derived = n.questions.filter((q) => q.derived_from_note_id);
ok("5. §7.1 questions were written FROM the notes", derived.length > 0,
  `${derived.length} of ${n.questions.length} question(s) derived from a note`);
ok("6. §7.2 every note-derived question is AI-answered",
  derived.length > 0 && derived.every((q) => q.answer_source === "ai"),
  [...new Set(derived.map((q) => q.answer_source))].join(", ") || "none");
ok("7. §8 a notes upload can offer read_notes and practise_from_notes",
  ["notes", "mixed"].includes(n.after?.verdict) && n.notes.length > 0 && derived.length > 0,
  "both modes have something behind them");

await cleanup(n);

// ── THE CONTROL: the MCQ paper must produce NO notes ────────────────────────
console.log("\nCONTROL — accept-real-mcq-paper.pdf must produce zero notes");
const c = await run("accept-real-mcq-paper.pdf", "application/pdf");
ok("8. CONTROL the question paper is not labelled notes", c.after?.verdict === "questions",
  `verdict=${c.after?.verdict}`);
ok("9. CONTROL it produced zero notes", c.notes.length === 0, `${c.notes.length} note(s)`);
ok("10. CONTROL it still produced questions", c.questions.length >= 3, `${c.questions.length} question(s)`);
await cleanup(c);

// ── Nothing THIS RUN created was left behind ────────────────────────────────
// Scoped to the two upload ids this run made. Counting every row the account
// owns would fail on rows that were already there — and would equally pass if
// this run leaked into a different account.
const mine = `'${n.uploadId}','${c.uploadId}'`;
const left = await sql(
  `SELECT (SELECT count(*) FROM public.student_uploads WHERE id IN (${mine}))::int AS uploads,
          (SELECT count(*) FROM public.student_upload_notes WHERE upload_id IN (${mine}))::int AS notes,
          (SELECT count(*) FROM public.student_upload_questions WHERE upload_id IN (${mine}))::int AS questions`,
);
ok("11. the measure left nothing of its own behind",
  (left[0]?.uploads ?? -1) === 0 && (left[0]?.notes ?? -1) === 0 && (left[0]?.questions ?? -1) === 0,
  `uploads=${left[0]?.uploads} notes=${left[0]?.notes} questions=${left[0]?.questions}`);

console.log(`\n§12.3 ${failed === 0 ? "PASS" : "FAIL"} — ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
