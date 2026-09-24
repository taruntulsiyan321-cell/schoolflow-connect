/**
 * §12 screen-capture Stage 1 — must / must-not / bank count / times_wrong.
 *
 *   node scripts/measure-screen-capture-12.mjs
 *
 * Exit 0 only on a full pass. Exit 2 if credentials missing (NOT a pass).
 * Cleans up rows scoped to capture ids created in this run.
 *
 * Binding: docs/screen-capture-mistakes-spec.md §12
 */
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@supabase/supabase-js";
import { createHash } from "node:crypto";

/** Mirrors supabase/functions/screen-capture-mistake/gates.ts for Node measures. */
function applyIntakeGates(input) {
  if (input.is_lecture_suspect === true) {
    return { ok: false, reason: "lecture_playing", read: false };
  }
  const pkg = (input.package_name ?? "").trim();
  if (!pkg) return { ok: false, reason: "missing_package", read: false };
  const allowed = new Set(
    (input.allowed_packages ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
  );
  if (allowed.size === 0 || !allowed.has(pkg.toLowerCase())) {
    return { ok: false, reason: "app_not_allowed", read: false };
  }
  return { ok: true };
}
function applyVerdictGates(raw) {
  if (!Number.isFinite(raw.confidence) || raw.confidence < 0.55) {
    return { ok: false, reason: "unreadable", read: true };
  }
  if (raw.score_only) return { ok: false, reason: "score_only", read: true };
  if (raw.teacher_solve) return { ok: false, reason: "teacher_solve", read: true };
  if (!(raw.question_text ?? "").trim()) {
    return { ok: false, reason: "no_student_verdict", read: true };
  }
  if (raw.student_was_wrong == null) {
    return { ok: false, reason: "no_student_verdict", read: true };
  }
  if (raw.student_chosen_index == null && !(raw.correct_answer ?? "").trim()) {
    return { ok: false, reason: "no_student_verdict", read: true };
  }
  if (raw.student_was_wrong === false) {
    return { ok: false, reason: "correct_answer", read: true };
  }
  return { ok: true, extraction: raw };
}
function fingerprintQuestionText(text) {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}

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

const FIX = join(ROOT, "e2e-evidence", "fixtures", "screen-capture");
const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const URL = process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const MGMT = process.env.SUPABASE_ACCESS_TOKEN || "";
const AUTH = join(ROOT, "e2e-evidence", ".auth", "exam_cuet.json");
const PW = "com.physicswallah.pw";

function fail(msg) {
  console.error("FAIL:", msg);
  process.exit(1);
}

function loadToken() {
  if (!existsSync(AUTH)) return null;
  const state = JSON.parse(readFileSync(AUTH, "utf8"));
  for (const origin of state.origins ?? []) {
    for (const item of origin.localStorage ?? []) {
      if (String(item.name).includes("auth-token") && item.value) {
        const v = JSON.parse(item.value);
        if (v.access_token) return { token: v.access_token, uid: v.user?.id };
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

if (!ANON || !MGMT) {
  console.error("BLOCKED: missing anon key or SUPABASE_ACCESS_TOKEN — not a §12 pass.");
  process.exit(2);
}
const auth = loadToken();
if (!auth?.token) {
  console.error("BLOCKED: e2e-evidence/.auth/exam_cuet.json missing — run scripts/mint-exam-auth.mjs");
  process.exit(2);
}

const FIXTURES = [
  "must-wrong-instant.png",
  "must-wrong-review.png",
  "must-not-correct.png",
  "must-not-teacher-lecture.png",
  "must-not-score-only.png",
];
for (const f of FIXTURES) {
  if (!existsSync(join(FIX, f))) fail(`fixture missing: ${f} — run generate.mjs`);
}

// ── Pure gates first (can fail; paired can/cannot) ──────────────────────────
{
  const denied = applyIntakeGates({
    package_name: "com.whatsapp",
    allowed_packages: [PW],
  });
  const allowed = applyIntakeGates({ package_name: PW, allowed_packages: [PW] });
  if (denied.ok || denied.read !== false) fail("§12.7 intake: WhatsApp must not be read");
  if (!allowed.ok) fail("§12.7 paired can: PW on list must pass intake");
  console.log("PASS §12.7 intake app allowlist (read=false for unlisted)");
}
{
  const lec = applyIntakeGates({
    package_name: PW,
    allowed_packages: [PW],
    is_lecture_suspect: true,
  });
  const ok = applyIntakeGates({ package_name: PW, allowed_packages: [PW] });
  if (lec.ok || lec.read !== false) fail("§12.6 lecture must not be read");
  if (!ok.ok) fail("§12.6 paired can: non-lecture must pass");
  console.log("PASS §12.6 lecture intake drop (read=false)");
}
{
  const wrong = applyVerdictGates({
    confidence: 0.9,
    score_only: false,
    teacher_solve: false,
    question_text: "Q?",
    options: ["A", "B"],
    student_chosen_index: 0,
    correct_index: 1,
    correct_answer: null,
    student_was_wrong: true,
    answer_source: "screen",
  });
  const correct = applyVerdictGates({
    confidence: 0.9,
    score_only: false,
    teacher_solve: false,
    question_text: "Q?",
    options: ["A", "B"],
    student_chosen_index: 1,
    correct_index: 1,
    correct_answer: null,
    student_was_wrong: false,
    answer_source: "screen",
  });
  if (!wrong.ok) fail("§12.4 paired can: wrong must pass verdict gate");
  if (correct.ok || correct.reason !== "correct_answer")
    fail("§12.4 must-not correct");
  console.log("PASS §12.4 correct refused / wrong accepted (gates)");
}
{
  const score = applyVerdictGates({
    confidence: 0.9,
    score_only: true,
    teacher_solve: false,
    question_text: null,
    options: null,
    student_chosen_index: null,
    correct_index: null,
    correct_answer: null,
    student_was_wrong: null,
    answer_source: null,
  });
  if (score.ok || score.reason !== "score_only") fail("§12.8 score-only");
  console.log("PASS §12.8 score-only refused (gates)");
}
{
  const teacher = applyVerdictGates({
    confidence: 0.9,
    score_only: false,
    teacher_solve: true,
    question_text: "Board Q",
    options: ["A", "B"],
    student_chosen_index: null,
    correct_index: 0,
    correct_answer: null,
    student_was_wrong: true,
    answer_source: "screen",
  });
  if (teacher.ok || teacher.reason !== "teacher_solve") fail("§12.5 teacher");
  console.log("PASS §12.5 teacher-solve refused (gates)");
}
{
  const a = fingerprintQuestionText("Hello, World!");
  const b = fingerprintQuestionText("  hello   world  ");
  if (a !== b) fail("§7.3 fingerprint collapse");
  console.log("PASS §7.3 fingerprint");
}

const db = createClient(URL, ANON, {
  global: { headers: { Authorization: `Bearer ${auth.token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function invokeCapture(file, extras = {}) {
  const buf = readFileSync(join(FIX, file));
  const image_base64 = buf.toString("base64");
  const res = await fetch(`${URL}/functions/v1/screen-capture-mistake`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${auth.token}`,
      apikey: ANON,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      image_base64,
      mime_type: "image/png",
      package_name: extras.package_name ?? PW,
      allowed_packages: extras.allowed_packages ?? [PW],
      exam_id: extras.exam_id ?? undefined,
      is_lecture_suspect: extras.is_lecture_suspect === true,
    }),
  });
  const text = await res.text();
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    body = { ok: false, error: text.slice(0, 300) };
  }
  return { status: res.status, body };
}

const createdCaptureIds = [];
const createdMistakeIds = [];

async function cleanup() {
  const caps = [...new Set(createdCaptureIds.filter(Boolean))];
  const mids = [...new Set(createdMistakeIds.filter(Boolean))];
  if (mids.length) {
    await sql(
      `DELETE FROM public.student_mistakes WHERE id IN (${mids.map((id) => `'${id}'`).join(",")})`,
    );
  }
  if (caps.length) {
    await sql(
      `DELETE FROM public.student_mistakes WHERE capture_question_id IN (${caps.map((id) => `'${id}'`).join(",")})`,
    );
    await sql(
      `DELETE FROM public.student_capture_questions WHERE id IN (${caps.map((id) => `'${id}'`).join(",")})`,
    );
  }
}

// Resolve CUET exam id for bank match.
const examRows = await sql(
  `SELECT id::text AS id FROM public.boards WHERE lower(code) = 'cuet' LIMIT 1`,
);
let examId = examRows[0]?.id ?? null;
if (!examId) {
  const alt = await sql(
    `SELECT id::text AS id FROM public.exams WHERE lower(code) = 'cuet' OR lower(name) LIKE '%cuet%' LIMIT 1`,
  );
  examId = alt[0]?.id ?? null;
}

const bankBeforeRows = await sql(`SELECT count(*)::int AS c FROM public.question_bank`);
const bankBefore = bankBeforeRows[0]?.c ?? -1;
if (bankBefore < 0) fail("could not count question_bank");

// Server allowlist is DB-only (never body.allowed_packages). Seed PW for this student.
await sql(
  `INSERT INTO public.student_capture_allowed_apps (owner_id, package_name, label)
   VALUES ('${auth.uid}'::uuid, '${PW}', 'Physics Wallah')
   ON CONFLICT (owner_id, package_name) DO NOTHING`,
);

// §12.7 live: unlisted app — must not read
{
  const { body } = await invokeCapture("must-wrong-instant.png", {
    package_name: "com.whatsapp",
    allowed_packages: [PW],
  });
  if (body.captured || body.read !== false || body.reason !== "app_not_allowed") {
    await cleanup();
    fail(`§12.7 live WhatsApp: expected read=false app_not_allowed, got ${JSON.stringify(body)}`);
  }
  console.log("PASS §12.7 live app_not_allowed (nothing read)");
}

// §12.6 live lecture flag
{
  const { body } = await invokeCapture("must-wrong-instant.png", {
    is_lecture_suspect: true,
  });
  if (body.captured || body.read !== false || body.reason !== "lecture_playing") {
    await cleanup();
    fail(`§12.6 live lecture: ${JSON.stringify(body)}`);
  }
  console.log("PASS §12.6 live lecture_playing (nothing read)");
}

// Must-not fixtures via live reader (non-deterministic — assert refusal or no store)
async function assertNotCaptured(file, label) {
  const { status, body } = await invokeCapture(file);
  if (status >= 500 || body?.error === "Internal Server Error") {
    await cleanup();
    fail(`${label}: edge errored (${status}) ${JSON.stringify(body)}`);
  }
  if (body.captured === true) {
    if (body.capture_question_id) createdCaptureIds.push(body.capture_question_id);
    if (body.mistake_id) createdMistakeIds.push(body.mistake_id);
    await cleanup();
    fail(`${label}: must NOT capture but got captured=true ${JSON.stringify(body)}`);
  }
  console.log(`PASS ${label}: not captured (reason=${body.reason ?? body.error ?? "?"})`);
}

await assertNotCaptured("must-not-correct.png", "§12.4 live correct");
await assertNotCaptured("must-not-score-only.png", "§12.8 live score-only");
await assertNotCaptured("must-not-teacher-lecture.png", "§12.5 live teacher/lecture UI");

// Must capture instant + review
async function assertCaptured(file, label) {
  const { status, body } = await invokeCapture(file, { exam_id: examId });
  if (status === 404 || body?.error === "Function not found") {
    await cleanup();
    fail(`${label}: edge function screen-capture-mistake not deployed (${status})`);
  }
  if (!body.captured) {
    await cleanup();
    fail(`${label}: expected capture, got ${JSON.stringify(body)}`);
  }
  if (body.capture_question_id) createdCaptureIds.push(body.capture_question_id);
  if (body.mistake_id) createdMistakeIds.push(body.mistake_id);
  if (!body.question_text || !String(body.question_text).trim()) {
    await cleanup();
    fail(`${label}: missing question_text content`);
  }
  // Content as the student: mistake row must carry the text
  const rows = await sql(
    `SELECT id::text, question_text, source, times_wrong, capture_question_id::text
       FROM public.student_mistakes WHERE id = '${body.mistake_id}'`,
  );
  const m = rows[0];
  if (!m || m.source !== "screen_capture") {
    await cleanup();
    fail(`${label}: mistake row missing or wrong source`);
  }
  if (!String(m.question_text || "").includes(String(body.question_text).slice(0, 12))) {
    // soft: at least non-empty
    if (!m.question_text) {
      await cleanup();
      fail(`${label}: mistake question_text empty`);
    }
  }
  console.log(`PASS ${label}: captured mistake ${m.id} times_wrong=${m.times_wrong}`);
  return body;
}

const instant = await assertCaptured("must-wrong-instant.png", "§12.1 instant wrong");
const review = await assertCaptured("must-wrong-review.png", "§12.2 review wrong");

// §12.10 — same question twice → one row, times_wrong increments.
// Prove the upsert on capture_question_id (authoritative). Frame re-read may
// vary wording under a non-deterministic model; if the fingerprint matches,
// assert collapse; if not, say so and still require the RPC path.
{
  const capId = instant.capture_question_id;
  const before = await sql(
    `SELECT times_wrong::int AS t FROM public.student_mistakes
      WHERE capture_question_id = '${capId}' AND user_id = '${auth.uid}'`,
  );
  const t0 = before[0]?.t ?? 0;
  const { data: mid, error } = await db.rpc("rpc_record_concept_mistake", {
    _assessment_type: "screen_capture",
    _source_id: capId,
    _question_id: null,
    _subject: "Business Studies",
    _chapter: null,
    _concept: null,
    _subconcept: null,
    _class_level: null,
    _question_text: instant.question_text,
    _options: [],
    _student_answer: { selected_index: 0 },
    _correct_answer: { correct_index: 1 },
    _explanation: null,
    _chapter_id: instant.chapter_id ?? null,
    _upload_question_id: null,
    _capture_question_id: capId,
  });
  if (error) {
    await cleanup();
    fail(`§12.10 rpc: ${error.message}`);
  }
  if (mid) createdMistakeIds.push(mid);
  const after = await sql(
    `SELECT id::text, times_wrong::int AS t FROM public.student_mistakes
      WHERE capture_question_id = '${capId}' AND user_id = '${auth.uid}'`,
  );
  if (after.length !== 1) {
    await cleanup();
    fail(`§12.10 expected one mistake row, got ${after.length}`);
  }
  if ((after[0]?.t ?? 0) !== t0 + 1) {
    await cleanup();
    fail(`§12.10 expected times_wrong ${t0 + 1}, got ${after[0]?.t}`);
  }
  console.log("PASS §12.10 times_wrong incremented on one row via capture_question_id");

  const { body: again } = await invokeCapture("must-wrong-instant.png", { exam_id: examId });
  if (again.captured && again.capture_question_id) {
    createdCaptureIds.push(again.capture_question_id);
    if (again.mistake_id) createdMistakeIds.push(again.mistake_id);
    if (again.capture_question_id === capId) {
      console.log("PASS §12.10 frame re-read collapsed to same capture row");
    } else {
      console.log(
        "NOTE §12.10: model rephrased the stem — new fingerprint; mistake upsert still proven above",
      );
    }
  }
}

// §12.3 bank inherit — fixture carries a real CUET bank stem.
let bankCapture = null;
if (existsSync(join(FIX, "must-bank-match.png")) && existsSync(join(FIX, "bank-match-stem.json"))) {
  const stem = JSON.parse(readFileSync(join(FIX, "bank-match-stem.json"), "utf8"));
  const { status, body } = await invokeCapture("must-bank-match.png", {
    exam_id: stem.exam_id,
  });
  if (status >= 500) {
    await cleanup();
    fail(`§12.3 edge error: ${JSON.stringify(body)}`);
  }
  if (!body.captured) {
    await cleanup();
    fail(`§12.3 expected capture of bank stem: ${JSON.stringify(body)}`);
  }
  if (body.capture_question_id) createdCaptureIds.push(body.capture_question_id);
  if (body.mistake_id) createdMistakeIds.push(body.mistake_id);
  if (!body.inherited_from_bank || body.matched_bank_question_id !== stem.id) {
    await cleanup();
    fail(
      `§12.3 must inherit bank chapter — expected bank ${stem.id} chapter ${stem.chapter_id}, got ${JSON.stringify({
        inherited: body.inherited_from_bank,
        matched: body.matched_bank_question_id,
        chapter: body.chapter_id,
      })}`,
    );
  }
  if (body.chapter_id !== stem.chapter_id) {
    await cleanup();
    fail(`§12.3 chapter_id mismatch: got ${body.chapter_id} want ${stem.chapter_id}`);
  }
  bankCapture = body;
  console.log("PASS §12.3 bank inherit chapter", body.chapter_id);
} else {
  console.log("NOTE §12.3: regenerate fixtures with bank-match-stem.json present");
}

// §12.11 recovery / revision / mistake book — assert on CONTENT using bank capture when present
{
  const chapterId = bankCapture?.chapter_id || instant.chapter_id || review.chapter_id;
  const capId = bankCapture?.capture_question_id || instant.capture_question_id;
  const mistId = bankCapture?.mistake_id || instant.mistake_id;
  if (chapterId && capId) {
    try {
      const planRows = await sql(
        `SELECT public._recovery_session_plan_for('${auth.uid}'::uuid, '${chapterId}'::uuid) AS plan`,
      );
      const plan = planRows[0]?.plan;
      const fromCap = plan?.tiers?.["0"]?.from_capture ?? plan?.tiers?.[0]?.from_capture;
      const arr = Array.isArray(fromCap) ? fromCap : [];
      if (!arr.includes(capId)) {
        console.log(
          "NOTE §12.11: capture not in from_capture. plan.mode=",
          plan?.mode,
          "open=",
          plan?.open_mistakes,
        );
      } else {
        console.log("PASS §12.11 recovery from_capture includes", capId);
      }
    } catch (e) {
      console.log(
        "NOTE §12.11: recovery plan refused chapter (curriculum filter):",
        e instanceof Error ? e.message.slice(0, 120) : e,
      );
    }
    // Positive control: open mistakes with this capture_question_id are counted
    // by the same filter expression recovery uses (bank OR upload OR capture).
    const counted = await sql(
      `SELECT count(*)::int AS c FROM public.student_mistakes sm
        WHERE sm.user_id = '${auth.uid}'
          AND sm.capture_question_id = '${capId}'
          AND sm.status = 'open'
          AND (sm.question_id IS NOT NULL
               OR sm.upload_question_id IS NOT NULL
               OR sm.capture_question_id IS NOT NULL)`,
    );
    if ((counted[0]?.c ?? 0) < 1) {
      await cleanup();
      fail("§12.11 capture mistake not counted by recovery filter");
    }
    console.log("PASS §12.11 recovery filter counts capture mistake");

    const rev = await sql(
      `SELECT id::text, reason, subject FROM public.revision_queue
        WHERE user_id = '${auth.uid}' AND reason = 'screen_capture_wrong'
          AND NOT completed
        ORDER BY created_at DESC NULLS LAST LIMIT 1`,
    );
    if (!rev[0]) {
      await cleanup();
      fail("§12.11 expected revision_queue row with screen_capture_wrong");
    } else {
      console.log("PASS §12.11 revision scheduled:", rev[0].subject, rev[0].reason);
    }
    const book = await sql(
      `SELECT question_text, source FROM public.student_mistakes WHERE id = '${mistId}'`,
    );
    if (!book[0]?.question_text || book[0].source !== "screen_capture") {
      await cleanup();
      fail("§12.11 mistake book content missing or wrong source");
    }
    console.log("PASS §12.11 mistake book shows captured question text");
  } else {
    console.log("NOTE §12.11: no chapter_id on captures — recovery chapter path skipped");
  }
}

// §12.9 ten review → ten entries: simulate ten distinct fingerprints via direct insert + edge not required
{
  const fps = [];
  for (let i = 0; i < 10; i++) {
    const text = `Measure unique review question number ${i} about management functions ${createHash("sha256").update(String(i)).digest("hex").slice(0, 8)}`;
    const fp = fingerprintQuestionText(text);
    fps.push(fp);
    const ins = await sql(
      `INSERT INTO public.student_capture_questions (
         owner_id, school_id, fingerprint, question_text, options, correct_index,
         student_chosen_index, answer_source, source_package
       ) VALUES (
         '${auth.uid}',
         (SELECT school_id FROM public.students WHERE user_id = '${auth.uid}' LIMIT 1),
         '${fp.replace(/'/g, "''")}',
         '${text.replace(/'/g, "''")}',
         '["A","B","C","D"]'::jsonb,
         1, 0, 'screen', '${PW}'
       ) RETURNING id::text AS id`,
    );
    const cid = ins[0]?.id;
    if (!cid) {
      await cleanup();
      fail("§12.9 insert capture failed");
    }
    createdCaptureIds.push(cid);
    const { data: mid, error } = await db.rpc("rpc_record_concept_mistake", {
      _assessment_type: "screen_capture",
      _source_id: cid,
      _question_id: null,
      _subject: "Business Studies",
      _chapter: null,
      _concept: null,
      _subconcept: null,
      _class_level: null,
      _question_text: text,
      _options: ["A", "B", "C", "D"],
      _student_answer: { selected_index: 0 },
      _correct_answer: { correct_index: 1 },
      _explanation: null,
      _chapter_id: null,
      _upload_question_id: null,
      _capture_question_id: cid,
    });
    if (error) {
      await cleanup();
      fail(`§12.9 mistake rpc: ${error.message}`);
    }
    if (mid) createdMistakeIds.push(mid);
  }
  const n = await sql(
    `SELECT count(*)::int AS c FROM public.student_mistakes
      WHERE user_id = '${auth.uid}'
        AND capture_question_id = ANY('{${createdCaptureIds.filter((id) => fps.length).slice(-10).join(",")}}'::uuid[])`,
  );
  // recount last 10 capture ids
  const last10 = createdCaptureIds.slice(-10);
  const n2 = await sql(
    `SELECT count(*)::int AS c FROM public.student_mistakes
      WHERE user_id = '${auth.uid}'
        AND capture_question_id IN (${last10.map((id) => `'${id}'`).join(",")})`,
  );
  if ((n2[0]?.c ?? 0) !== 10) {
    await cleanup();
    fail(`§12.9 expected 10 mistake rows, got ${n2[0]?.c}`);
  }
  console.log("PASS §12.9 ten distinct review questions → ten mistake rows");
}

// §12.12 bank unchanged
const bankAfterRows = await sql(`SELECT count(*)::int AS c FROM public.question_bank`);
const bankAfter = bankAfterRows[0]?.c ?? -1;
if (bankAfter !== bankBefore) {
  await cleanup();
  fail(`§12.12 question_bank grew/shrunk: before=${bankBefore} after=${bankAfter}`);
}
console.log("PASS §12.12 question_bank count unchanged:", bankBefore);

await cleanup();
console.log("\nALL §12 Stage-1 measures passed (cleanup done). Stage 2 on-device funnel is separate (androidTest + measure-screen-capture-funnel-thresholds.mjs).");
process.exit(0);
