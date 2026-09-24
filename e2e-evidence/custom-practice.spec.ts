/**
 * Custom Practice — docs/custom-practice-upload-spec.md §12 evidence.
 *
 * Spec name matches playwright.evidence.config.ts testMatch (`custom-practice`).
 * Runs as the individual CUET account (auth.exam.setup.ts).
 *
 * §12.1 refusal battery + positive control are first. Later describes add
 * §12.2–§12.4 / §12.6 when the harness can drive Practice end to end.
 */
import { test, expect } from "@playwright/test";
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import { authFile } from "./roles";

const FIX = join("e2e-evidence", "fixtures", "custom-practice");
const REF = process.env.VITE_SUPABASE_PROJECT_ID || "psqxykzqfvxgsvkmgurn";
const URL = process.env.VITE_SUPABASE_URL || `https://${REF}.supabase.co`;
const ANON = process.env.VITE_SUPABASE_PUBLISHABLE_KEY || process.env.VITE_SUPABASE_ANON_KEY || "";
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

  test.beforeAll(() => {
    test.skip(!existsSync(authFile("exam_cuet")), "exam_cuet storageState missing — auth.exam.setup did not mint");
    test.skip(!ANON, "anon key missing");
    test.skip(!MGMT, "SUPABASE_ACCESS_TOKEN missing — cannot assert zero downstream rows");
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
});
