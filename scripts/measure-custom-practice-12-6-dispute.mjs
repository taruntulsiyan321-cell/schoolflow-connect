/**
 * §12.6 — the AI-answered marker, and what happens when the student says the
 * AI got it wrong.
 *
 *   node scripts/measure-custom-practice-12-6-dispute.mjs
 *
 * Spec: docs/custom-practice-upload-spec.md §6 (where the file carries no key
 * the AI solves it and the question is MARKED as AI-answered) and §6.1 (the
 * marker is not decoration — the student can say the answer is wrong, which
 * clears the mistake it created and removes that attempt from their accuracy).
 *
 * The §6.1 promise is the one that matters: a marker the student cannot act on
 * is worse than no marker, because it tells them the answer might be wrong and
 * then leaves the wrong answer counting against them.
 *
 * Every state change is measured BEFORE and AFTER, so "it is cleared now"
 * cannot pass on a row that was never set in the first place.
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
const OWNER_EMAIL = "919999900123.cuet@exam.vidyalaya.local";
const OTHER_EMAIL = "919999900123.proof_second_exam@exam.vidyalaya.local";

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
  if (!r.ok) die(`sql ${r.status} ${t.slice(0, 250)}`);
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

async function sessionFor(email) {
  const { data: link, error } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  if (error) return null;
  const anonClient = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });
  const { data: sess, error: otpErr } = await anonClient.auth.verifyOtp({
    token_hash: link.properties.hashed_token,
    type: "email",
  });
  if (otpErr) return null;
  const client = createClient(URL, ANON, {
    global: { headers: { Authorization: `Bearer ${sess.session.access_token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  client.__accessToken = sess.session.access_token;
  return client;
}

console.log("\n§12.6 measure — the AI-answered marker, and disputing it\n");

const owner = await sessionFor(OWNER_EMAIL);
if (!owner) die(`no session for ${OWNER_EMAIL}`);
const other = await sessionFor(OTHER_EMAIL);
const id = (await owner.rpc("rpc_get_my_student_identity")).data?.[0];
if (!id?.student_id) die("no student identity");

// ── Upload NOTES: §7.2 makes every note-derived question AI-answered ────────
// The MCQ paper carries its own key, so its questions are answer_source="file"
// and are correctly NOT disputable (§6.2). Notes are the path that produces an
// AI-answered question by definition.
const file = "accept-notes-partnership.pdf";
const bytes = readFileSync(join(FIX, file));
const path = `${id.user_id}/${Date.now()}-${file}`;
if ((await owner.storage.from("student-uploads").upload(path, bytes, { contentType: "application/pdf" })).error) {
  die("upload failed");
}
const { data: up, error: insErr } = await owner
  .from("student_uploads")
  .insert({
    owner_id: id.user_id,
    school_id: id.school_id,
    storage_path: path,
    original_filename: file,
    byte_size: bytes.length,
    mime_type: "application/pdf",
    page_count: 1,
    status: "pending",
  })
  .select("id")
  .single();
if (insErr) die(`insert: ${insErr.message}`);

const res = await fetch(`${URL}/functions/v1/custom-practice-upload`, {
  method: "POST",
  headers: { Authorization: `Bearer ${owner.__accessToken}`, apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ upload_id: up.id }),
});
if (!res.ok) die(`classify HTTP ${res.status}`);

const qs = await sql(
  `SELECT id, answer_source, chapter_id, question_text FROM public.student_upload_questions WHERE upload_id = '${up.id}' ORDER BY sequence`,
);
ok("1. §6/§7.2 a note-derived question is AI-answered, and the row SAYS so",
  qs.some((q) => q.answer_source === "ai"),
  `${qs.length} question(s), answer_source: ${[...new Set(qs.map((q) => q.answer_source))].join(", ")}`);

const target = qs.find((q) => q.answer_source === "ai");
if (!target) die("no questions to dispute");

// ── The student answers it wrong: an attempt and a mistake ──────────────────
// Written exactly as the practice runner writes it. The runner stamps
// upload_question_id into the generated_question snapshot (699bb1a2) and the
// dispute RPC finds the attempt by that stamp — so an attempt without it is
// not what the app produces, and testing one would measure the wrong thing.
const stem = String(target.question_text ?? "").replace(/'/g, "''");
const attempt = await sql(`
  INSERT INTO public.question_attempts
    (user_id, student_id, school_id, generated_question, correct_answer, score,
     is_correct, skipped, source, source_id, practice_mode, subject, chapter)
  VALUES ('${id.user_id}', '${id.student_id}', '${id.school_id}',
          jsonb_build_object('upload_question_id', '${target.id}', 'question', '${stem}'),
          '{"indexes":[0]}'::jsonb, 0,
          false, false, 'upload', '${up.id}', 'custom', 'Accountancy', 'Partnership')
  RETURNING id, excluded_from_accuracy`);
const mistake = await sql(`
  INSERT INTO public.student_mistakes
    (user_id, student_id, school_id, source, source_id, upload_question_id,
     subject, chapter, question_text, correct_answer, times_wrong, last_wrong_at, status)
  VALUES ('${id.user_id}', '${id.student_id}', '${id.school_id}', 'upload', '${up.id}',
          '${target.id}', 'Accountancy', 'Partnership', '${stem}',
          '{"indexes":[0]}'::jsonb, 1, now(), 'open')
  RETURNING id, status`);

ok("2. CONTROL before disputing: the mistake is OPEN and the attempt COUNTS",
  mistake[0]?.status === "open" && attempt[0]?.excluded_from_accuracy === false,
  `mistake=${mistake[0]?.status} excluded=${attempt[0]?.excluded_from_accuracy}`);

// ── Somebody else must not be able to dispute it ────────────────────────────
if (other) {
  const { error: theirErr } = await other.rpc("rpc_dispute_ai_upload_answer", {
    _upload_question_id: target.id,
  });
  ok("3. another account cannot dispute this question", Boolean(theirErr),
    theirErr?.message?.slice(0, 80) ?? "IT SUCCEEDED");
  const stillOpen = await sql(
    `SELECT status FROM public.student_mistakes WHERE id = '${mistake[0].id}'`,
  );
  ok("4. and their attempt changed nothing", stillOpen[0]?.status === "open",
    `mistake is ${stillOpen[0]?.status}`);
}

// ── The owner disputes it ───────────────────────────────────────────────────
const { error: dispErr } = await owner.rpc("rpc_dispute_ai_upload_answer", {
  _upload_question_id: target.id,
});
ok("5. §6.1 the owner can dispute an AI-answered question", !dispErr, dispErr?.message ?? "accepted");

const afterM = await sql(
  `SELECT status, cleared_at FROM public.student_mistakes WHERE id = '${mistake[0].id}'`,
);
const afterA = await sql(
  `SELECT excluded_from_accuracy FROM public.question_attempts WHERE id = '${attempt[0].id}'`,
);
ok("6. §6.1 disputing CLEARS the mistake it created",
  afterM[0]?.status !== "open" && afterM[0]?.cleared_at !== null,
  `status=${afterM[0]?.status} cleared_at=${afterM[0]?.cleared_at ? "set" : "null"}`);
ok("7. §6.1 and removes that attempt from their accuracy",
  afterA[0]?.excluded_from_accuracy === true,
  `excluded_from_accuracy=${afterA[0]?.excluded_from_accuracy}`);

// ── Clean up ────────────────────────────────────────────────────────────────
await sql(`DELETE FROM public.student_mistakes WHERE id = '${mistake[0].id}'`);
await sql(`DELETE FROM public.question_attempts WHERE id = '${attempt[0].id}'`);
await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${up.id}'`);
await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${up.id}'`);
await sql(`DELETE FROM public.student_uploads WHERE id = '${up.id}'`);
await owner.storage.from("student-uploads").remove([path]);

const left = await sql(
  `SELECT (SELECT count(*) FROM public.student_uploads WHERE id = '${up.id}')::int AS u,
          (SELECT count(*) FROM public.question_attempts WHERE id = '${attempt[0].id}')::int AS a`,
);
ok("8. the measure left nothing of its own behind",
  (left[0]?.u ?? -1) === 0 && (left[0]?.a ?? -1) === 0,
  `uploads=${left[0]?.u} attempts=${left[0]?.a}`);

console.log(`\n§12.6 ${failed === 0 ? "PASS" : "FAIL"} — ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
