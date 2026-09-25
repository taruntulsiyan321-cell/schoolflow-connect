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
import { fileUnderSyllabus, loadStudentSyllabus } from "../_shared/syllabusTagger.ts";
import { outsideMessage } from "../_shared/syllabusTag.ts";
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

  // The syllabus this account's stream studies, from ITS OWN exam_accounts
  // row — never from the request body, which once let a caller skip bank
  // matching by omitting the exam or match against another exam's bank.
  const syllabus = await loadStudentSyllabus(admin, student.school_id);
  if (!syllabus) {
    return jsonResponse({ error: "exam_syllabus_required" }, 403);
  }

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

  // Filed under the student's syllabus: the bank first, then the model. A
  // question from outside the stream's subjects is not the student's CUET work
  // and is not saved; nothing is saved without a chapter (ruled 2026-09-25).
  const filed = await fileUnderSyllabus(admin, syllabus, [
    { index: 0, question: qText, options: ex.options ?? null },
  ]);
  if (!filed.ok) {
    return jsonResponse({ ok: false, captured: false, read: true, reason: "tag_failed", error: filed.error }, 502);
  }
  const tag = filed.tags.get(0)!;
  if (tag.kind === "outside") {
    return jsonResponse({
      ok: true,
      captured: false,
      read: true,
      reason: "outside_stream",
      pipeline_stage: "stream_drop",
      subject: tag.subject,
      message: outsideMessage(tag.subject, syllabus.label),
    });
  }
  const { chapter_id, topic_id, matched_bank_question_id, subject, chapter: chapterName } = tag;
  const difficulty = tag.bank_difficulty;
  const inherited = matched_bank_question_id != null;

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
        chapter_id,
        topic_id,
        matched_bank_question_id,
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
