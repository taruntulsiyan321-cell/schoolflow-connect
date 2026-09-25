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
 * §5.2 Embed + match_question_bank_for_exam before inventing chapter tags.
 */
import { requireUserJwt } from "../_shared/requireAuth.ts";
import { embedQueryText } from "../_shared/embeddingProvider.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { classifyUploadMedia } from "./classify.ts";
import { formatCatalogHint } from "./curriculumResolve.ts";
import { loadUploadMedia } from "./media.ts";
import {
  loadExamCatalog,
  noteTagsByTitleFromRows,
  persistNotes,
  persistQuestions,
  tagNotesFromCatalog,
  type NoteTagLookup,
  type TaggedQuestion,
} from "./persist.ts";
import {
  resolveCurriculumLabels,
  type CurriculumChapter,
} from "./curriculumResolve.ts";
import type { ClassifierResult, ExtractedQuestion } from "./types.ts";
import { UPLOAD_MAX_BYTES, UPLOAD_MAX_PAGES } from "./refusalGates.ts";

/** §5.2 — same default as match_question_bank_for_exam; confident inherit only. */
const BANK_MATCH_THRESHOLD = 0.82;

type BankMatchRow = {
  id?: string;
  chapter_id?: string | null;
  topic_id?: string | null;
  difficulty?: string | null;
  similarity?: number;
};

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
): { chapter_id: string | null; topic_id: string | null; note_id: string | null } | null {
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

/**
 * §5.2 — embed each stem and inherit chapter/topic/difficulty from a confident
 * bank match. On a miss, resolve the model's free-text labels against the exam
 * catalog (never invent an id — unresolved stays null). Notes-derived questions
 * (§7.1) inherit tags from the note instead.
 */
async function tagQuestionsFromBank(
  admin: ReturnType<typeof createClient>,
  examId: string | null,
  catalog: CurriculumChapter[],
  questions: ExtractedQuestion[],
  noteTagsByTitle: NoteTagLookup,
): Promise<{ tagged: TaggedQuestion[]; inherited: number; catalog_tagged: number }> {
  if (questions.length === 0) return { tagged: [], inherited: 0, catalog_tagged: 0 };

  const fromCatalog = (q: ExtractedQuestion): TaggedQuestion => {
    const resolved = resolveCurriculumLabels(catalog, q.chapter, q.topic, q.subject);
    return {
      ...q,
      chapter_id: resolved.chapter_id,
      topic_id: resolved.topic_id,
      matched_bank_question_id: null,
      derived_from_note_id: null,
    };
  };

  const tagged: TaggedQuestion[] = [];
  let inherited = 0;
  let catalog_tagged = 0;
  const env = Deno.env.toObject();

  for (const q of questions) {
    const noteKey = q.derived_from_note_title?.trim().toLowerCase() ?? "";
    const matchedNote = noteKey ? resolveNote(noteKey, noteTagsByTitle) : null;
    if (matchedNote) {
      const nt = matchedNote;
      tagged.push({
        ...q,
        answer_source: "ai",
        chapter_id: nt.chapter_id,
        topic_id: nt.topic_id,
        matched_bank_question_id: null,
        derived_from_note_id: nt.note_id,
      });
      continue;
    }

    if (!examId) {
      const catalogHit = fromCatalog(q);
      if (catalogHit.chapter_id) catalog_tagged += 1;
      tagged.push(catalogHit);
      continue;
    }

    const emb = await embedQueryText(q.question_text, { env });
    if (!emb.ok) {
      const catalogHit = fromCatalog(q);
      if (catalogHit.chapter_id) catalog_tagged += 1;
      tagged.push(catalogHit);
      continue;
    }

    const { data, error } = await admin.rpc("match_question_bank_for_exam", {
      p_query_embedding: JSON.stringify(emb.embedding),
      p_exam_id: examId,
      p_subjects: null,
      p_match_threshold: BANK_MATCH_THRESHOLD,
      p_match_count: 1,
    });

    if (error) {
      console.error(
        "match_question_bank_for_exam failed — falling back to catalog labels:",
        JSON.stringify(error),
      );
      const catalogHit = fromCatalog(q);
      if (catalogHit.chapter_id) catalog_tagged += 1;
      tagged.push(catalogHit);
      continue;
    }

    const top = (Array.isArray(data) && data.length > 0 ? data[0] : null) as BankMatchRow | null;
    const bankId = typeof top?.id === "string" ? top.id : null;
    const chapterId = typeof top?.chapter_id === "string" ? top.chapter_id : null;
    const topicId = typeof top?.topic_id === "string" ? top.topic_id : null;

    if (!bankId || !chapterId) {
      // §5.2 — no confident bank match: AI labels → live catalog ids, or null.
      const catalogHit = fromCatalog(q);
      if (catalogHit.chapter_id) catalog_tagged += 1;
      tagged.push(catalogHit);
      continue;
    }

    const bankDifficulty =
      typeof top?.difficulty === "string" && /^(easy|medium|hard)$/i.test(top.difficulty.trim())
        ? top.difficulty.trim().toLowerCase()
        : null;

    tagged.push({
      ...q,
      chapter_id: chapterId,
      topic_id: topicId,
      matched_bank_question_id: bankId,
      derived_from_note_id: null,
      difficulty: bankDifficulty ?? q.difficulty,
    });
    inherited += 1;
  }

  return { tagged, inherited, catalog_tagged };
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

  // §5 / §7 — exam catalog before classify so notes can be tagged to real chapters.
  const { data: examAccount } = await admin
    .from("exam_accounts")
    .select("exam_id")
    .eq("school_id", upload.school_id)
    .maybeSingle();
  const examId =
    typeof examAccount?.exam_id === "string" ? examAccount.exam_id : null;
  const catalog = await loadExamCatalog(admin, examId);

  const classified = await classifyUploadMedia(mediaResult.media, {
    catalogHint: catalog.length ? formatCatalogHint(catalog, 48) : undefined,
  });
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

  // §7 — resolve note labels first, persist, then link questions via title.
  const taggedNotes = tagNotesFromCatalog(result.notes, catalog);
  const nWrite = await persistNotes(
    userClient,
    uploadId,
    uid,
    upload.school_id as string,
    taggedNotes,
  );
  if (nWrite.error) {
    return markFailed(
      userClient,
      uploadId,
      uid,
      `Could not save extracted notes: ${nWrite.error}`,
    );
  }

  const noteTagsByTitle = noteTagsByTitleFromRows(nWrite.rows);

  const { tagged, inherited, catalog_tagged } = await tagQuestionsFromBank(
    admin,
    examId,
    catalog,
    result.questions,
    noteTagsByTitle,
  );

  const qWrite = await persistQuestions(
    userClient,
    uploadId,
    uid,
    upload.school_id as string,
    tagged,
  );
  if (qWrite.error) {
    return markFailed(
      userClient,
      uploadId,
      uid,
      `Could not save extracted questions: ${qWrite.error}`,
    );
  }

  const notesTagged = nWrite.rows.filter((r) => r.chapter_id != null).length;
  const notesFromNotesQs = tagged.filter((q) => q.derived_from_note_id != null).length;

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
    /** §5.2 — how many stems inherited chapter/topic from the bank. */
    bank_tags_inherited: inherited,
    /** §5.2 — stems tagged from AI labels → live catalog ids after a bank miss. */
    catalog_tags_resolved: catalog_tagged,
    /** §7 — notes that resolved to a live chapter_id. */
    notes_chapter_tagged: notesTagged,
    /** §7.1 — questions linked via derived_from_note_id. */
    notes_derived_questions: notesFromNotesQs,
    /** §6 — how many answers were AI-filled (client shows ai_answered). */
    ai_answered_count: tagged.filter((q) => q.answer_source === "ai").length,
  });
});
