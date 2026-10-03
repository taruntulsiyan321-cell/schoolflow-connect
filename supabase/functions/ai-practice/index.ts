/**
 * ai-practice — a practice session from what the student asks for.
 *
 * Owner's ruling 2026-10-02. The student types "20 medium questions on
 * goodwill"; this reads it into one chapter of their syllabus, serves the
 * bank's matching questions first (nearest the request's meaning, none they
 * answered in the last 30 days), and writes only the shortfall. Every written
 * question is solved again, independently, and kept only if both agree on the
 * answer; then it enters the shared bank through store_generated_questions,
 * tagged to its chapter and topic, with an explanation in the ruled shape
 * (_shared/explanationFormat.ts). Anything the bank already holds — by meaning,
 * not only by wording — is served from the bank instead of being stored twice.
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
import { completeWithQwen } from "../_shared/modelRouter.ts";
import { completeThinking } from "../_shared/thinkingCompletion.ts";
import { embedQueryText } from "../_shared/embeddingProvider.ts";
import {
  PROMPT_MAX_CHARS,
  SAME_QUESTION_SIMILARITY,
  cosine,
  readModelJson,
  readRequestReply,
  readSolveText,
  readTopicDraft,
  readWrittenQuestion,
  relevantFromBank,
  requestSystemPrompt,
  solveSystemPrompt,
  solveUserPrompt,
  topicDraftPrompt,
  writeSystemPrompt,
  writePlan,
  writeUserPrompt,
  type StyleExample,
  type WrittenQuestion,
} from "../_shared/aiPractice.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

/**
 * Each written question is checked on its own call, thinking first
 * (completeThinking) — the check with reasoning off got correctly keyed
 * Accountancy wrong (question-explanations, 2026-10-02) — this many at once.
 */
const CHECK_CONCURRENCY = 10;

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

const textKey = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

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

  const log = async (row: Record<string, unknown>) => {
    const { data, error } = await admin.from("ai_practice_requests")
      .insert({ user_id: uid, prompt, ...row }).select("id").single();
    if (error) console.warn("ai-practice: request log failed:", error.message);
    return (data as { id?: string } | null)?.id ?? null;
  };
  const giveBack = () => premiumRelease(admin, uid, use);

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
  let topics = chapter.topics;
  if (topics.length === 0) {
    const p = topicDraftPrompt(syllabus.label, chapter.subject, chapter.chapter);
    const drafted = await completeWithQwen({ system: p.system, user: p.user, temperature: 0, max_tokens: 400 });
    const names = drafted.ok ? (() => { try { return readTopicDraft(readModelJson(drafted.text)); } catch { return null; } })() : null;
    for (const name of names ?? []) {
      const { error } = await admin.from("topics").insert({ chapter_id: chapter.chapter_id, name, origin: "ai_drafted" });
      if (error && error.code !== "23505") console.warn("ai-practice: topic insert failed:", error.message);
    }
    const { data: rows } = await admin.from("topics").select("id, name").eq("chapter_id", chapter.chapter_id).order("created_at");
    topics = (rows ?? []) as Array<{ id: string; name: string }>;
    if (topics.length === 0) {
      await giveBack();
      await log({ requested: count, subject: chapter.subject, chapter_id: chapter.chapter_id, difficulty, form, status: "failed", message: "no topics" });
      return jsonResponse({ status: "failed", message: "This chapter isn't ready for AI Practice yet. Please try another." });
    }
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

  // ── 4. Write the shortfall, check it, keep what agrees ───────────────────
  let written: string[] = [];
  let discarded = 0;
  /** What became of the drafts, kept on the request row (20261142000000). */
  let draftNotes: { batches: Array<Record<string, unknown>>; drafted: number; agreed: number; kept: number } | null = null;
  const shortfall = count - chosen.length;
  if (shortfall > 0) {
    // Style examples of the form asked for, when the bank has them.
    let exQuery = admin.from("question_bank")
      .select("question, options, correct_index")
      .eq("exam_id", syllabus.examId).eq("chapter_id", chapter.chapter_id)
      .eq("is_active", true).eq("is_approved", true).not("correct_index", "is", null);
    if (form) exQuery = exQuery.eq("question_format", form);
    const { data: exRows } = await exQuery.limit(3);
    const examples = ((exRows ?? []) as StyleExample[]).filter((e) => Array.isArray(e.options));
    const { data: avoidRows } = chosen.length
      ? await admin.from("question_bank").select("question").in("id", chosen)
      : { data: [] };
    const avoid = ((avoidRows ?? []) as Array<{ question: string }>).map((r) => r.question);

    const plan = writePlan(form, shortfall);
    const sizes = plan.batches;
    const replies = await Promise.all(sizes.map((n) => completeWithQwen({
      system: writeSystemPrompt(syllabus.label),
      user: writeUserPrompt({ subject: chapter.subject, chapter: chapter.chapter, topics, topicId, focus, difficulty, form, count: n, examples, avoid }),
      temperature: 0.7,
      max_tokens: plan.maxTokens(n),
    })));

    draftNotes = { batches: [], drafted: 0, agreed: 0, kept: 0 };
    const drafts: WrittenQuestion[] = [];
    const seenText = new Set(avoid.map(textKey));
    for (const [b, reply] of replies.entries()) {
      // A batch that failed, was cut off, or is not JSON writes nothing: every
      // question asked of it counts as discarded, and the request row says why.
      if (!reply.ok) { discarded += sizes[b]; draftNotes.batches.push({ asked: sizes[b], failed: reply.error }); continue; }
      let list: unknown[] = [];
      let unreadable: string | null = null;
      try {
        const parsed = readModelJson<{ questions?: unknown }>(reply.text).questions;
        if (Array.isArray(parsed)) list = parsed; else unreadable = "no questions list in the reply";
      } catch (e) {
        unreadable = (e instanceof Error ? e.message : String(e)).slice(0, 160);
      }
      const refused: string[] = [];
      for (const raw of list) {
        const r = readWrittenQuestion(raw, topics, topicId);
        if (!r.ok || seenText.has(textKey(r.question.question))) { discarded++; refused.push(r.ok ? "already written" : r.reason); continue; }
        seenText.add(textKey(r.question.question));
        drafts.push(r.question);
      }
      discarded += Math.max(0, sizes[b] - list.length);
      draftNotes.batches.push({
        asked: sizes[b], read: list.length, finish: reply.finish_reason ?? null, refused,
        ...(unreadable ? { unreadable, tail: reply.text.slice(-200) } : {}),
      });
    }

    // The independent check: each solved again, without the answer.
    const verdicts: Array<number | null> = new Array(drafts.length).fill(null);
    for (let i = 0; i < drafts.length; i += CHECK_CONCURRENCY) {
      const part = drafts.slice(i, i + CHECK_CONCURRENCY);
      const got = await Promise.all(part.map(async (q) => {
        const solved = await completeThinking({
          system: solveSystemPrompt(syllabus.label),
          user: solveUserPrompt([q]),
          temperature: 0,
          max_tokens: 6000,
          reasoning_tokens: 4000,
        });
        return solved.ok ? readSolveText(solved.text, 1)[0] : null;
      }));
      got.forEach((v, k) => { verdicts[i + k] = v; });
    }
    const agreed = drafts.filter((q, i) => verdicts[i] === q.correctIndex);
    draftNotes.drafted = drafts.length;
    draftNotes.agreed = agreed.length;
    discarded += drafts.length - agreed.length;

    // The same question by meaning: already in the bank, or twice in this batch.
    const keep: WrittenQuestion[] = [];
    const vectors: number[][] = [];
    // Every vector at once: one at a time they added seconds a question to a request near its limit.
    const embedded = await Promise.all(agreed.map((q) => embedQueryText(q.question, { env })));
    for (const [k, q] of agreed.entries()) {
      if (chosen.length + keep.length >= count) break;
      const e = embedded[k];
      if (e.ok) {
        if (vectors.some((v) => cosine(v, e.embedding) >= SAME_QUESTION_SIMILARITY)) { discarded++; continue; }
        const { data: near } = await admin.rpc("match_question_bank_for_exam", {
          p_query_embedding: JSON.stringify(e.embedding),
          p_exam_id: syllabus.examId,
          p_subjects: [chapter.subject],
          p_match_threshold: SAME_QUESTION_SIMILARITY,
          p_match_count: 1,
        });
        const twin = Array.isArray(near) ? (near[0] as { id?: string } | undefined)?.id : undefined;
        if (twin) {
          // The bank already has it: serve that one if this student has not seen it.
          if (unseen.has(twin) && !chosen.includes(twin)) chosen.push(twin);
          discarded++;
          continue;
        }
        vectors.push(e.embedding);
      }
      keep.push(q);
    }

    if (keep.length) {
      const { data: stored, error: storeErr } = await admin.rpc("store_generated_questions", {
        _questions: keep.map((q) => ({
          topic_id: q.topicId,
          exam_id: syllabus.examId,
          question: q.question,
          options: q.options,
          correct_index: q.correctIndex,
          explanation: q.explanation,
          difficulty: q.difficulty,
          source: "ai_practice",
        })),
      });
      if (storeErr) {
        console.error("ai-practice: store failed:", storeErr.message);
      } else {
        const s = stored as { inserted?: Array<{ id: string }>; skipped?: Array<{ existing_id?: string }> };
        written = (s.inserted ?? []).map((r) => r.id);
        draftNotes.kept = written.length;
        for (const k of s.skipped ?? []) {
          discarded++;
          if (k.existing_id && unseen.has(k.existing_id) && !chosen.includes(k.existing_id)) chosen.push(k.existing_id);
        }
      }
    }
  }

  // ── 5. The session ────────────────────────────────────────────────────────
  const questionIds = [...chosen, ...written].slice(0, count);
  const fromBank = Math.min(chosen.length, questionIds.length);
  const status = questionIds.length === 0 ? "failed" : questionIds.length < count ? "short" : "ready";
  const message = status === "failed"
    ? "AI couldn't make questions it was sure of for that just now. Try again, or ask a little differently."
    : status === "short"
      ? `${questionIds.length} of the ${count} questions passed the answer check; the rest were thrown away rather than risk a wrong answer.`
      : null;
  if (status === "failed") await giveBack();

  const requestId = await log({
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
    request_id: requestId,
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
