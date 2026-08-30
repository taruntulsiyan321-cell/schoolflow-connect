// Generate recovery variants of a student's own wrong question — OpenRouter.
//
// This file was dpp-generate-questions. DPP is gone (Chunk 7.5), that function
// had zero callers left, and its whole shape — role gate, school context,
// budget reserve, structured completion with fallback — is exactly what §4.2a's
// variant generation needs. Repurposed rather than deleted and rebuilt.
//
// WHAT IT DOES (spec §4.2a)
//   Tier 1  same question, DIFFERENT VALUES. Preserve the method exactly;
//           change only values, names or context. Same steps, same answer shape.
//   Tier 2  same concept, DIFFERENT STRUCTURE. Reverse what is given and what
//           is asked, embed it in another scenario, or ask for a different
//           output of the same idea.
//   Tier 3  same topic, DIFFERENT APPLICATION.
//
// The correct answer is generated with the question, so §10.8's auto-grade rule
// applies and grading is immediate.
//
// A variant that cannot be generated is SKIPPED, NOT FAKED. Anything that fails
// validation is dropped and counted; nothing is padded to hit a target.
//
// WHO MAY CALL IT
// The service role only. §4.1a is emphatic that nothing is generated while a
// student watches a loading screen — this runs after a practice session ends,
// as a background job. Leaving it callable by a signed-in user would put an
// unbounded paid AI call behind a student's session, which is the failure this
// design exists to avoid. The old role gate (teacher/admin/principal) was right
// for a teacher pressing "generate"; it is wrong for a background worker.
//
// WHY GENERATED VARIANTS ARE SAVED APPROVED AND ACTIVE
// question_bank's SELECT policy is `is_approved AND board matches`. A variant
// saved unapproved is invisible to every student, so the bank-first lookup
// returns nothing and §4.2a's economics — "there, free and instant, for the
// next student who fails the same one" — never start paying. The spec makes
// this call explicitly: "Variants are ordinary bank questions. They can be
// served in normal practice to any student, which is fine and desirable."
// Worth being clear-eyed about what that means: unreviewed AI content becomes
// servable to every student in the school. That is the spec's decision, and
// scripts/dump-variants.mjs exists so a human can actually read what landed.
import { corsHeaders, generateStructuredWithFallback, jsonResponse } from "../_shared/structuredCompletion.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

type SourceQuestion = {
  id: string;
  class_level: number | null;
  subject: string | null;
  chapter: string | null;
  chapter_id: string | null;
  topic: string | null;
  subtopic: string | null;
  concept: string | null;
  difficulty: string | null;
  board: string | null;
  question: string;
  options: unknown;
  correct_index: number | null;
  explanation: string | null;
};

type GeneratedVariant = {
  question?: unknown;
  options?: unknown;
  correct_index?: unknown;
  explanation?: unknown;
};

const TIER_RULES: Record<number, string> = {
  1:
    "TIER 1 — NEAR TRANSFER. Preserve the solution METHOD exactly. Change only the numbers, " +
    "names, or surface context. The steps a student takes must be identical to the original, " +
    "and the answer must have the same shape (same units, same kind of quantity). " +
    "Do NOT change what is being asked. If the original asks which item is debited, yours asks " +
    "which item is debited. This rung proves the student can EXECUTE the procedure.",
  2:
    "TIER 2 — MID TRANSFER. Preserve the CONCEPT and change the STRUCTURE. You must do at least " +
    "one of: (a) reverse what is given and what is asked, so the original's answer becomes your " +
    "question's input; (b) embed the same idea in a different scenario or account type; " +
    "(c) ask for a different output of the same underlying idea. " +
    "Rewording the original, or changing only its numbers, is a FAILED tier-2 variant — that is " +
    "tier 1 wearing a different label. A student who memorised the original's answer must not be " +
    "able to answer yours from memory. This rung proves the student UNDERSTANDS it.",
  3:
    "TIER 3 — FAR TRANSFER. Same topic, DIFFERENT APPLICATION. Use the same underlying principle " +
    "in a situation the original never mentions. This rung proves the understanding TRANSFERS.",
};

/** §4.2a: the correct answer is generated with the question, so grading is immediate. */
const SCHEMA = {
  type: "object",
  properties: {
    variants: {
      type: "array",
      items: {
        type: "object",
        properties: {
          question: { type: "string" },
          options: { type: "array", items: { type: "string" }, minItems: 4, maxItems: 4 },
          correct_index: { type: "integer", minimum: 0, maximum: 3 },
          explanation: { type: "string" },
        },
        required: ["question", "options", "correct_index", "explanation"],
      },
    },
  },
  required: ["variants"],
};

/**
 * Skipped, not faked. Every reason a variant is dropped is counted and named, so
 * "we made 2 of 3" is never reported as "we made 3" and a systematically bad
 * prompt shows up as a skip reason rather than as silence.
 */
function validate(v: GeneratedVariant, original: string): { ok: true; value: {
  question: string; options: string[]; correct_index: number; explanation: string;
} } | { ok: false; why: string } {
  const q = typeof v.question === "string" ? v.question.trim() : "";
  if (q.length < 12) return { ok: false, why: "question missing or too short" };

  if (!Array.isArray(v.options)) return { ok: false, why: "options not an array" };
  const options = v.options.map((o) => (typeof o === "string" ? o.trim() : "")).filter((o) => o.length > 0);
  if (options.length !== 4) return { ok: false, why: `expected 4 non-empty options, got ${options.length}` };
  if (new Set(options.map((o) => o.toLowerCase())).size !== 4) {
    return { ok: false, why: "duplicate options — the distractors are not distinct" };
  }

  const ci = typeof v.correct_index === "number" ? v.correct_index : Number.NaN;
  if (!Number.isInteger(ci) || ci < 0 || ci > 3) return { ok: false, why: `correct_index ${String(v.correct_index)} out of range` };

  const explanation = typeof v.explanation === "string" ? v.explanation.trim() : "";
  if (explanation.length < 10) return { ok: false, why: "explanation missing or too short" };

  // A variant identical to the original teaches nothing and would quietly make
  // tier 2 look full while testing tier 0.
  if (q.toLowerCase() === original.trim().toLowerCase()) {
    return { ok: false, why: "identical to the original question" };
  }

  return { ok: true, value: { question: q, options, correct_index: ci, explanation } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const presented = (req.headers.get("Authorization") ?? "").replace(/^Bearer\s+/i, "").trim();
  if (!serviceKey || presented !== serviceKey) {
    // Deliberately not "invalid role" — this endpoint is not for users at all.
    return jsonResponse({ error: "This is a background job endpoint; service role required." }, 403);
  }

  const admin = createClient(Deno.env.get("SUPABASE_URL")!, serviceKey);
  const startedAt = Date.now();

  try {
    const body = await req.json().catch(() => ({}));
    const sourceQuestionId = String(body.source_question_id ?? "");
    const tier = Number(body.tier);
    const count = Math.max(1, Math.min(5, Number(body.count ?? 1)));
    const dryRun = body.dry_run === true;

    if (!sourceQuestionId) return jsonResponse({ error: "source_question_id is required" }, 400);
    if (![1, 2, 3].includes(tier)) return jsonResponse({ error: "tier must be 1, 2 or 3" }, 400);

    const { data: src, error: srcErr } = await admin
      .from("question_bank")
      .select(
        "id, class_level, subject, chapter, chapter_id, topic, subtopic, concept, difficulty, board, question, options, correct_index, explanation",
      )
      .eq("id", sourceQuestionId)
      .single<SourceQuestion>();

    if (srcErr || !src) return jsonResponse({ error: `source question not found: ${srcErr?.message ?? "no row"}` }, 404);

    // §4.2a's input list, and nothing beyond it.
    const originalOptions = Array.isArray(src.options) ? (src.options as unknown[]).map(String) : [];
    const correctAnswer =
      src.correct_index !== null && originalOptions[src.correct_index] !== undefined
        ? originalOptions[src.correct_index]
        : "(not recorded)";

    const system =
      "You write multiple-choice questions for Indian school students (CBSE/RBSE, NCERT syllabus). " +
      "You are given ONE question a student got wrong, and you produce transfer variants of it.\n\n" +
      TIER_RULES[tier] +
      "\n\nHARD RULES:\n" +
      "- Exactly 4 options, all distinct, exactly one correct.\n" +
      "- The correct answer must be genuinely derivable from the question as written.\n" +
      "- Match the difficulty of the original. §4.2: if they failed an easy question, a hard " +
      "variant teaches nothing but discouragement.\n" +
      "- Stay inside the same chapter and topic.\n" +
      "- Write the explanation so it teaches the step the student most likely missed.\n" +
      "- If you cannot write a genuine variant at this tier, return fewer. Returning a reworded " +
      "copy to fill the count is worse than returning nothing.";

    const user = [
      `Chapter: ${src.chapter ?? "(unknown)"}`,
      `Topic: ${src.topic ?? "(unknown)"}${src.subtopic ? ` / ${src.subtopic}` : ""}`,
      src.concept ? `Concept: ${src.concept}` : null,
      `Subject: ${src.subject ?? "(unknown)"}`,
      `Class: ${src.class_level ?? "(unknown)"}`,
      `Difficulty to match: ${src.difficulty ?? "(unknown)"}`,
      "",
      "ORIGINAL QUESTION (the student got this wrong):",
      src.question,
      ...originalOptions.map((o, i) => `  ${String.fromCharCode(65 + i)}. ${o}`),
      `CORRECT ANSWER: ${correctAnswer}`,
      src.explanation ? `WHY: ${src.explanation}` : null,
      "",
      `Produce ${count} tier-${tier} variant(s).`,
    ]
      .filter((l) => l !== null)
      .join("\n");

    // Retries are the caller's job, not this function's: §4.1a says failures
    // retry in the BACKGROUND and the student never sees them, and the retry
    // budget (GENERATION_MAX_RETRIES) belongs with the scheduler that knows how
    // many chapters are queued. One call here does one attempt and reports
    // honestly whether it worked.
    const ai = await generateStructuredWithFallback<{ variants: GeneratedVariant[] }>(
      { system, user, schema: SCHEMA, toolName: "emit_variants" },
      { max_tokens: Math.min(4000, Math.max(1200, count * 320)), temperature: 0.7 },
    );

    if (!ai.ok) return jsonResponse({ error: ai.error, retryable: true }, ai.status);

    const skipped: string[] = [];
    const accepted = [];
    for (const raw of (ai.data.variants ?? []).slice(0, count)) {
      const v = validate(raw, src.question);
      if (!v.ok) {
        skipped.push(v.why);
        continue;
      }
      accepted.push(v.value);
    }

    const usage = {
      model_id: ai.model_id ?? null,
      source: ai.source,
      prompt_tokens: ai.usage?.prompt_tokens ?? null,
      completion_tokens: ai.usage?.completion_tokens ?? null,
      elapsed_ms: Date.now() - startedAt,
    };

    if (dryRun) {
      return jsonResponse({
        dry_run: true,
        source_question_id: src.id,
        tier,
        requested: count,
        generated: accepted.length,
        skipped,
        variants: accepted,
        usage,
      });
    }

    if (accepted.length === 0) {
      return jsonResponse({
        source_question_id: src.id,
        tier,
        requested: count,
        inserted: 0,
        skipped,
        usage,
        note: "nothing was written — a variant that cannot be generated is skipped, not faked (§4.2a)",
      });
    }

    const rows = accepted.map((v) => ({
      class_level: src.class_level,
      subject: src.subject,
      chapter: src.chapter,
      chapter_id: src.chapter_id,
      topic: src.topic,
      subtopic: src.subtopic,
      concept: src.concept,
      // §4.2: variants mirror the difficulty of what was failed.
      difficulty: src.difficulty,
      board: src.board,
      question: v.question,
      options: v.options,
      correct_index: v.correct_index,
      explanation: v.explanation,
      source: "ai_recovery_variant",
      source_type: "ai_generated",
      // See the header: unapproved means invisible, which means the cache never
      // pays. The spec makes this call explicitly.
      is_approved: true,
      is_active: true,
      source_question_id: src.id,
      variant_tier: tier,
    }));

    const { data: inserted, error: insErr } = await admin
      .from("question_bank")
      .insert(rows)
      .select("id");

    if (insErr) return jsonResponse({ error: `insert failed: ${insErr.message}`, retryable: true }, 500);

    return jsonResponse({
      source_question_id: src.id,
      tier,
      requested: count,
      inserted: inserted?.length ?? 0,
      variant_ids: (inserted ?? []).map((r) => r.id),
      skipped,
      usage,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error", retryable: true }, 500);
  }
});
