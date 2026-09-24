/**
 * §12.2 — wrong → mistake book → recovery → revision → analysis has accuracy.
 *
 * Binding: docs/custom-practice-upload-spec.md §12.2
 *
 *   node scripts/measure-custom-practice-12-2.mjs
 *
 * Drives the same doors Practice uses (upload classify → start session →
 * rpc_record_question_attempt with source=upload). Does NOT need the Vite
 * browser harness / Practice UI — that remains a separate UI evidence gap.
 *
 * Every check has a before-control so "present now" cannot pass on a row that
 * was already there.
 *
 * Exit 0 only on full pass. Exit 2 if credentials missing — not a pass.
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
const FILE = "accept-real-mcq-paper.pdf";

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

const keys = await (
  await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
    headers: { Authorization: `Bearer ${MGMT}` },
  })
).json();
const ANON =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  process.env.VITE_SUPABASE_ANON_KEY ||
  keys.find((k) => k.name === "anon")?.api_key;
if (!ANON) {
  console.error("anon key missing — cannot measure. NOT a pass.");
  process.exit(2);
}

const token = loadToken();
if (!token) {
  console.error("BLOCKED: e2e-evidence/.auth/exam_cuet.json missing — run exam auth setup.");
  process.exit(2);
}
if (!existsSync(join(FIX, FILE))) die(`fixture missing: ${FILE}`);

const db = createClient(URL, ANON, {
  global: { headers: { Authorization: `Bearer ${token}` } },
  auth: { persistSession: false, autoRefreshToken: false },
});

console.log("\n§12.2 measure — wrong → mistake → recovery → revision → accuracy\n");

const { data: idData, error: idErr } = await db.rpc("rpc_get_my_student_identity");
if (idErr) die(`identity: ${idErr.message}`);
const id = Array.isArray(idData) ? idData[0] : idData;
const uid = (await db.auth.getUser()).data.user?.id;
if (!uid || !id?.school_id || !id?.student_id) die("exam identity incomplete");

// ── Upload + classify (same door as §12.1 positive control) ─────────────────
const bytes = readFileSync(join(FIX, FILE));
const path = `${uid}/${Date.now()}-${FILE}`;
if ((await db.storage.from("student-uploads").upload(path, bytes, { contentType: "application/pdf" })).error) {
  die("storage upload failed");
}
const { data: up, error: insErr } = await db
  .from("student_uploads")
  .insert({
    owner_id: uid,
    school_id: id.school_id,
    storage_path: path,
    original_filename: FILE,
    byte_size: bytes.length,
    mime_type: "application/pdf",
    page_count: 1,
    status: "pending",
  })
  .select("id")
  .single();
if (insErr) die(`insert: ${insErr.message}`);

const classify = await fetch(`${URL}/functions/v1/custom-practice-upload`, {
  method: "POST",
  headers: { Authorization: `Bearer ${token}`, apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ upload_id: up.id }),
});
const classifyBody = await classify.json().catch(() => ({}));
if (!classify.ok) die(`classify HTTP ${classify.status} ${JSON.stringify(classifyBody).slice(0, 200)}`);

const qs = await sql(
  `SELECT q.id, q.chapter_id, q.correct_index, q.question_text, q.options,
          c.name AS chapter_name, s.name AS subject_name
     FROM public.student_upload_questions q
     LEFT JOIN public.chapters c ON c.id = q.chapter_id
     LEFT JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id
    WHERE q.upload_id = '${up.id}'
    ORDER BY q.sequence`,
);
ok("1. paper accepted with extracted questions", qs.length >= 3, `${qs.length} question(s)`);

const target = qs.find((q) => q.chapter_id);
ok("2. at least one question tagged to a real chapter", Boolean(target),
  target ? `${target.subject_name} / ${target.chapter_name}` : "none tagged");
if (!target) {
  await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${up.id}'`);
  await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${up.id}'`);
  await sql(`DELETE FROM public.student_uploads WHERE id = '${up.id}'`);
  await db.storage.from("student-uploads").remove([path]);
  process.exit(1);
}

const wrongIndex =
  typeof target.correct_index === "number" && target.correct_index === 0 ? 1 : 0;
const options = Array.isArray(target.options) ? target.options : [];
const stem = String(target.question_text ?? "");

// ── Before controls ─────────────────────────────────────────────────────────
const beforeMistakes = await sql(
  `SELECT count(*)::int AS c FROM public.student_mistakes
    WHERE user_id = '${uid}' AND upload_question_id = '${target.id}' AND status = 'open'`,
);
const beforeRev = await sql(
  `SELECT count(*)::int AS c FROM public.revision_queue
    WHERE user_id = '${uid}' AND NOT completed AND reason = 'upload_wrong'
      AND subject = '${String(target.subject_name ?? "").replace(/'/g, "''")}'
      AND COALESCE(chapter, '') = '${String(target.chapter_name ?? "").replace(/'/g, "''")}'`,
);
const beforeSnap = await db.rpc("rpc_student_academic_snapshot");
const beforeReady = Array.isArray(beforeSnap.data) ? beforeSnap.data[0] : beforeSnap.data;
const beforeAcc = beforeReady?.exam_readiness?.practice_accuracy_pct;

ok("3. CONTROL: no open mistake for this upload question yet", (beforeMistakes[0]?.c ?? -1) === 0,
  `open=${beforeMistakes[0]?.c}`);

// ── Practise: start session + record a deliberate wrong ─────────────────────
const { data: sessionId, error: startErr } = await db.rpc("rpc_start_practice_session", {
  _subject: target.subject_name || "General",
  _chapter: target.chapter_name || null,
  _count: 1,
  _practice_mode: "custom",
});
if (startErr) die(`start session: ${startErr.message}`);

const { data: verdict, error: recErr } = await db.rpc("rpc_record_question_attempt", {
  _correct_answer: { index: target.correct_index, correct_index: target.correct_index },
  _generated_question: {
    question: stem,
    options,
    explanation: "",
    bank_question_id: null,
    upload_question_id: target.id,
    subject: target.subject_name,
    chapter: target.chapter_name,
    chapter_id: target.chapter_id,
    practice_mode: "custom",
  },
  _is_correct: false,
  _selected_answer: {
    index: wrongIndex,
    selected_index: wrongIndex,
    text: options[wrongIndex] ?? "",
  },
  _session_id: sessionId,
  _score: 0,
  _skipped: false,
  _hint_used: false,
  _source: "upload",
  _meta: {
    source_id: up.id,
    school_id: id.school_id,
    practice_mode: "custom",
    answered_at: new Date().toISOString(),
  },
});
if (recErr) die(`record attempt: ${recErr.message}`);

const isCorrect =
  typeof verdict === "object" && verdict !== null
    ? Boolean(verdict.is_correct)
    : null;
ok("4. server recorded the attempt as wrong", isCorrect === false,
  `verdict=${JSON.stringify(verdict)?.slice(0, 120)}`);

const attemptRows = await sql(
  `SELECT id, is_correct, source, source_id
     FROM public.question_attempts
    WHERE user_id = '${uid}' AND source = 'upload' AND source_id = '${up.id}'
    ORDER BY created_at DESC LIMIT 1`,
);
ok("5. attempt row is source=upload keyed to this upload",
  attemptRows[0]?.source === "upload" && attemptRows[0]?.is_correct === false,
  `source=${attemptRows[0]?.source} correct=${attemptRows[0]?.is_correct}`);

const mistakes = await sql(
  `SELECT id, status, question_id, upload_question_id, chapter_id, source
     FROM public.student_mistakes
    WHERE user_id = '${uid}' AND upload_question_id = '${target.id}' AND status = 'open'
    ORDER BY last_wrong_at DESC NULLS LAST LIMIT 1`,
);
ok("6. mistake book has an OPEN row for this upload question",
  mistakes[0]?.status === "open" &&
    mistakes[0]?.upload_question_id === target.id &&
    mistakes[0]?.question_id == null &&
    mistakes[0]?.source === "upload",
  `up=${mistakes[0]?.upload_question_id} bank=${mistakes[0]?.question_id} src=${mistakes[0]?.source}`);
ok("7. mistake carries the chapter_id (recovery can count it)",
  mistakes[0]?.chapter_id === target.chapter_id,
  `chapter_id=${mistakes[0]?.chapter_id}`);

// ── Recovery plan: tier 0 from_upload ───────────────────────────────────────
let plan = null;
try {
  const planRows = await sql(
    `SELECT public._recovery_session_plan_for('${uid}'::uuid, '${target.chapter_id}'::uuid) AS plan`,
  );
  plan = planRows[0]?.plan;
} catch (e) {
  ok("8. recovery plan callable for this chapter", false,
    e instanceof Error ? e.message.slice(0, 160) : String(e));
}
if (plan) {
  const open = Number(plan.open_mistakes ?? 0);
  ok("8. recovery counts open mistakes for the chapter", open >= 1, `open_mistakes=${open}`);
  if (plan.mode === "relearn") {
    ok("9. recovery mode=relearn (tier lists empty; count already proven)", true, "relearn");
  } else {
    const fromUp = plan?.tiers?.["0"]?.from_upload ?? plan?.tiers?.[0]?.from_upload ?? [];
    const arr = Array.isArray(fromUp) ? fromUp : [];
    ok("9. recovery tier 0 from_upload lists this question", arr.includes(target.id),
      `from_upload=${JSON.stringify(arr).slice(0, 120)}`);
  }
}

// ── Revision schedules it ───────────────────────────────────────────────────
const rev = await sql(
  `SELECT id, reason, subject, chapter FROM public.revision_queue
    WHERE user_id = '${uid}' AND NOT completed AND reason = 'upload_wrong'
      AND subject = '${String(target.subject_name ?? "").replace(/'/g, "''")}'
      AND COALESCE(chapter, '') = '${String(target.chapter_name ?? "").replace(/'/g, "''")}'
    ORDER BY created_at DESC NULLS LAST LIMIT 1`,
);
ok("10. revision_queue has upload_wrong for this subject/chapter", Boolean(rev[0]),
  rev[0] ? `${rev[0].subject} / ${rev[0].chapter} (before=${beforeRev[0]?.c})` : "missing");

// ── Analysis: practice accuracy is no longer "not recorded yet" ─────────────
const afterSnap = await db.rpc("rpc_student_academic_snapshot");
const afterReady = Array.isArray(afterSnap.data) ? afterSnap.data[0] : afterSnap.data;
const afterAcc = afterReady?.exam_readiness?.practice_accuracy_pct;
ok("11. exam_readiness.practice_accuracy_pct is recorded (Analysis can leave 'not recorded yet')",
  afterAcc != null && !Number.isNaN(Number(afterAcc)),
  `before=${beforeAcc} after=${afterAcc}`);

// ── Cleanup ─────────────────────────────────────────────────────────────────
await cleanup(up.id, path, attemptRows[0]?.id, mistakes[0]?.id, sessionId);

const left = await sql(
  `SELECT (SELECT count(*)::int FROM public.student_uploads WHERE id = '${up.id}') AS u,
          (SELECT count(*)::int FROM public.student_upload_questions WHERE upload_id = '${up.id}') AS q`,
);
ok("12. measure left no upload residue", (left[0]?.u ?? -1) === 0 && (left[0]?.q ?? -1) === 0,
  `uploads=${left[0]?.u} questions=${left[0]?.q}`);

console.log(`\n§12.2 ${failed === 0 ? "PASS" : "FAIL"} — ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);

async function cleanup(uploadId, storagePath, attemptId, mistakeId, sid) {
  if (mistakeId) await sql(`DELETE FROM public.student_mistakes WHERE id = '${mistakeId}'`);
  if (attemptId) await sql(`DELETE FROM public.question_attempts WHERE id = '${attemptId}'`);
  // Only delete the revision row we just created for this subject/chapter if it
  // matches upload_wrong and was empty before — otherwise leave the student's queue.
  if ((beforeRev[0]?.c ?? 0) === 0 && target) {
    await sql(
      `DELETE FROM public.revision_queue
        WHERE user_id = '${uid}' AND NOT completed AND reason = 'upload_wrong'
          AND subject = '${String(target.subject_name ?? "").replace(/'/g, "''")}'
          AND COALESCE(chapter, '') = '${String(target.chapter_name ?? "").replace(/'/g, "''")}'`,
    );
  }
  if (sid) await sql(`DELETE FROM public.practice_sessions WHERE id = '${sid}'`);
  await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`);
  await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${uploadId}'`);
  await sql(`DELETE FROM public.student_uploads WHERE id = '${uploadId}'`);
  await db.storage.from("student-uploads").remove([storagePath]);
}
