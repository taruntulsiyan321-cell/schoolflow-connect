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
 * Every saved question and note is filed under a chapter of the student's
 * stream syllabus; anything outside the stream's subjects is not saved
 * (_shared/syllabusTagger.ts, ruled 2026-09-25).
 */
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { fileUnderSyllabus, loadStudentSyllabus, type FiledTag } from "../_shared/syllabusTagger.ts";
import { outsideMessage } from "../_shared/syllabusTag.ts";
import { classifyUploadMedia } from "./classify.ts";
import { loadUploadMedia } from "./media.ts";
import {
  noteTagsByTitleFromRows,
  persistNotes,
  persistQuestions,
  type NoteTagLookup,
  type TaggedNote,
  type TaggedQuestion,
} from "./persist.ts";
import type { ClassifierResult } from "./types.ts";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_PAGES } from "./refusalGates.ts";

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

/**
 * §7.1 — find the note a question says it came from.
 *
 * The model reports the link as the note's TITLE, written a second time in a
 * different part of the same JSON response, and an exact match on that string
 * is not something to depend on. Measured 2026-09-24: the same fixture came
 * back as "Capital Accounts in Partnership" on one run and "Capital Accounts"
 * on the next, so an exact lookup silently dropped every link and
 * `practise_from_notes` had nothing behind it.
 *
 * Silently is the problem. Three tolerant passes, in order of confidence:
 *   1. the exact key (unchanged behaviour when the model is consistent);
 *   2. one title contained in the other, after normalising;
 *   3. only when there is exactly ONE note, so "which note" cannot be wrong.
 *
 * Deliberately NOT a fuzzy score: a wrong note means a wrong chapter, and §5.1
 * rules that a wrong chapter is worse than none.
 */
function resolveNote(
  noteKey: string,
  noteTagsByTitle: NoteTagLookup,
): { chapter_id: string; topic_id: string | null; note_id: string } | null {
  const exact = noteTagsByTitle.get(noteKey);
  if (exact) return exact;

  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const want = norm(noteKey);
  if (!want) return null;

  for (const [title, tags] of noteTagsByTitle) {
    const have = norm(title);
    if (have && (have.includes(want) || want.includes(have))) return tags;
  }

  if (noteTagsByTitle.size === 1) {
    return noteTagsByTitle.values().next().value ?? null;
  }
  return null;
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
    .select("id, owner_id, school_id, status, storage_path, mime_type, byte_size")
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
    uid,
  );
  if (!mediaResult.ok) {
    return markFailed(userClient, uploadId, uid, mediaResult.error);
  }

  // §13 — page and size limits. Storage already caps bytes; re-check here so a
  // misconfigured bucket cannot spend a classify call. Client only mirrors.
  const declaredBytes = Number(upload.byte_size ?? 0);
  if (declaredBytes > UPLOAD_MAX_BYTES) {
    return markUnusable(
      userClient,
      uploadId,
      uid,
      {
        verdict: "unusable",
        confidence: 1,
        refusal_reason: `File exceeds the ${UPLOAD_MAX_BYTES / (1024 * 1024)} MB upload limit.`,
        questions: [],
        notes: [],
      },
      mediaResult.media.page_count,
    );
  }
  const pages = mediaResult.media.page_count;
  if (pages != null && pages > UPLOAD_MAX_PAGES) {
    return markUnusable(
      userClient,
      uploadId,
      uid,
      {
        verdict: "unusable",
        confidence: 1,
        refusal_reason: `This file has ${pages} pages; the limit is ${UPLOAD_MAX_PAGES}.`,
        questions: [],
        notes: [],
      },
      pages,
    );
  }

  // The student's stream syllabus — what every saved row is filed under.
  let syllabus;
  try {
    syllabus = await loadStudentSyllabus(admin, upload.school_id as string);
  } catch (e) {
    return markFailed(userClient, uploadId, uid, e instanceof Error ? e.message : "Could not read your syllabus.");
  }
  if (!syllabus) return markFailed(userClient, uploadId, uid, "This account has no exam syllabus to file questions under.");

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

  // Questions and notes filed together: questions are 0..n-1, notes n..
  const nQ = result.questions.length;
  const filed = await fileUnderSyllabus(admin, syllabus, [
    ...result.questions.map((q, i) => ({ index: i, question: q.question_text, options: q.options })),
    ...result.notes.map((n, i) => ({ index: nQ + i, question: `${n.title}\n${n.body.slice(0, 1200)}` })),
  ]);
  if (!filed.ok) return markFailed(userClient, uploadId, uid, filed.error);

  const outside: string[] = [];
  const keep = (index: number): FiledTag & { kind: "tagged" } | null => {
    const tag = filed.tags.get(index)!;
    if (tag.kind === "outside") { outside.push(tag.subject ?? ""); return null; }
    return tag;
  };

  const taggedNotes: TaggedNote[] = result.notes.flatMap((n, i) => {
    const tag = keep(nQ + i);
    return tag ? [{ ...n, chapter_id: tag.chapter_id, topic_id: tag.topic_id }] : [];
  });
  const nWrite = await persistNotes(userClient, uploadId, uid, upload.school_id as string, taggedNotes);
  if (nWrite.error) {
    return markFailed(userClient, uploadId, uid, `Could not save extracted notes: ${nWrite.error}`);
  }
  const noteTagsByTitle = noteTagsByTitleFromRows(nWrite.rows);

  // §7.1 — a question written from a saved note is filed with that note.
  const tagged: TaggedQuestion[] = result.questions.flatMap((q, i): TaggedQuestion[] => {
    const tag = keep(i);
    if (!tag) return [];
    const note = q.derived_from_note_title ? resolveNote(q.derived_from_note_title.trim().toLowerCase(), noteTagsByTitle) : null;
    if (note) {
      return [{ ...q, answer_source: "ai" as const, chapter_id: note.chapter_id, topic_id: note.topic_id,
                matched_bank_question_id: null, derived_from_note_id: note.note_id }];
    }
    return [{ ...q, chapter_id: tag.chapter_id, topic_id: tag.topic_id,
              matched_bank_question_id: tag.matched_bank_question_id, derived_from_note_id: null,
              difficulty: tag.bank_difficulty ?? q.difficulty }];
  });

  // Nothing of the student's stream in the file: say which subject it was.
  if (tagged.length === 0 && taggedNotes.length === 0) {
    const counts = new Map<string, number>();
    for (const s of outside) counts.set(s, (counts.get(s) ?? 0) + 1);
    const subject = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || null;
    return markUnusable(userClient, uploadId, uid,
      { ...result, verdict: "unusable", refusal_reason: outsideMessage(subject, syllabus.label) }, pageCount);
  }

  const qWrite = await persistQuestions(userClient, uploadId, uid, upload.school_id as string, tagged);
  if (qWrite.error) {
    return markFailed(userClient, uploadId, uid, `Could not save extracted questions: ${qWrite.error}`);
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
    /** Filed from a matching bank question (chapter, topic, difficulty). */
    bank_tags_inherited: tagged.filter((q) => q.matched_bank_question_id).length,
    /** §7.1 — questions linked to the note they were written from. */
    notes_derived_questions: tagged.filter((q) => q.derived_from_note_id).length,
    /** Questions and notes not saved: their subject is outside the stream. */
    outside_stream: outside.length,
    outside_subjects: [...new Set(outside.filter(Boolean))],
    /** §6 — how many answers were AI-filled (client shows ai_answered). */
    ai_answered_count: tagged.filter((q) => q.answer_source === "ai").length,
  });
});
