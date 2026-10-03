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
import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { completeWithQwen } from "../_shared/modelRouter.ts";
import { completeThinking } from "../_shared/thinkingCompletion.ts";
import { describeSolves, examLabel, type Solved, solveOnce, writeExplanation } from "../_shared/answerCheck.ts";
import { letterOf } from "../_shared/explanationFormat.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-variant-drain",
};
/** The whole claimed batch at once: each question can take most of a minute, and the
 *  function has 150 seconds — four at a time ran three rounds of that. */
const CONCURRENCY = 12;

type Claimed = {
  id: string;
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  question: string;
  options: unknown;
  correct_index: number;
  explanation: string | null;
  exam_code: string | null;
  class_level: number | null;
  board: string | null;
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });
}

/** Earlier "AI check" lines are this function's own; a question that now passes drops them. */
const withoutAiChecks = (note: string | null | undefined) =>
  (note ?? "").split("\n").filter((l) => l.trim() && !l.startsWith("AI check ")).join("\n") || null;

type Outcome = "proper" | "disputed" | "failed";

// deno-lint-ignore no-explicit-any
type Admin = SupabaseClient<any, "public", any>;

async function handleOne(admin: Admin, row: Claimed): Promise<Outcome> {
  const options = Array.isArray(row.options) ? row.options.map((o) => String(o ?? "")) : [];
  const fail = async () => {
    await admin.from("question_bank")
      .update({ explanation_status: "failed", explanation_claimed_at: null })
      .eq("id", row.id).in("explanation_status", ["rewriting", "pending"]);
    return "failed" as const;
  };
  if (options.length < 2) return fail();
  const label = examLabel(row);

  const first = await solveOnce(completeThinking, label, { question: row.question, options }, 0);
  let agreed = first.index === row.correct_index;
  let second: Solved = { index: null, why: "no reply" };
  if (!agreed) {
    second = await solveOnce(completeThinking, label, { question: row.question, options }, 0.4);
    agreed = second.index === row.correct_index;
  }
  if (!agreed) {
    const note = `AI check ${new Date().toISOString().slice(0, 10)}: solved twice as ${describeSolves([first, second])}; the key is (${letterOf(row.correct_index)}).`;
    const { data: cur } = await admin.from("question_bank").select("review_note").eq("id", row.id).maybeSingle();
    const prior = (cur as { review_note?: string | null } | null)?.review_note;
    await admin.from("question_bank")
      .update({ explanation_status: "disputed", explanation_claimed_at: null, review_note: prior ? `${prior}\n${note}` : note })
      .eq("id", row.id).eq("explanation_status", "rewriting");
    return "disputed";
  }

  const text = await writeExplanation(completeWithQwen, label, {
    subject: row.subject, chapter: row.chapter, topic: row.topic, question: row.question,
    options, correctIndex: row.correct_index, previous: row.explanation,
  });
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
