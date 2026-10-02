/**
 * question-explanations — gives every exam question a proper explanation.
 *
 * Owner's ruling 2026-10-02: an explanation is the working, step by step, and
 * for each wrong option why it is wrong (_shared/explanationFormat.ts; the
 * database's explanation_is_proper decides what passes). Cron
 * 'rewrite-question-explanations' calls this every minute while exam questions
 * wait (dispatch_explanation_rewrite, 20261138000000).
 *
 * Each claimed question is SOLVED FIRST, without its key. Only when the solver
 * reaches the key — once, or on a second try — is the explanation written for
 * it. When both tries reach another answer the question is 'disputed': its old
 * explanation stays, and review_note says what the solver chose, for the owner
 * to rule on. An explanation is never written to argue for a key the model
 * could not reach.
 *
 * Background job endpoint: x-variant-drain, the same secret the other drains use.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completeWithQwen } from "../_shared/modelRouter.ts";
import { completeThinking } from "../_shared/thinkingCompletion.ts";
import { readModelJson, readSolveText, solveSystemPrompt, solveUserPrompt } from "../_shared/aiPractice.ts";
import {
  composeExplanation,
  explainSystemPrompt,
  explainUserPrompt,
  explanationShortfall,
  letterOf,
  readExplanationParts,
} from "../_shared/explanationFormat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-variant-drain",
};
/** The whole claimed batch at once: each question can take most of a minute, and the
 *  function has 150 seconds — four at a time ran three rounds of that. */
const CONCURRENCY = 12;
const EXAM_LABEL = "CUET (UG)";

type Claimed = {
  id: string;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  question: string;
  options: unknown;
  correct_index: number;
  explanation: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/**
 * The check thinks before it answers (completeThinking): with reasoning off it
 * reached wrong answers on correctly keyed Accountancy questions (2026-10-02).
 * Room for the thinking, and for a short JSON answer after it.
 */
const SOLVE_TOKENS = 8000;
const SOLVE_THINKING = 5000;

type Solved = { index: number | null; why: "answer" | "none" | "cut off" | "unreadable" | "no reply" };

async function solveOnce(q: { question: string; options: string[] }, temperature: number): Promise<Solved> {
  const r = await completeThinking({
    system: solveSystemPrompt(EXAM_LABEL),
    user: solveUserPrompt([q]),
    temperature,
    max_tokens: SOLVE_TOKENS,
    reasoning_tokens: SOLVE_THINKING,
  });
  if (!r.ok) return { index: null, why: r.error === "cut off while thinking" ? "cut off" : "no reply" };
  const index = readSolveText(r.text, 1)[0];
  if (index != null) return { index, why: "answer" };
  if (r.finish_reason === "length") return { index: null, why: "cut off" };
  return /"answer"\s*:\s*"none"/i.test(r.text) ? { index: null, why: "none" } : { index: null, why: "unreadable" };
}

/** Earlier "AI check" lines are this function's own; a question that now passes drops them. */
const withoutAiChecks = (note: string | null | undefined) =>
  (note ?? "").split("\n").filter((l) => l.trim() && !l.startsWith("AI check ")).join("\n") || null;

async function explain(row: Claimed, options: string[]): Promise<string | null> {
  const ask = (extra: string) => completeWithQwen({
    system: explainSystemPrompt(EXAM_LABEL),
    user: explainUserPrompt({
      subject: row.subject, chapter: row.chapter, topic: row.topic, question: row.question,
      options, correctIndex: row.correct_index, previous: row.explanation,
    }) + extra,
    temperature: 0.2,
    max_tokens: 1800,
  });
  let extra = "";
  for (let attempt = 0; attempt < 2; attempt++) {
    const r = await ask(extra);
    if (!r.ok) return null;
    let parts = null;
    try { parts = readExplanationParts(readModelJson(r.text)); } catch { parts = null; }
    if (parts) {
      const composed = composeExplanation(options, row.correct_index, parts);
      if (composed) return composed;
      extra = `\n\nYour last answer fell short: ${explanationShortfall(options, row.correct_index, parts)}. Write it in full.`;
    } else {
      extra = "\n\nYour last answer was not the JSON asked for.";
    }
  }
  return null;
}

type Outcome = "proper" | "disputed" | "failed";

async function handleOne(admin: ReturnType<typeof createClient>, row: Claimed): Promise<Outcome> {
  const options = Array.isArray(row.options) ? row.options.map((o) => String(o ?? "")) : [];
  const fail = async () => {
    await admin.from("question_bank")
      .update({ explanation_status: "failed", explanation_claimed_at: null })
      .eq("id", row.id).in("explanation_status", ["rewriting", "pending"]);
    return "failed" as const;
  };
  if (options.length < 2) return fail();

  const first = await solveOnce({ question: row.question, options }, 0);
  let agreed = first.index === row.correct_index;
  let second: Solved = { index: null, why: "no reply" };
  if (!agreed) {
    second = await solveOnce({ question: row.question, options }, 0.4);
    agreed = second.index === row.correct_index;
  }
  if (!agreed) {
    const said = [first, second]
      .map((x) => (x.index != null ? `(${letterOf(x.index)})` : x.why === "none" ? "no single answer" : `no answer (${x.why})`))
      .join(", then ");
    const note = `AI check ${new Date().toISOString().slice(0, 10)}: solved twice as ${said}; the key is (${letterOf(row.correct_index)}).`;
    const { data: cur } = await admin.from("question_bank").select("review_note").eq("id", row.id).maybeSingle();
    const prior = (cur as { review_note?: string | null } | null)?.review_note;
    await admin.from("question_bank")
      .update({ explanation_status: "disputed", explanation_claimed_at: null, review_note: prior ? `${prior}\n${note}` : note })
      .eq("id", row.id).eq("explanation_status", "rewriting");
    return "disputed";
  }

  const text = await explain(row, options);
  if (!text) return fail();
  const { data: cur } = await admin.from("question_bank").select("review_note").eq("id", row.id).maybeSingle();
  const { data, error } = await admin.from("question_bank")
    .update({ explanation: text, review_note: withoutAiChecks((cur as { review_note?: string | null } | null)?.review_note) })
    .eq("id", row.id).eq("explanation_status", "rewriting")
    .select("explanation_status").maybeSingle();
  if (error || !data) return fail();
  // The database's rule has the last word: anything it does not call proper
  // is failed, not left pending to be claimed again forever.
  if ((data as { explanation_status: string }).explanation_status !== "proper") return fail();
  return "proper";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

  const body = (await req.json().catch(() => ({}))) as { limit?: unknown };
  const limit = Math.max(1, Math.min(20, Number(body.limit) || 12));
  const { data, error } = await admin.rpc("claim_explanation_rewrites", { _limit: limit });
  if (error) return jsonResponse({ error: `claim: ${error.message}` }, 500);
  const rows = (data ?? []) as Claimed[];

  const tally: Record<Outcome, number> = { proper: 0, disputed: 0, failed: 0 };
  for (let i = 0; i < rows.length; i += CONCURRENCY) {
    const outcomes = await Promise.all(rows.slice(i, i + CONCURRENCY).map((r) =>
      handleOne(admin, r).catch((e) => {
        console.error("question-explanations:", r.id, e);
        return "failed" as const;
      })));
    for (const o of outcomes) tally[o]++;
  }
  return jsonResponse({ claimed: rows.length, ...tally });
});
