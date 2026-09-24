/**
 * Custom Practice — docs/custom-practice-upload-spec.md §12 evidence.
 *
 * Spec name matches playwright.evidence.config.ts testMatch (`custom-practice`).
 * Runs as the individual CUET account (auth.exam.setup.ts).
 *
 * §12.1 refusal battery + positive control, and §12.2 wrong→mistake→recovery,
 * use the live API/RPC path (same doors Practice uses). Full Practice UI in
 * the browser remains a separate harness gap — not required for §12.2 data.
 */
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { authFile } from "./roles";

const FIX = join("e2e-evidence", "fixtures", "custom-practice");
const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const URL = process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
let ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
const MGMT = process.env.SUPABASE_ACCESS_TOKEN || "";

const REFUSE = [
  "refuse-timetable.png",
  "refuse-blurry-dark.png",
  "refuse-prose.png",
  "refuse-receipt.png",
  "refuse-blank.png",
  "refuse-chat.png",
] as const;

async function sql(query: string) {
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

function loadAuthToken(role: string): string | null {
  const p = authFile(role);
  if (!existsSync(p)) return null;
  try {
    const state = JSON.parse(readFileSync(p, "utf8"));
    for (const origin of state.origins ?? []) {
      for (const item of origin.localStorage ?? []) {
        if (String(item.name).includes("auth-token") && item.value) {
          const v = JSON.parse(item.value);
          if (v.access_token) return v.access_token as string;
        }
      }
    }
  } catch {
    return null;
  }
  return null;
}

async function countDownstream(uploadId: string) {
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

test.describe("Custom Practice §12 — individual exam student", () => {
  test.use({ storageState: authFile("exam_cuet") });

  test.beforeAll(async () => {
    test.skip(!existsSync(authFile("exam_cuet")), "exam_cuet storageState missing — auth.exam.setup did not mint");
    test.skip(!MGMT, "SUPABASE_ACCESS_TOKEN missing — cannot assert zero downstream rows");
    if (!ANON && MGMT) {
      const keys = await (
        await fetch(`https://api.supabase.com/v1/projects/${REF}/api-keys`, {
          headers: { Authorization: `Bearer ${MGMT}` },
        })
      ).json();
      ANON = keys.find((k: { name: string }) => k.name === "anon")?.api_key ?? "";
    }
    test.skip(!ANON, "anon key missing");
    for (const f of [...REFUSE, "accept-real-mcq-paper.pdf"]) {
      test.skip(!existsSync(join(FIX, f)), `fixture missing: ${f}`);
    }
  });

  test("§12.1 refusal battery — six files unusable with zero downstream rows", async ({ page }) => {
    test.setTimeout(600_000);
    const token = loadAuthToken("exam_cuet");
    expect(token, "exam_cuet access token in storageState").toBeTruthy();

    const db = createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token!}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const { data: idData, error: idErr } = await db.rpc("rpc_get_my_student_identity");
    expect(idErr, `identity: ${idErr?.message}`).toBeNull();
    const id = Array.isArray(idData) ? idData[0] : idData;
    expect(id?.school_id, "exam account has school_id").toBeTruthy();

    // Positive control for the battery loop: the accept paper must succeed later.
    // Each refuse case: upload → classify → unusable → zero rows.
    for (const name of REFUSE) {
      const bytes = readFileSync(join(FIX, name));
      const path = `${id.user_id ?? (await db.auth.getUser()).data.user?.id}/${Date.now()}-${name}`;
      const { error: upErr } = await db.storage.from("student-uploads").upload(path, bytes, {
        contentType: "image/png",
        upsert: false,
      });
      expect(upErr, `${name} storage: ${upErr?.message}`).toBeNull();

      const { data: row, error: insErr } = await db
        .from("student_uploads")
        .insert({
          owner_id: (await db.auth.getUser()).data.user!.id,
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
      expect(insErr, `${name} insert: ${insErr?.message}`).toBeNull();
      const uploadId = row!.id as string;

      const classify = await page.request.post(`${URL}/functions/v1/custom-practice-upload`, {
        headers: {
          Authorization: `Bearer ${token}`,
          apikey: ANON,
          "Content-Type": "application/json",
        },
        data: { upload_id: uploadId },
        timeout: 180_000,
      });
      const body = await classify.json();
      expect(classify.ok() || classify.status() === 200, `${name} classify HTTP ${classify.status()}`).toBeTruthy();

      const { data: after } = await db
        .from("student_uploads")
        .select("status, verdict, refusal_reason, confidence")
        .eq("id", uploadId)
        .single();

      expect(after?.status, `${name} status`).toBe("unusable");
      expect(after?.verdict, `${name} verdict`).toBe("unusable");
      expect(String(after?.refusal_reason || "").trim().length, `${name} one-line reason`).toBeGreaterThan(0);

      const counts = await countDownstream(uploadId);
      expect(counts.questions, `${name} zero questions`).toBe(0);
      expect(counts.notes, `${name} zero notes`).toBe(0);
      expect(counts.attempts, `${name} zero attempts`).toBe(0);
      expect(counts.mistakes, `${name} zero mistakes`).toBe(0);

      await db.from("student_uploads").delete().eq("id", uploadId);
      await db.storage.from("student-uploads").remove([path]);
    }
  });

  test("§12.1 positive control — real MCQ paper is accepted with questions", async ({ page }) => {
    test.setTimeout(300_000);
    const token = loadAuthToken("exam_cuet");
    expect(token).toBeTruthy();
    const db = createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token!}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const uid = (await db.auth.getUser()).data.user!.id;
    const { data: idData } = await db.rpc("rpc_get_my_student_identity");
    const id = Array.isArray(idData) ? idData[0] : idData;

    const bytes = readFileSync(join(FIX, "accept-real-mcq-paper.pdf"));
    const path = `${uid}/${Date.now()}-accept-real-mcq-paper.pdf`;
    const { error: upErr } = await db.storage.from("student-uploads").upload(path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    expect(upErr).toBeNull();

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
    expect(insErr).toBeNull();
    const uploadId = row!.id as string;

    const classify = await page.request.post(`${URL}/functions/v1/custom-practice-upload`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: ANON,
        "Content-Type": "application/json",
      },
      data: { upload_id: uploadId },
      timeout: 180_000,
    });
    const body = await classify.json();
    expect(classify.ok(), `accept classify HTTP ${classify.status()} ${JSON.stringify(body).slice(0, 200)}`).toBeTruthy();

    const { data: after } = await db
      .from("student_uploads")
      .select("status, verdict, refusal_reason")
      .eq("id", uploadId)
      .single();
    expect(after?.status, "accepted status").toBe("ready");
    expect(["questions", "mixed"]).toContain(after?.verdict);

    const q = await sql(
      `SELECT count(*)::int AS c FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`,
    );
    expect(q[0]?.c, "at least 3 questions (positive control / §4.4)").toBeGreaterThanOrEqual(3);

    // Cleanup — leave no demo residue
    await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`);
    await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${uploadId}'`);
    await sql(`DELETE FROM public.student_uploads WHERE id = '${uploadId}'`);
    await db.storage.from("student-uploads").remove([path]);
  });

  test("§12.2 wrong → mistake → recovery from_upload → revision → accuracy", async ({ page }) => {
    test.setTimeout(300_000);
    const token = loadAuthToken("exam_cuet");
    expect(token).toBeTruthy();
    const db = createClient(URL, ANON, {
      global: { headers: { Authorization: `Bearer ${token!}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const uid = (await db.auth.getUser()).data.user!.id;
    const { data: idData } = await db.rpc("rpc_get_my_student_identity");
    const id = Array.isArray(idData) ? idData[0] : idData;

    const bytes = readFileSync(join(FIX, "accept-real-mcq-paper.pdf"));
    const path = `${uid}/${Date.now()}-12-2-accept-real-mcq-paper.pdf`;
    const { error: upErr } = await db.storage.from("student-uploads").upload(path, bytes, {
      contentType: "application/pdf",
      upsert: false,
    });
    expect(upErr).toBeNull();

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
    expect(insErr).toBeNull();
    const uploadId = row!.id as string;

    const classify = await page.request.post(`${URL}/functions/v1/custom-practice-upload`, {
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: ANON,
        "Content-Type": "application/json",
      },
      data: { upload_id: uploadId },
      timeout: 180_000,
    });
    expect(classify.ok(), `classify HTTP ${classify.status()}`).toBeTruthy();

    const qs = await sql(
      `SELECT q.id, q.chapter_id, q.correct_index, q.question_text, q.options,
              c.name AS chapter_name, s.name AS subject_name
         FROM public.student_upload_questions q
         LEFT JOIN public.chapters c ON c.id = q.chapter_id
         LEFT JOIN public.curriculum_subjects s ON s.id = c.curriculum_subject_id
        WHERE q.upload_id = '${uploadId}'
        ORDER BY q.sequence`,
    );
    expect(qs.length, "extracted questions").toBeGreaterThanOrEqual(3);
    const target = qs.find((q: { chapter_id: string | null }) => q.chapter_id);
    expect(target, "at least one question tagged to a real chapter").toBeTruthy();

    const beforeMistakes = await sql(
      `SELECT count(*)::int AS c FROM public.student_mistakes
        WHERE user_id = '${uid}' AND upload_question_id = '${target.id}' AND status = 'open'`,
    );
    expect(beforeMistakes[0]?.c, "CONTROL: no open mistake yet").toBe(0);

    const beforeRev = await sql(
      `SELECT count(*)::int AS c FROM public.revision_queue
        WHERE user_id = '${uid}' AND NOT completed AND reason = 'upload_wrong'
          AND subject = '${String(target.subject_name ?? "").replace(/'/g, "''")}'
          AND COALESCE(chapter, '') = '${String(target.chapter_name ?? "").replace(/'/g, "''")}'`,
    );

    const wrongIndex =
      typeof target.correct_index === "number" && target.correct_index === 0 ? 1 : 0;
    const options = Array.isArray(target.options) ? target.options : [];

    const { data: sessionId, error: startErr } = await db.rpc("rpc_start_practice_session", {
      _subject: target.subject_name || "General",
      _chapter: target.chapter_name || null,
      _count: 1,
      _practice_mode: "custom",
    });
    expect(startErr, `start: ${startErr?.message}`).toBeNull();

    const { data: verdict, error: recErr } = await db.rpc("rpc_record_question_attempt", {
      _correct_answer: { index: target.correct_index, correct_index: target.correct_index },
      _generated_question: {
        question: target.question_text,
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
        source_id: uploadId,
        school_id: id.school_id,
        practice_mode: "custom",
        answered_at: new Date().toISOString(),
      },
    });
    expect(recErr, `record: ${recErr?.message}`).toBeNull();
    const isCorrect =
      typeof verdict === "object" && verdict !== null
        ? Boolean((verdict as { is_correct?: boolean }).is_correct)
        : null;
    expect(isCorrect, "server verdict wrong").toBe(false);

    const mistakes = await sql(
      `SELECT id, status, question_id, upload_question_id, chapter_id, source
         FROM public.student_mistakes
        WHERE user_id = '${uid}' AND upload_question_id = '${target.id}' AND status = 'open'
        ORDER BY last_wrong_at DESC NULLS LAST LIMIT 1`,
    );
    expect(mistakes[0]?.status).toBe("open");
    expect(mistakes[0]?.upload_question_id).toBe(target.id);
    expect(mistakes[0]?.question_id).toBeNull();
    expect(mistakes[0]?.source).toBe("upload");
    expect(mistakes[0]?.chapter_id).toBe(target.chapter_id);

    const planRows = await sql(
      `SELECT public._recovery_session_plan_for('${uid}'::uuid, '${target.chapter_id}'::uuid) AS plan`,
    );
    const plan = planRows[0]?.plan;
    expect(Number(plan?.open_mistakes ?? 0), "recovery counts chapter").toBeGreaterThanOrEqual(1);
    if (plan?.mode !== "relearn") {
      const fromUp = plan?.tiers?.["0"]?.from_upload ?? plan?.tiers?.[0]?.from_upload ?? [];
      expect(Array.isArray(fromUp) && fromUp.includes(target.id), "tier 0 from_upload").toBeTruthy();
    }

    const rev = await sql(
      `SELECT id, reason FROM public.revision_queue
        WHERE user_id = '${uid}' AND NOT completed AND reason = 'upload_wrong'
          AND subject = '${String(target.subject_name ?? "").replace(/'/g, "''")}'
          AND COALESCE(chapter, '') = '${String(target.chapter_name ?? "").replace(/'/g, "''")}'
        ORDER BY created_at DESC NULLS LAST LIMIT 1`,
    );
    expect(rev[0]?.reason, "revision scheduled").toBe("upload_wrong");

    const afterSnap = await db.rpc("rpc_student_academic_snapshot");
    const afterReady = Array.isArray(afterSnap.data) ? afterSnap.data[0] : afterSnap.data;
    expect(
      afterReady?.exam_readiness?.practice_accuracy_pct,
      "Analysis practice accuracy recorded",
    ).not.toBeNull();

    // Cleanup
    const attemptRows = await sql(
      `SELECT id FROM public.question_attempts
        WHERE user_id = '${uid}' AND source = 'upload' AND source_id = '${uploadId}'`,
    );
    if (mistakes[0]?.id) await sql(`DELETE FROM public.student_mistakes WHERE id = '${mistakes[0].id}'`);
    for (const a of attemptRows) await sql(`DELETE FROM public.question_attempts WHERE id = '${a.id}'`);
    if ((beforeRev[0]?.c ?? 0) === 0 && rev[0]?.id) {
      await sql(`DELETE FROM public.revision_queue WHERE id = '${rev[0].id}'`);
    }
    if (sessionId) await sql(`DELETE FROM public.practice_sessions WHERE id = '${sessionId}'`);
    await sql(`DELETE FROM public.student_upload_questions WHERE upload_id = '${uploadId}'`);
    await sql(`DELETE FROM public.student_upload_notes WHERE upload_id = '${uploadId}'`);
    await sql(`DELETE FROM public.student_uploads WHERE id = '${uploadId}'`);
    await db.storage.from("student-uploads").remove([path]);
  });
});
