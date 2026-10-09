/**
 * ai-practice — a practice session from what the student asks for.
 *
 * Owner's ruling 2026-10-02. The student types "20 medium questions on
 * goodwill"; this reads it into one chapter of their syllabus, serves the
 * bank's matching questions first (nearest the request's meaning, none they
 * answered in the last 30 days), and writes only the shortfall. Anything the
 * bank already holds — by meaning, not only by wording — is served from the
 * bank instead of being written twice.
 *
 * Every written question passes the quality gate (TODO A2, _shared/questionGate.ts)
 * or is thrown away: it breaks none of the rubric's rules, an independent solve
 * reaches its key, and a review passes it on every criterion of the CBT rubric
 * (_shared/questionRubric.ts). What passes enters the shared bank through
 * store_generated_questions, tagged to its chapter and topic, with its review
 * and an explanation in the ruled shape (_shared/explanationFormat.ts). Every
 * draft gated, kept or refused, is recorded in question_gate_outcomes with why;
 * the bank door refuses anything without a passing review (20261148000000).
 * The writing itself is _shared/questionWriter.ts, shared with chapter supply.
 *
 * Limit: ai_practice.request — 2 a day free, unlimited on paid plans
 * (20261138000000). A request that serves nothing gives its use back.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { requireUserJwt } from "../_shared/requireAuth.ts";
import {
  planLimitResponse,
  premiumConsume,
  premiumRelease,
  premiumUnavailableResponse,
  PremiumUnavailableError,
  type PremiumDecision,
} from "../_shared/premium.ts";
import { loadStudentSyllabus } from "../_shared/syllabusTagger.ts";
import { completeWithQwen, getConfiguredModelId } from "../_shared/modelRouter.ts";
import { completeThinking } from "../_shared/thinkingCompletion.ts";
import { embedQueryText } from "../_shared/embeddingProvider.ts";
import { PROMPT_MAX_CHARS, readModelJson, readRequestReply, relevantFromBank, requestSystemPrompt } from "../_shared/aiPractice.ts";
import { whyNotWritten, isWrittenForm } from "../_shared/questionRubric.ts";
import { ensureTopics, writeForChapter, type DraftNotes, type WriterDeps } from "../_shared/questionWriter.ts";
import { writerDb } from "../_shared/questionWriterDb.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

Deno.serve(async (req) => {
  try {
    return await handle(req);
  } catch (e) {
    console.error("ai-practice uncaught:", e);
    return jsonResponse({ status: "failed", error: "AI Practice could not finish. Please try again." }, 500);
  }
});

async function handle(req: Request): Promise<Response> {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "method_not_allowed" }, 405);

  const auth = await requireUserJwt(req);
  if (!auth.ok) return auth.response;
  const uid = auth.value.user.id;

  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const prompt = typeof body.prompt === "string" ? body.prompt.replace(/\s+/g, " ").trim() : "";
  if (prompt.length < 3 || prompt.length > PROMPT_MAX_CHARS) {
    return jsonResponse({ status: "refused", message: `Say what you want to practise in 3 to ${PROMPT_MAX_CHARS} characters.` }, 400);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const env = Deno.env.toObject();

  // The exam and syllabus are the caller's own — never the request body's.
  const { data: student } = await admin.from("students").select("school_id").eq("user_id", uid).maybeSingle();
  if (!student?.school_id) return jsonResponse({ status: "refused", message: "AI Practice is for exam accounts." }, 403);
  const syllabus = await loadStudentSyllabus(admin, student.school_id);
  if (!syllabus || syllabus.chapters.length === 0) {
    return jsonResponse({ status: "refused", message: "AI Practice is for exam accounts." }, 403);
  }

  let use: PremiumDecision;
  try {
    use = await premiumConsume(admin, uid, "ai_practice.request");
  } catch (e) {
    if (e instanceof PremiumUnavailableError) return premiumUnavailableResponse(corsHeaders);
    throw e;
  }
  if (!use.ok) return planLimitResponse(use, corsHeaders);

  // Known before anything is gated: each gated draft's record names this request.
  const requestId = crypto.randomUUID();
  const log = async (row: Record<string, unknown>) => {
    const { error } = await admin.from("ai_practice_requests").insert({ id: requestId, user_id: uid, prompt, ...row });
    if (error) console.warn("ai-practice: request log failed:", error.message);
    return error ? null : requestId;
  };
  const giveBack = () => premiumRelease(admin, uid, use);
  const deps: WriterDeps = {
    complete: completeWithQwen,
    think: completeThinking,
    embed: (text) => embedQueryText(text, { env }),
    model: getConfiguredModelId(),
    db: writerDb(admin, "ai-practice"),
  };

  // ── 1. Read the request into one chapter of the syllabus ─────────────────
  const read = await completeWithQwen({
    system: requestSystemPrompt(syllabus.label, syllabus.chapters),
    user: prompt,
    temperature: 0,
    max_tokens: 300,
  });
  if (!read.ok) {
    await giveBack();
    await log({ requested: 1, status: "failed", message: `read: ${read.error}` });
    return jsonResponse({ status: "failed", message: "AI is unavailable right now. Please try again in a minute." }, 502);
  }
  let request;
  try {
    request = readRequestReply(readModelJson(read.text), syllabus.chapters);
  } catch {
    request = readRequestReply(null, syllabus.chapters);
  }
  if (request.kind === "refuse") {
    await giveBack();
    await log({ requested: 1, status: "refused", message: request.message });
    return jsonResponse({ status: "refused", message: request.message });
  }
  const { chapter, focus, count, difficulty, form } = request;
  let topicId = request.topicId;

  // ── 2. A chapter with no topics gets its list drafted, once ──────────────
  const topics = chapter.topics.length ? chapter.topics : await ensureTopics(deps, syllabus.label, chapter);
  if (topics.length === 0) {
    await giveBack();
    await log({ requested: count, subject: chapter.subject, chapter_id: chapter.chapter_id, difficulty, form, status: "failed", message: "no topics" });
    return jsonResponse({ status: "failed", message: "This chapter isn't ready for AI Practice yet. Please try another." });
  }
  const topic = topicId ? topics.find((t) => t.id === topicId) ?? null : null;
  if (!topic) topicId = null;

  // ── 3. The bank first ─────────────────────────────────────────────────────
  const meaning = [chapter.subject, chapter.chapter, topic?.name, focus].filter(Boolean).join(" — ");
  const asked = await embedQueryText(meaning, { env });
  const { data: candRows, error: candErr } = await admin.rpc("ai_practice_bank_candidates", {
    _user: uid,
    _exam: syllabus.examId,
    _chapter: chapter.chapter_id,
    _topic: topicId,
    _difficulty: difficulty,
    _form: form,
    _query: asked.ok ? JSON.stringify(asked.embedding) : null,
    _limit: Math.max(count * 3, 30),
  });
  if (candErr) console.warn("ai-practice: bank candidates failed:", candErr.message);
  const candidates = (candRows ?? []) as Array<{ id: string; similarity: number | null }>;
  const unseen = new Set(candidates.map((c) => c.id));
  const chosen: string[] = relevantFromBank(candidates, count).map((c) => c.id);

  // ── 4. Write the shortfall; keep what passes the quality gate ─────────────
  let written: string[] = [];
  let discarded = 0;
  let draftNotes: DraftNotes | null = null;
  const shortfall = count - chosen.length;
  // A form the writers never write (questionRubric.FORMS_NOT_WRITTEN) is served from the bank alone.
  const unwritten = form ? whyNotWritten(form) : null;
  let notWritten: string | null = null;
  if (shortfall > 0 && !unwritten) {
    const { data: avoidRows } = chosen.length
      ? await admin.from("question_bank").select("question").in("id", chosen)
      : { data: [] };
    const result = await writeForChapter(deps, {
      writer: "ai_practice",
      source: "ai_practice",
      ref: requestId,
      examId: syllabus.examId,
      examLabel: syllabus.label,
      chapter,
      topics,
      topicId,
      focus,
      difficulty,
      form: form && isWrittenForm(form) ? form : null,
      shortfall,
      stillNeeded: () => count - chosen.length,
      avoid: ((avoidRows ?? []) as Array<{ question: string }>).map((r) => r.question),
      // The bank already has it: serve that one if this student has not seen it.
      onTwin: (id) => { if (unseen.has(id) && !chosen.includes(id)) chosen.push(id); },
    });
    written = result.written;
    discarded = result.discarded;
    draftNotes = result.notes;
    notWritten = result.notWritten;
  }

  // ── 5. The session ────────────────────────────────────────────────────────
  const questionIds = [...chosen, ...written].slice(0, count);
  const fromBank = Math.min(chosen.length, questionIds.length);
  const status = questionIds.length === 0 ? "failed" : questionIds.length < count ? "short" : "ready";
  const notWrittenWhy = unwritten ?? notWritten;
  const message = notWrittenWhy && status !== "ready"
    ? status === "failed" ? notWrittenWhy : `${notWrittenWhy} Here are the ${questionIds.length} the bank holds.`
    : status === "failed"
      ? "AI couldn't make questions good enough for that just now. Try again, or ask a little differently."
      : status === "short"
        ? `${questionIds.length} of the ${count} questions passed the quality check; the rest were thrown away rather than give you a weak question.`
        : null;
  if (status === "failed") await giveBack();

  const logged = await log({
    subject: chapter.subject,
    chapter_id: chapter.chapter_id,
    topic_id: topicId,
    difficulty,
    form,
    requested: count,
    question_ids: questionIds,
    from_bank: fromBank,
    written: questionIds.length - fromBank,
    discarded,
    drafts: draftNotes,
    status,
    message,
  });

  return jsonResponse({
    status,
    request_id: logged,
    question_ids: questionIds,
    from_bank: fromBank,
    written: questionIds.length - fromBank,
    discarded,
    subject: chapter.subject,
    chapter: chapter.chapter,
    topic: topic?.name ?? null,
    message,
  });
}
