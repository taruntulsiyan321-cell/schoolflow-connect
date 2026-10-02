// Explain a quiz answer — OpenRouter (Qwen).
//
// ── THE CACHE LIVES HERE, NOT IN THE BROWSER ────────────────────────────────
//
// ai_explanations is a cache of explanations of BANK questions, which are
// global (G2). It was written from the client, and could not work from there:
//
//   · the insert omitted created_by, so its own RLS policy refused it —
//     42501, swallowed by `.then(() => {}, () => {})`, measured 2026-09-18 as
//     0 rows in the table platform-wide;
//   · cache_key is the PRIMARY KEY, globally unique, while the SELECT policy
//     is per school — so even with the insert fixed, the second school to ask
//     about a question could never read the first school's row and could never
//     write its own. Every click would pay for a fresh model call for ever.
//
// So the function owns it: it looks the key up with the service key, answers
// from the row when there is one, and stores what the model returned. That
// also takes the payload out of the client's hands — a cache any student could
// write is a cache any student could poison for everyone else.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { corsHeaders, generateStructured, jsonResponse } from "../_shared/structuredCompletion.ts";
import { requireUserJwt } from "../_shared/requireAuth.ts";
import {
  planLimitResponse,
  premiumAdminClient,
  premiumCheck,
  premiumUnavailableResponse,
  PremiumUnavailableError,
} from "../_shared/premium.ts";

type Explanation = {
  summary: string;
  why_wrong: string;
  concept: string;
  how_to_improve: string;
};

/**
 * The cache key: this question, and this answer to it. Same recipe the browser
 * used (djb2 over the parts, joined by ¦), so a key is stable across clients.
 */
function cacheKeyFor(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => (p ?? "")).join("¦");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "ex_" + h.toString(36) + "_" + s.length.toString(36);
}

function admin() {
  const url = Deno.env.get("SUPABASE_URL");
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  // No service key: answer without the cache rather than refuse the student.
  return url && key ? createClient(url, key) : null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const __auth = await requireUserJwt(req);
  if (!__auth.ok) return __auth.response;

  // PLANS (20261111000000): an explanation is Explain my mistake, which the
  // plan must include. Not counted — a cached explanation costs nothing, and
  // the plan either has the feature or not. A school's student always has it.
  try {
    const explain = await premiumCheck(premiumAdminClient(), __auth.value.user.id, "mistake.explain");
    if (!explain.ok) return planLimitResponse(explain, corsHeaders);
  } catch (e) {
    if (e instanceof PremiumUnavailableError) return premiumUnavailableResponse(corsHeaders);
    throw e;
  }

  try {
    const body = await req.json();
    const {
      question = "",
      options = [],
      correct_index = null,
      selected_index = null,
      correct_text = "",
      selected_text = "",
      subject = "",
      chapter = "",
      topic = "",
      grade = "",
    } = body ?? {};

    if (!question || String(question).trim().length === 0) {
      return jsonResponse({ error: "A question is required" }, 400);
    }

    // One explanation per (question, the answer given to it), for everyone.
    const cacheKey = cacheKeyFor([question, correct_index, selected_index, correct_text, selected_text]);
    const db = admin();
    if (db) {
      const { data: cached, error: cacheErr } = await db
        .from("ai_explanations")
        .select("payload")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (cacheErr) console.warn("ai-explain: cache read failed:", cacheErr.message);
      if (cached?.payload) {
        const p = cached.payload as Explanation;
        return jsonResponse({
          summary: p.summary ?? "",
          why_wrong: p.why_wrong ?? "",
          concept: p.concept ?? "",
          how_to_improve: p.how_to_improve ?? "",
          source: "cache",
        });
      }
    }

    const optLines = Array.isArray(options) && options.length
      ? options.map((o: string, i: number) => `${String.fromCharCode(65 + i)}. ${o}`).join("\n")
      : "(no options provided)";

    const correctLabel = typeof correct_index === "number" && correct_index >= 0
      ? `${String.fromCharCode(65 + correct_index)}. ${options?.[correct_index] ?? correct_text}`
      : correct_text || "(see explanation)";

    const chosenLabel = typeof selected_index === "number" && selected_index >= 0
      ? `${String.fromCharCode(65 + selected_index)}. ${options?.[selected_index] ?? selected_text}`
      : selected_index === -1
        ? "(left blank / timed out)"
        : selected_text || "(unknown)";

    const wasCorrect =
      typeof selected_index === "number" &&
      typeof correct_index === "number" &&
      selected_index === correct_index;

    // Owner, 2026-10-02: explanations must be complete, not short. This said
    // "a short … coaching explanation" from "a Mathematics and Science tutor
    // for Class 6–12" — to CUET Commerce students — capped the working at 3–5
    // sentences, and said nothing about the other options.
    const system =
      "You are an expert teacher for Indian Class 12 board and CUET (UG) students" +
      (subject ? ` in ${subject}` : "") + ". " +
      "The student just answered a multiple-choice question; explain it the way a good teacher would at the board.\n\n" +
      "Rules:\n" +
      "- Be specific to THIS question and the option they chose — never generic advice.\n" +
      "- If wrong: name the misconception behind their option and show exactly why it fails; then solve the question properly, step by step.\n" +
      "- If correct: confirm the reasoning step by step, then add one deeper insight from the NCERT chapter.\n" +
      "- Then, for EACH other option, one line on why it is wrong.\n" +
      "- For any calculation, show every step with its numbers.\n" +
      "- Simple English, warm tone; define any term you use.";

    const user = [
      subject ? `Subject: ${subject}` : "",
      chapter ? `Chapter: ${chapter}` : "",
      topic ? `Topic: ${topic}` : "",
      grade ? `Grade/Class: ${grade}` : "",
      `Question: ${question}`,
      `Options:\n${optLines}`,
      `Correct answer: ${correctLabel}`,
      `Student answered: ${chosenLabel}`,
      `Outcome: ${wasCorrect ? "CORRECT" : "INCORRECT / BLANK"}`,
    ].filter(Boolean).join("\n");

    const schema = {
      type: "object",
      properties: {
        summary: { type: "string", description: "1–2 sentences: the correct answer and the key reason." },
        why_wrong: {
          type: "string",
          description: "The full explanation: why the student's option fails (or why their correct choice works), the step-by-step solution, then one line per other option on why it is wrong. Separate the parts with line breaks.",
        },
        concept: { type: "string", description: "The concept and the rule or formula tested, in one or two lines." },
        how_to_improve: { type: "string", description: "One specific drill for this type of question." },
      },
      required: ["summary", "why_wrong", "concept", "how_to_improve"],
    };

    const result = await generateStructured<{
      summary: string;
      why_wrong: string;
      concept: string;
      how_to_improve: string;
    }>({ system, user, schema, toolName: "emit_explanation" }, { max_tokens: 1400 });

    if (!result.ok) return jsonResponse({ error: result.error }, result.status);

    const payload: Explanation = {
      summary: result.data.summary ?? "",
      why_wrong: result.data.why_wrong ?? "",
      concept: result.data.concept ?? "",
      how_to_improve: result.data.how_to_improve ?? "",
    };

    // Store it for the next student who meets this question. school_id and
    // created_by stay NULL: the row is about a global bank question and holds
    // nothing of the student who happened to ask first. A duplicate key means
    // another request cached it in the meantime — that is a hit, not an error.
    if (db) {
      const { error: writeErr } = await db
        .from("ai_explanations")
        .upsert({ cache_key: cacheKey, subject: subject || null, topic: topic || null, payload },
                { onConflict: "cache_key", ignoreDuplicates: true });
      if (writeErr) console.warn("ai-explain: cache write failed:", writeErr.message);
    }

    return jsonResponse({ ...payload, source: result.source });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error" }, 500);
  }
});
