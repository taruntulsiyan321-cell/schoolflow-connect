/**
 * chapter-supply — new questions for one chapter of an exam's syllabus, written
 * in the background, every one through the quality gate (TODO A2), for a chapter
 * the bank cannot serve (TODO B6: Economics, English, Mathematics and the
 * General Test have almost nothing).
 *
 * The same pipeline AI Practice writes with (_shared/questionWriter.ts): the
 * writer told the rubric, drafts read and checked, repeats of the bank dropped,
 * the rest gated — rules, an independent solve, a review against every
 * criterion — and only what passed stored. Every gated draft is a
 * question_gate_outcomes row whose ref is this run, which is how the gate's
 * refusals are measured subject by subject (scripts/measure-question-gate.mjs).
 *
 * Background job endpoint: x-variant-drain, the secret the other drains use.
 * Body: { "exam": "cuet", "chapter_id": "<uuid>", "count": 1–30 (10),
 *         "form": a written form or null (the paper's mix), "difficulty": null | "easy" | "medium" | "hard" }
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completeWithQwen, getConfiguredModelId } from "../_shared/modelRouter.ts";
import { completeThinking } from "../_shared/thinkingCompletion.ts";
import { embedQueryText } from "../_shared/embeddingProvider.ts";
import { examLabel } from "../_shared/answerCheck.ts";
import { DIFFICULTIES, MAX_QUESTIONS, type Difficulty } from "../_shared/aiPractice.ts";
import { isQuestionForm } from "../_shared/questionForms.ts";
import { isWrittenForm, whyChapterNotWritten, whyNotWritten, type WrittenForm } from "../_shared/questionRubric.ts";
import { ensureTopics, writeForChapter, type WriterDeps } from "../_shared/questionWriter.ts";
import { writerDb } from "../_shared/questionWriterDb.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-variant-drain",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_COUNT = 10;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  // A missing secret is a refusal, never an open door.
  const drain = Deno.env.get("VARIANT_GENERATION_DRAIN") ?? "";
  const presented = (req.headers.get("x-variant-drain") ?? "").trim();
  if (!drain) {
    return jsonResponse({ error: "VARIANT_GENERATION_DRAIN is not configured; refusing rather than running unauthenticated." }, 503);
  }
  if (presented.length !== drain.length || presented !== drain) {
    return jsonResponse({ error: "This is a background job endpoint." }, 403);
  }
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  if (!serviceKey) return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, 503);
  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const env = Deno.env.toObject();

  try {
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
    const examCode = typeof body.exam === "string" && body.exam.trim() ? body.exam.trim().toLowerCase() : "cuet";
    const chapterId = typeof body.chapter_id === "string" ? body.chapter_id.trim() : "";
    if (!UUID.test(chapterId)) return jsonResponse({ error: "chapter_id must be a chapter's uuid" }, 400);
    const asked = Number(body.count ?? DEFAULT_COUNT);
    const count = Number.isFinite(asked) ? Math.max(1, Math.min(MAX_QUESTIONS, Math.round(asked))) : DEFAULT_COUNT;
    let form: WrittenForm | null = null;
    if (body.form != null) {
      if (!isQuestionForm(body.form)) return jsonResponse({ error: `unknown form ${String(body.form)}` }, 400);
      if (!isWrittenForm(body.form)) return jsonResponse({ error: whyNotWritten(body.form) }, 400);
      form = body.form;
    }
    const difficulty = (DIFFICULTIES as readonly unknown[]).includes(body.difficulty) ? (body.difficulty as Difficulty) : null;

    // The chapter must be in the exam's syllabus.
    const { data: exam } = await admin.from("competitive_exams").select("id, code").eq("code", examCode).maybeSingle();
    if (!exam) return jsonResponse({ error: `no exam ${examCode}` }, 404);
    const { data: inSyllabus } = await admin.from("exam_syllabus_chapters")
      .select("chapter_id, chapters(name, curriculum_subjects(name))")
      .eq("exam_id", exam.id).eq("chapter_id", chapterId).maybeSingle();
    const row = inSyllabus as { chapters: { name: string; curriculum_subjects: { name: string } | null } | null } | null;
    if (!row?.chapters?.curriculum_subjects) return jsonResponse({ error: "that chapter is not in the exam's syllabus" }, 404);
    const chapter = { chapter_id: chapterId, chapter: row.chapters.name, subject: row.chapters.curriculum_subjects.name };
    const notWritten = whyChapterNotWritten(chapter.chapter);
    if (notWritten) return jsonResponse({ error: notWritten, chapter: chapter.chapter, retryable: false }, 422);
    const label = examLabel({ exam_code: exam.code });

    const runId = crypto.randomUUID();
    const deps: WriterDeps = {
      complete: completeWithQwen,
      think: completeThinking,
      embed: (text) => embedQueryText(text, { env }),
      model: getConfiguredModelId(),
      db: writerDb(admin, "chapter-supply"),
    };
    const topics = await ensureTopics(deps, label, chapter);
    if (topics.length === 0) return jsonResponse({ error: "the chapter has no topics and none could be drafted", retryable: true }, 502);

    // The chapter's newest questions, so the writer does not repeat them.
    const { data: recent } = await admin.from("question_bank").select("question")
      .eq("exam_id", exam.id).eq("chapter_id", chapterId).eq("is_active", true)
      .order("created_at", { ascending: false }).limit(30);

    const result = await writeForChapter(deps, {
      writer: "chapter_supply",
      source: "chapter_supply",
      ref: runId,
      examId: exam.id,
      examLabel: label,
      chapter,
      topics,
      topicId: null,
      focus: chapter.chapter,
      difficulty,
      form,
      shortfall: count,
      stillNeeded: () => count,
      avoid: ((recent ?? []) as Array<{ question: string }>).map((r) => r.question),
      // A repeat of a question the bank holds is simply not written again.
      onTwin: () => {},
    });

    return jsonResponse({
      run_id: runId,
      exam: exam.code,
      subject: chapter.subject,
      chapter: chapter.chapter,
      requested: count,
      written: result.written.length,
      question_ids: result.written,
      discarded: result.discarded,
      gate: result.gate,
      notes: result.notes,
    });
  } catch (e) {
    console.error("chapter-supply:", e);
    return jsonResponse({ error: e instanceof Error ? e.message : String(e), retryable: true }, 500);
  }
});
