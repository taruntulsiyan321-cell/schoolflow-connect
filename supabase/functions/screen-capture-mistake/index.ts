/**
 * screen-capture-mistake — Stage 1 tap intake (§10.1).
 *
 * Binding: docs/screen-capture-mistakes-spec.md §6.3–§7.4, §9, §11
 * Cites (do not restate): docs/custom-practice-upload-spec.md §2, §5, §6, §9
 *
 * One captured frame → extract → bank-first tags → private row + mistake.
 * Raw frames are NEVER persisted (§11).
 * NOTHING enters public.question_bank (§9) — no promotion path.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { embedQueryText } from "../_shared/embeddingProvider.ts";
import { extractFrame } from "./extract.ts";
import {
  applyIntakeGates,
  applyVerdictGates,
  fingerprintQuestionText,
} from "./gates.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/** Same threshold as custom-practice-upload §5.2 / match_question_bank_for_exam default. */
const BANK_MATCH_THRESHOLD = 0.82;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function toDataUri(image_base64: string, mime: string): string {
  const b64 = image_base64.replace(/^data:[^;]+;base64,/, "");
  return `data:${mime};base64,${b64}`;
}

type BankMatchRow = {
  id?: string;
  chapter_id?: string | null;
  topic_id?: string | null;
  difficulty?: string | null;
};

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("screen-capture-mistake uncaught:", e);
    return jsonResponse(
      {
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        captured: false,
      },
      500,
    );
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await requireUserJwt(req);
  if (!auth.ok) return auth.response;

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }

  const image_base64 =
    typeof body.image_base64 === "string" ? body.image_base64.trim() : "";
  const mime =
    typeof body.mime_type === "string" && body.mime_type.trim()
      ? body.mime_type.trim()
      : "image/png";
  const package_name =
    typeof body.package_name === "string" ? body.package_name.trim() : "";
  // exam_id is NOT taken from the body. It is resolved below from the
  // caller's own exam_accounts row (§2 — identity comes from the server).
  const is_lecture_suspect = body.is_lecture_suspect === true;

  const userClient = auth.value.userClient;
  const uid = auth.value.user.id;

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Resolve school (individual tenant) — same house pattern as uploads.
  const { data: student } = await admin
    .from("students")
    .select("id, school_id")
    .eq("user_id", uid)
    .maybeSingle();
  if (!student?.school_id) {
    return jsonResponse({ error: "student_profile_required" }, 403);
  }

  const { data: school } = await admin
    .from("schools")
    .select("kind")
    .eq("id", student.school_id)
    .maybeSingle();
  if (school?.kind !== "individual") {
    return jsonResponse({ error: "individual_accounts_only" }, 403);
  }

  // §7.2 — the exam this account prepares for, read from ITS OWN exam_accounts
  // row, exactly as custom-practice-upload resolves it.
  //
  // It used to be read from the request body. Two things were wrong with that.
  // A caller that simply omitted it silently lost bank matching altogether —
  // the whole block below is guarded on exam_id, so §7.2's chapter inheritance
  // vanished without a word, which is how it was failing. And a caller that
  // sent a DIFFERENT exam's id would have had its capture matched against, and
  // tagged from, that exam's bank. Which exam an account is, is the server's
  // fact: it is on exam_accounts and nothing the client says can change it.
  const { data: examAccount } = await admin
    .from("exam_accounts")
    .select("exam_id")
    .eq("school_id", student.school_id)
    .maybeSingle();
  const exam_id =
    typeof examAccount?.exam_id === "string" ? examAccount.exam_id : "";

  // Allowlist: ALWAYS from the student's saved rows (§4 / §5.1). Never trust
  // body.allowed_packages — a JWT caller could otherwise gate-pass any package.
  const { data: allowRows } = await userClient
    .from("student_capture_allowed_apps")
    .select("package_name")
    .eq("owner_id", uid);
  const allowed = (allowRows ?? [])
    .map((r) => String(r.package_name ?? "").trim())
    .filter(Boolean);

  const intake = applyIntakeGates({
    package_name,
    allowed_packages: allowed,
    is_lecture_suspect,
  });
  if (!intake.ok) {
    return jsonResponse({
      ok: true,
      captured: false,
      reason: intake.reason,
      read: false,
      pipeline_stage: "intake_drop",
      message:
        intake.reason === "app_not_allowed"
          ? "This app is not on your capture list — nothing was read."
          : intake.reason === "lecture_playing"
            ? "Lecture frames never leave the phone — nothing was read."
            : "Missing package name — nothing was read.",
    });
  }

  if (!image_base64) {
    return jsonResponse({ error: "image_base64_required" }, 400);
  }

  // Bank count BEFORE any work — §9 assert for callers/measures.
  const { count: bankBefore } = await admin
    .from("question_bank")
    .select("id", { count: "exact", head: true });

  const dataUri = toDataUri(image_base64, mime);
  const extracted = await extractFrame(dataUri);
  if (!extracted.ok) {
    return jsonResponse(
      {
        ok: false,
        captured: false,
        read: true,
        reason: "extract_failed",
        error: extracted.error,
        bank_count_before: bankBefore ?? null,
      },
      502,
    );
  }

  const gated = applyVerdictGates(extracted.extraction);
  if (!gated.ok) {
    const messages: Record<string, string> = {
      correct_answer: "Correct answers are not captured.",
      score_only:
        "Open the solutions and Gurukul will pick up your mistakes — a score alone is not enough.",
      teacher_solve: "Teacher solutions during a lecture are not your mistakes.",
      no_student_verdict:
        "Need your answer and a right/wrong verdict on the same screen.",
      not_wrong: "Only wrong answers are captured.",
      unreadable: "Could not read this frame confidently enough.",
    };
    return jsonResponse({
      ok: true,
      captured: false,
      reason: gated.reason,
      read: true,
      pipeline_stage: "verdict_drop",
      message: messages[gated.reason] ?? gated.reason,
      bank_count_before: bankBefore ?? null,
      bank_count_after: bankBefore ?? null,
    });
  }

  const ex = gated.extraction;
  const qText = ex.question_text!.trim();
  const fp = fingerprintQuestionText(qText);
  if (!fp) {
    return jsonResponse({
      ok: true,
      captured: false,
      reason: "unreadable",
      read: true,
      pipeline_stage: "verdict_drop",
      message: "Could not fingerprint the question text.",
    });
  }

  // §7.2 bank-first inherit (upload §5.2) — never invent a chapter.
  let chapter_id: string | null = null;
  let topic_id: string | null = null;
  let matched_bank_question_id: string | null = null;
  let difficulty: string | null = null;
  let inherited = false;

  if (exam_id) {
    const emb = await embedQueryText(qText, { env: Deno.env.toObject() });
    if (emb.ok) {
      const { data, error } = await admin.rpc("match_question_bank_for_exam", {
        p_query_embedding: JSON.stringify(emb.embedding),
        p_exam_id: exam_id,
        p_subjects: null,
        p_match_threshold: BANK_MATCH_THRESHOLD,
        p_match_count: 1,
      });
      if (!error) {
        const top = (Array.isArray(data) && data.length > 0
          ? data[0]
          : null) as BankMatchRow | null;
        const bankId = typeof top?.id === "string" ? top.id : null;
        const ch = typeof top?.chapter_id === "string" ? top.chapter_id : null;
        if (bankId && ch) {
          matched_bank_question_id = bankId;
          chapter_id = ch;
          topic_id = typeof top?.topic_id === "string" ? top.topic_id : null;
          difficulty =
            typeof top?.difficulty === "string" &&
            /^(easy|medium|hard)$/i.test(top.difficulty.trim())
              ? top.difficulty.trim().toLowerCase()
              : null;
          inherited = true;
        }
      }
    }
  }
  // No AI chapter invent when bank misses — upload §5.1: wrong chapter worse than none.

  const optionsJson = ex.options ? ex.options : null;
  const answer_source = ex.answer_source ?? "screen";

  // §7.3 upsert by fingerprint — one private row.
  const { data: existing } = await admin
    .from("student_capture_questions")
    .select("id, times_seen")
    .eq("owner_id", uid)
    .eq("fingerprint", fp)
    .maybeSingle();

  let captureId: string;
  let timesSeen = 1;
  if (existing?.id) {
    timesSeen = (existing.times_seen ?? 1) + 1;
    const { error: upErr } = await admin
      .from("student_capture_questions")
      .update({
        times_seen: timesSeen,
        updated_at: new Date().toISOString(),
        student_chosen_index: ex.student_chosen_index,
        chapter_id: chapter_id ?? undefined,
        topic_id: topic_id ?? undefined,
        matched_bank_question_id: matched_bank_question_id ?? undefined,
        difficulty: difficulty ?? undefined,
        source_package: package_name,
      })
      .eq("id", existing.id)
      .eq("owner_id", uid);
    if (upErr) return jsonResponse({ error: upErr.message }, 500);
    captureId = existing.id;
  } else {
    const { data: inserted, error: insErr } = await admin
      .from("student_capture_questions")
      .insert({
        owner_id: uid,
        school_id: student.school_id,
        fingerprint: fp,
        question_text: qText,
        options: optionsJson,
        correct_index: ex.correct_index,
        student_chosen_index: ex.student_chosen_index,
        correct_answer: ex.correct_answer,
        answer_source,
        difficulty,
        chapter_id,
        topic_id,
        matched_bank_question_id,
        source_package: package_name,
        times_seen: 1,
      })
      .select("id")
      .single();
    if (insErr || !inserted) {
      return jsonResponse({ error: insErr?.message ?? "insert_failed" }, 500);
    }
    captureId = inserted.id;
  }

  // Subject label for mistake book — prefer chapter's subject when inherited.
  // Upload §5.1 / capture §7.2: never invent "General" — wrong chapter is worse
  // than none; placeholder subjects are dropped by the Mistake Book filter.
  let subject = "";
  let chapterName: string | null = null;
  if (chapter_id) {
    const { data: ch } = await admin
      .from("chapters")
      .select("name, curriculum_subjects(name)")
      .eq("id", chapter_id)
      .maybeSingle();
    if (ch) {
      chapterName = typeof ch.name === "string" ? ch.name : null;
      const sub = ch.curriculum_subjects as
        | { name?: string }
        | { name?: string }[]
        | null;
      if (sub && !Array.isArray(sub) && typeof sub.name === "string") {
        subject = sub.name;
      } else if (Array.isArray(sub) && typeof sub[0]?.name === "string") {
        subject = sub[0].name!;
      }
    }
  }

  const studentAnswer =
    ex.student_chosen_index != null
      ? { selected_index: ex.student_chosen_index }
      : {};
  const correctAnswer =
    ex.correct_index != null
      ? { correct_index: ex.correct_index }
      : ex.correct_answer
        ? { text: ex.correct_answer }
        : {};

  // Mistake via user JWT so auth.uid() binds (§9 / existing RPC).
  const { data: mistakeId, error: mistErr } = await userClient.rpc(
    "rpc_record_concept_mistake",
    {
      _assessment_type: "screen_capture",
      _source_id: captureId,
      _question_id: null,
      _subject: subject,
      _chapter: chapterName,
      _concept: chapterName,
      _subconcept: null,
      _class_level: null,
      _question_text: qText,
      _options: optionsJson ?? [],
      _student_answer: studentAnswer,
      _correct_answer: correctAnswer,
      _explanation: null,
      _chapter_id: chapter_id,
      _upload_question_id: null,
      _capture_question_id: captureId,
    },
  );

  if (mistErr) {
    return jsonResponse({ error: mistErr.message }, 500);
  }

  const { data: mistRow } = await userClient
    .from("student_mistakes")
    .select("id, times_wrong, chapter_id, question_text, source")
    .eq("id", mistakeId)
    .maybeSingle();

  const { count: bankAfter } = await admin
    .from("question_bank")
    .select("id", { count: "exact", head: true });

  // §9 — hard assert in the response; measures fail if bank grew.
  if (
    typeof bankBefore === "number" &&
    typeof bankAfter === "number" &&
    bankAfter !== bankBefore
  ) {
    console.error(
      "CRITICAL §9: question_bank count changed during screen capture",
      { bankBefore, bankAfter, captureId },
    );
  }

  return jsonResponse({
    ok: true,
    captured: true,
    read: true,
    pipeline_stage: "persisted",
    capture_question_id: captureId,
    mistake_id: mistRow?.id ?? mistakeId,
    times_wrong: mistRow?.times_wrong ?? 1,
    times_seen: timesSeen,
    chapter_id: mistRow?.chapter_id ?? chapter_id,
    inherited_from_bank: inherited,
    matched_bank_question_id,
    question_text: mistRow?.question_text ?? qText,
    source: "screen_capture",
    bank_count_before: bankBefore ?? null,
    bank_count_after: bankAfter ?? null,
    // Explicit: this function has no promotion path (§9).
    promoted_to_question_bank: false,
  });
}
