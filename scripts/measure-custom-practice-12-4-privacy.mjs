/**
 * §12.4 — the privacy fence, measured between two real exam accounts held by
 * the SAME phone number.
 *
 *   node scripts/measure-custom-practice-12-4-privacy.mjs
 *
 * Spec: docs/custom-practice-upload-spec.md §2 (an upload belongs to the
 * account it came from and is visible to nobody else) and §12.4.
 *
 * EVERY "cannot see" IS PAIRED WITH A "can see" on the identical query as the
 * owner. A fence measured only from outside passes just as well when the rows
 * were never written, or when the query was wrong.
 *
 * Both accounts must already exist. Exit 2 if they do not — that is not a pass.
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

/** One phone, two exams — the shape the ruling of 2026-09-23 created. */
const PHONE = "919999900123";
const OWNER_EMAIL = `${PHONE}.cuet@exam.vidyalaya.local`;
const OTHER_EMAIL = process.env.E2E_EXAM_SECOND_EMAIL || `${PHONE}.proof_second_exam@exam.vidyalaya.local`;

let failed = 0;
const ok = (label, pass, detail = "") => {
  console.log(`  ${pass ? "PASS" : "FAIL"}  ${label}${detail ? " — " + detail : ""}`);
  if (!pass) failed += 1;
};
const die = (m) => {
  console.error(`FAIL: ${m}`);
  process.exit(1);
};

if (!MGMT) {
  console.error("SUPABASE_ACCESS_TOKEN missing — cannot measure. NOT a pass.");
  process.exit(2);
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

const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${MGMT}` },
  })
).json();
const ANON = keys.find((k) => k.name === "anon")?.api_key;
const SERVICE = keys.find((k) => k.name === "service_role")?.api_key;
if (!ANON || !SERVICE) die("could not read project keys");
const admin = createClient(URL, SERVICE, { auth: { persistSession: false, autoRefreshToken: false } });

/** A real session for one exam account, minted the way the app mints one. */
async function sessionFor(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) return null;
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  // token_hash ALONE — GoTrue refuses a body that also carries the email.
  const { data: sess, error: otpErr } = await anonClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (otpErr) return null;
  const client = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // Keep the raw token: the edge function is called with fetch, not through
  // the client, and a supabase-js client does not hand its header back.
  client.__accessToken = sess.session.access_token;
  return client;
}

console.log("\n§12.4 measure — one phone, two exams, no sight of each other\n");

const owner = await sessionFor(OWNER_EMAIL);
const other = await sessionFor(OTHER_EMAIL);
if (!owner) die(`no session for ${OWNER_EMAIL}`);
if (!other) {
  console.error(
    `\nNo session for ${OTHER_EMAIL}.\n` +
      "This measure needs a SECOND exam account on the same phone. Create one, then re-run.\n" +
      "This is NOT a pass.",
  );
  process.exit(2);
}

const ownerId = (await owner.rpc("rpc_get_my_student_identity")).data?.[0];
const otherId = (await other.rpc("rpc_get_my_student_identity")).data?.[0];
if (!ownerId?.student_id || !otherId?.student_id) die("one of the accounts has no student identity");

ok("0. they really are two accounts, one number, two spaces",
  ownerId.user_id !== otherId.user_id && ownerId.school_id !== otherId.school_id,
  `${ownerId.exam_code} vs ${otherId.exam_code}`);

// ── The owner uploads something real ────────────────────────────────────────
const file = "accept-notes-partnership.pdf";
const bytes = readFileSync(join(FIX, file));
const path = `${ownerId.user_id}/${Date.now()}-${file}`;
const { error: upErr } = await owner.storage
  .from("student-uploads")
  .upload(path, bytes, { contentType: "application/pdf", upsert: false });
if (upErr) die(`owner upload: ${upErr.message}`);

const { data: row, error: insErr } = await owner
  .from("student_uploads")
  .insert({
    owner_id: ownerId.user_id,
    school_id: ownerId.school_id,
    storage_path: path,
    original_filename: file,
    byte_size: bytes.length,
    mime_type: "application/pdf",
    page_count: 1,
    status: "pending",
  })
  .select("id")
  .single();
if (insErr) die(`owner insert: ${insErr.message}`);
const uploadId = row.id;

const res = await fetch(`${URL}/functions/v1/custom-practice-upload`, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${owner.__accessToken}`,
    apikey: ANON,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({ upload_id: uploadId }),
});
if (!res.ok) die(`classify HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);

// There must be something to fail to see.
const seeded = (
  await sql(
    `SELECT (SELECT count(*) FROM public.student_upload_questions WHERE upload_id = '${uploadId}')::int AS q,
            (SELECT count(*) FROM public.student_upload_notes WHERE upload_id = '${uploadId}')::int AS n`,
  )
)[0];
ok("1. CONTROL the upload really produced rows to hide",
  (seeded.q ?? 0) + (seeded.n ?? 0) > 0, `${seeded.q} question(s), ${seeded.n} note(s)`);

// ── Each "cannot see" beside its "can see" ──────────────────────────────────
const pair = async (label, table, column, value) => {
  const mine = await owner.from(table).select("id").eq(column, value);
  const theirs = await other.from(table).select("id").eq(column, value);
  ok(`CONTROL ${label}: the owner can see it`, (mine.data ?? []).length > 0,
    mine.error?.message ?? `${(mine.data ?? []).length} row(s)`);
  ok(`${label}: the other exam cannot`, (theirs.data ?? []).length === 0,
    theirs.error?.message ?? `${(theirs.data ?? []).length} row(s)`);
};

await pair("2. the upload row", "student_uploads", "id", uploadId);
await pair("3. its questions", "student_upload_questions", "upload_id", uploadId);
await pair("4. its notes", "student_upload_notes", "upload_id", uploadId);

// ── The file itself, not just the rows ──────────────────────────────────────
const mineFile = await owner.storage.from("student-uploads").download(path);
const theirsFile = await other.storage.from("student-uploads").download(path);
ok("CONTROL 5. the owner can download their own file", !mineFile.error && !!mineFile.data,
  mineFile.error?.message ?? `${mineFile.data?.size ?? 0} bytes`);
ok("5. the other exam cannot download it", !!theirsFile.error || !theirsFile.data,
  theirsFile.error?.message ?? `GOT ${theirsFile.data?.size ?? 0} BYTES`);

// ── And nothing of it shows up in a blind listing ───────────────────────────
const blind = await other.from("student_uploads").select("id");
ok("6. a blind list as the other exam returns none of the owner's uploads",
  !(blind.data ?? []).some((r) => r.id === uploadId), `${(blind.data ?? []).length} row(s) visible to them`);

// ── Clean up ────────────────────────────────────────────────────────────────
await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`);
await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${uploadId}'`);
await sql(`DELETE FROM public.student_uploads WHERE id = '${uploadId}'`);
await owner.storage.from("student-uploads").remove([path]);

console.log(`\n§12.4 ${failed === 0 ? "PASS" : "FAIL"} — ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
