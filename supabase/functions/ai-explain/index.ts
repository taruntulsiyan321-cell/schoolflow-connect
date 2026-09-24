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

    const system =
      "You are an expert CBSE/NCERT Mathematics and Science tutor for Indian Class 6–12 students. " +
      "The student just answered an MCQ. Your job is a short, high-quality coaching explanation.\n\n" +
      "Rules:\n" +
      "- Be specific to THIS exact question and the option they chose — never generic advice.\n" +
      "- If wrong: name the misconception, show why their option fails, then the correct method in 2–4 clear steps.\n" +
      "- If correct: confirm the reasoning in one sentence, then one deeper NCERT insight.\n" +
      "- Use simple English, warm tone, no jargon without defining it.\n" +
      "- summary: max 2 sentences. why_wrong: 3–5 sentences with steps. concept: the rule/formula tested. how_to_improve: one actionable drill.";

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
        summary: { type: "string", description: "One sentence: the correct answer and why." },
        why_wrong: {
          type: "string",
          description: "2-4 sentences: why the student's choice is wrong OR why correct option works; include brief steps.",
        },
        concept: { type: "string", description: "NCERT concept name + key formula/rule in one line." },
        how_to_improve: { type: "string", description: "One actionable tip tied to this exact question type." },
      },
      required: ["summary", "why_wrong", "concept", "how_to_improve"],
    };

    const result = await generateStructured<{
      summary: string;
      why_wrong: string;
      concept: string;
      how_to_improve: string;
    }>({ system, user, schema, toolName: "emit_explanation" });

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
