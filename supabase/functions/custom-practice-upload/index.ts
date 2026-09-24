/**
 * custom-practice-upload — classify + extract a student's private upload.
 *
 * Binding: docs/custom-practice-upload-spec.md §4–§7, §6 answer keys.
 *
 * WHY NOT ai-gateway: production holds two _shared modules that exist in no
 * branch (KNOWN_ISSUES edge-drift). A new function avoids that blocker (§13).
 *
 * §4.1 The refusal is the feature. Never invent questions from a timetable,
 * receipt, blank page, chat screenshot, or low-confidence read.
 */
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifyUploadMedia } from "./classify.ts";
import { loadUploadMedia } from "./media.ts";
import type { ClassifierResult, ExtractedNote, ExtractedQuestion } from "./types.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function markFailed(
  userClient: ReturnType<typeof createClient>,
  uploadId: string,
  uid: string,
  reason: string,
): Promise<Response> {
  const { error } = await userClient
    .from("student_uploads")
    .update({
      status: "failed",
      refusal_reason: reason,
      verdict: null,
      confidence: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadId)
    .eq("owner_id", uid);
  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({
    ok: false,
    upload_id: uploadId,
    status: "failed",
    error: reason,
    questions_written: 0,
    notes_written: 0,
  });
}

async function markUnusable(
  userClient: ReturnType<typeof createClient>,
  uploadId: string,
  uid: string,
  result: ClassifierResult,
  pageCount: number | null,
): Promise<Response> {
  const reason =
    result.refusal_reason?.trim() ||
    "This file could not be used for practice.";
  const { error } = await userClient
    .from("student_uploads")
    .update({
      status: "unusable",
      verdict: "unusable",
      confidence: result.confidence,
      refusal_reason: reason,
      page_count: pageCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadId)
    .eq("owner_id", uid);
  if (error) return jsonResponse({ error: error.message }, 500);
  return jsonResponse({
    ok: true,
    upload_id: uploadId,
    status: "unusable",
    verdict: "unusable",
    confidence: result.confidence,
    refusal_reason: reason,
    questions_written: 0,
    notes_written: 0,
  });
}

async function persistQuestions(
  userClient: ReturnType<typeof createClient>,
  uploadId: string,
  ownerId: string,
  schoolId: string,
  questions: ExtractedQuestion[],
): Promise<{ error: string | null; written: number }> {
  if (questions.length === 0) return { error: null, written: 0 };
  // Replace any prior extract for this upload (retry-safe).
  await userClient
    .from("student_upload_questions")
    .delete()
    .eq("upload_id", uploadId)
    .eq("owner_id", ownerId);

  const rows = questions.map((q, i) => ({
    upload_id: uploadId,
    owner_id: ownerId,
    school_id: schoolId,
    sequence: i + 1,
    question_text: q.question_text,
    options: q.options,
    correct_index: q.correct_index,
    correct_answer: q.correct_answer,
    answer_source: q.answer_source,
    explanation: q.explanation,
    difficulty: q.difficulty,
    chapter_id: null,
    topic_id: null,
  }));

  const { error } = await userClient.from("student_upload_questions").insert(rows);
  if (error) return { error: error.message, written: 0 };
  return { error: null, written: rows.length };
}

async function persistNotes(
  userClient: ReturnType<typeof createClient>,
  uploadId: string,
  ownerId: string,
  schoolId: string,
  notes: ExtractedNote[],
): Promise<{ error: string | null; written: number }> {
  if (notes.length === 0) return { error: null, written: 0 };
  await userClient
    .from("student_upload_notes")
    .delete()
    .eq("upload_id", uploadId)
    .eq("owner_id", ownerId);

  const rows = notes.map((n, i) => ({
    upload_id: uploadId,
    owner_id: ownerId,
    school_id: schoolId,
    sequence: i + 1,
    title: n.title,
    body: n.body,
    chapter_id: null,
    topic_id: null,
  }));

  const { error } = await userClient.from("student_upload_notes").insert(rows);
  if (error) return { error: error.message, written: 0 };
  return { error: null, written: rows.length };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await requireUserJwt(req);
  if (!auth.ok) return auth.response;

  let uploadId = "";
  try {
    const body = await req.json();
    uploadId = typeof body?.upload_id === "string" ? body.upload_id.trim() : "";
  } catch {
    return jsonResponse({ error: "invalid_json" }, 400);
  }
  if (!uploadId) return jsonResponse({ error: "upload_id_required" }, 400);

  const userClient = auth.value.userClient;
  const uid = auth.value.user.id;

  const { data: upload, error: loadErr } = await userClient
    .from("student_uploads")
    .select("id, owner_id, school_id, status, storage_path, mime_type")
    .eq("id", uploadId)
    .eq("owner_id", uid)
    .maybeSingle();

  if (loadErr) return jsonResponse({ error: loadErr.message }, 500);
  if (!upload) return jsonResponse({ error: "not_found" }, 404);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  // Individuals only (§11).
  const { data: school } = await admin
    .from("schools")
    .select("kind")
    .eq("id", upload.school_id)
    .maybeSingle();
  if (school?.kind !== "individual") {
    return jsonResponse({ error: "individual_accounts_only" }, 403);
  }

  await userClient
    .from("student_uploads")
    .update({ status: "processing", updated_at: new Date().toISOString() })
    .eq("id", uploadId)
    .eq("owner_id", uid);

  const mediaResult = await loadUploadMedia(
    admin,
    upload.storage_path as string,
    (upload.mime_type as string) || "",
  );
  if (!mediaResult.ok) {
    return markFailed(userClient, uploadId, uid, mediaResult.error);
  }

  const classified = await classifyUploadMedia(mediaResult.media);
  if (!classified.ok) {
    return markFailed(userClient, uploadId, uid, classified.error);
  }

  const result = classified.result;
  const pageCount = mediaResult.media.page_count;

  if (result.verdict === "unusable") {
    // §4.3 — keep the file, write zero downstream rows.
    await userClient
      .from("student_upload_questions")
      .delete()
      .eq("upload_id", uploadId)
      .eq("owner_id", uid);
    await userClient
      .from("student_upload_notes")
      .delete()
      .eq("upload_id", uploadId)
      .eq("owner_id", uid);
    return markUnusable(userClient, uploadId, uid, result, pageCount);
  }

  const qWrite = await persistQuestions(
    userClient,
    uploadId,
    uid,
    upload.school_id as string,
    result.questions,
  );
  if (qWrite.error) {
    return markFailed(
      userClient,
      uploadId,
      uid,
      `Could not save extracted questions: ${qWrite.error}`,
    );
  }

  const nWrite = await persistNotes(
    userClient,
    uploadId,
    uid,
    upload.school_id as string,
    result.notes,
  );
  if (nWrite.error) {
    return markFailed(
      userClient,
      uploadId,
      uid,
      `Could not save extracted notes: ${nWrite.error}`,
    );
  }

  const { error: readyErr } = await userClient
    .from("student_uploads")
    .update({
      status: "ready",
      verdict: result.verdict,
      confidence: result.confidence,
      refusal_reason: null,
      page_count: pageCount,
      updated_at: new Date().toISOString(),
    })
    .eq("id", uploadId)
    .eq("owner_id", uid);

  if (readyErr) return jsonResponse({ error: readyErr.message }, 500);

  return jsonResponse({
    ok: true,
    upload_id: uploadId,
    status: "ready",
    verdict: result.verdict,
    confidence: result.confidence,
    questions_written: qWrite.written,
    notes_written: nWrite.written,
    /** §6 — how many answers were AI-filled (client shows ai_answered). */
    ai_answered_count: result.questions.filter((q) => q.answer_source === "ai").length,
  });
});
