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
//
// TIER 3 IS NOT GENERATED, and the branch that claimed to has been removed.
// It was dead code that looked alive, in two independent ways:
//   * rpc_recovery_session_plan takes tier 3 from the bank only and has never
//     asked this function for one, so nothing could reach the branch; and
//   * question_bank_variant_tier_check is `variant_tier IN (1, 2)`, so had
//     anything reached it, every insert would have died on a constraint.
// §4.2 says "tier 3 comes from the bank where coverage allows, AI otherwise";
// the planner implements the first half and the second half was never built.
// Restoring it means widening the constraint too, deliberately, not leaving a
// branch that cannot run.
//
// The correct answer is generated with the question, so §10.8's auto-grade rule
// applies and grading is immediate.
//
// A variant that cannot be generated is SKIPPED, NOT FAKED. Anything that fails
// validation is dropped and counted; nothing is padded to hit a target.
//
// WHO MAY CALL IT
// A background worker holding the `variant_generation_drain` secret, and
// nobody else. §4.1a is emphatic that nothing is generated while a student
// watches a loading screen — this runs after a practice session ends, as a
// background job. Leaving it callable by a signed-in user would put an
// unbounded paid AI call behind a student's session, which is the failure this
// design exists to avoid. The old role gate (teacher/admin/principal) was right
// for a teacher pressing "generate"; it is wrong for a background worker.
//
// The secret rather than the service-role key, because the caller is a
// postgres cron function reaching this over pg_net: the service-role key in a
// SQL function body is a master credential sitting in pg_proc, readable by
// anything that can read a function definition. A purpose-made secret in the
// vault opens exactly one door, and revoking it costs one UPDATE. This is the
// same shape dispatch_notification_push already uses in production for
// notification-push.
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

/**
 * The shape gate above is not an answer gate, and four questions proved it.
 *
 * Read and solved by hand on 2026-09-17, 4 of the 40 variants this function
 * had produced were mathematically wrong. Every one of them passed validate()
 * — they are well-formed: four distinct options, an index in range, a fluent
 * explanation. What none of them had was a correct answer:
 *
 *   "S_n = 3n^2 + 5n. What is the 10th term?"   a_10 = 62. Options: 47, 57,
 *                                               67, 77. Marked: 57.
 *   "Sum 216, first term 8, last term 56. How   n = 432/64 = 6.75. There is
 *    many terms?"                               no such AP. Marked: 6.
 *   "S_n = 3n^2 + 5n. nth term is 107. Find n"  6n+2 = 107 -> n = 17.5.
 *                                               Marked: 8.
 *   "a^3+b^3+c^3 = 3abc, abc != 0. a+b+c = ?"   0 OR a=b=c. a=b=c=1 gives 3,
 *                                               also on the list. Marked: 0.
 *
 * Three share one signature: the model invents numbers, does not solve what it
 * invented, and picks a plausible integer. The fourth is a "must be" question
 * with two correct options.
 *
 * These are RECOVERY questions. They go to the student who already failed the
 * topic, and the mistakes they create feed weak-topic detection, the recovery
 * ladder and the revision schedule. Measured: those four were served 5 times
 * and created 5 mistake-book rows, and one student was marked CORRECT for
 * answering 6 to a question whose answer is 6.75.
 *
 * So the question is solved again, in a SEPARATE call that is never told which
 * option the writer marked. Agreement is the gate. The solver is also asked
 * whether exactly one option is correct, which is what catches the fourth: a
 * question can have a derivable answer and still be broken because two of its
 * options are right.
 *
 * Temperature 0: this is arithmetic, not writing, and a solver that varies
 * run to run is not a check.
 *
 * COST. One extra call per generation batch, not per variant. §4.2a's
 * economics survive it — a wrong variant is cached and served to every student
 * who fails that question afterwards, so paying once to not store it is the
 * cheaper side of the trade by a wide margin.
 */
const CHECK_SCHEMA = {
  type: "object",
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        properties: {
          n: { type: "integer" },
          working: { type: "string" },
          // -1 is a real answer here: "none of these options is correct".
          // Without it the solver has to name one, and a forced choice from a
          // broken option list is exactly the failure being looked for.
          correct_index: { type: "integer", minimum: -1, maximum: 3 },
          exactly_one_correct: { type: "boolean" },
        },
        required: ["n", "working", "correct_index", "exactly_one_correct"],
      },
    },
  },
  required: ["answers"],
};

type SolvedAnswer = {
  n?: unknown;
  working?: unknown;
  correct_index?: unknown;
  exactly_one_correct?: unknown;
};

type Candidate = { question: string; options: string[]; correct_index: number; explanation: string };

/**
 * Solve each candidate independently and report, per candidate, why it may or
 * may not be stored. Never told the writer's answer.
 *
 * On a failed AI call every candidate is REJECTED, not waved through. A check
 * that disappears when it errors is not a check, and this function's own rule
 * is that a variant which cannot be produced is skipped rather than faked.
 */
async function solveBack(
  candidates: Candidate[],
  context: { subject: string; chapter: string; classLevel: string },
): Promise<{ verdicts: ({ ok: true } | { ok: false; why: string })[]; usage: unknown }> {
  const system =
    "You are a careful mathematics and science examiner for Indian school students " +
    "(CBSE/RBSE, NCERT syllabus). You are given multiple-choice questions and you SOLVE them.\n\n" +
    "For each question: work it out step by step, then say which option index (0-3) is correct.\n\n" +
    "HARD RULES:\n" +
    "- Do the arithmetic. Do not assume the question is well-posed.\n" +
    "- If your worked answer is NOT among the four options, return correct_index -1. " +
    "Do not pick the nearest one.\n" +
    "- If the question as worded has NO valid solution (a count that is not a whole number, " +
    "a contradictory condition), return correct_index -1.\n" +
    "- Set exactly_one_correct false if two or more options satisfy the question as worded, " +
    "even when one of them is the intended answer.";

  const user = [
    `Subject: ${context.subject}`,
    `Chapter: ${context.chapter}`,
    `Class: ${context.classLevel}`,
    "",
    ...candidates.flatMap((c, i) => [
      `QUESTION ${i}:`,
      c.question,
      ...c.options.map((o, oi) => `  ${oi}. ${o}`),
      "",
    ]),
    `Solve all ${candidates.length} and return one answer object per question, with n set to the question number.`,
  ].join("\n");

  const ai = await generateStructuredWithFallback<{ answers: SolvedAnswer[] }>(
    { system, user, schema: CHECK_SCHEMA, toolName: "emit_answers" },
    { max_tokens: Math.min(4000, Math.max(1200, candidates.length * 400)), temperature: 0 },
  );

  if (!ai.ok) {
    return {
      verdicts: candidates.map(() => ({
        ok: false as const,
        why: `answer check could not run (${ai.error}) — not stored unverified`,
      })),
      usage: null,
    };
  }

  const byN = new Map<number, SolvedAnswer>();
  for (const a of ai.data.answers ?? []) {
    const n = typeof a.n === "number" ? a.n : Number.NaN;
    if (Number.isInteger(n)) byN.set(n, a);
  }

  const verdicts = candidates.map((c, i) => {
    const a = byN.get(i);
    if (!a) return { ok: false as const, why: "answer check returned nothing for this variant" };
    if (a.exactly_one_correct === false) {
      return { ok: false as const, why: "more than one option satisfies the question as worded" };
    }
    const solved = typeof a.correct_index === "number" ? a.correct_index : Number.NaN;
    if (solved === -1) {
      return { ok: false as const, why: "solved independently: no option is correct" };
    }
    if (!Number.isInteger(solved) || solved < 0 || solved > 3) {
      return { ok: false as const, why: `answer check returned index ${String(a.correct_index)}` };
    }
    if (solved !== c.correct_index) {
      return {
        ok: false as const,
        why: `answer check says ${solved} ("${c.options[solved]}"), the writer marked ${c.correct_index} ("${c.options[c.correct_index]}")`,
      };
    }
    return { ok: true as const };
  });

  return { verdicts, usage: { model_id: ai.model_id ?? null, source: ai.source } };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const drain = Deno.env.get("VARIANT_GENERATION_DRAIN") ?? "";
  const presented = (req.headers.get("x-variant-drain") ?? "").trim();

  // A missing secret is a REFUSAL, never an open door. Without this branch an
  // unset environment variable would make "" === "" true for every caller,
  // which is the fail-open shape that turns a misconfiguration into a public
  // endpoint that spends money.
  if (!drain) {
    return jsonResponse({
      error: "VARIANT_GENERATION_DRAIN is not configured; refusing rather than running unauthenticated.",
    }, 503);
  }
  if (presented.length !== drain.length || presented !== drain) {
    // Deliberately not "invalid role" — this endpoint is not for users at all.
    return jsonResponse({ error: "This is a background job endpoint." }, 403);
  }
  if (!serviceKey) {
    return jsonResponse({ error: "SUPABASE_SERVICE_ROLE_KEY is not configured." }, 503);
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
    // 1 or 2 only — see the header. question_bank_variant_tier_check would
    // refuse anything else anyway; refusing it here says why.
    if (![1, 2].includes(tier)) {
      return jsonResponse({
        error: "tier must be 1 or 2; tier 3 comes from the bank, not from generation",
      }, 400);
    }

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
    const wellFormed: Candidate[] = [];
    for (const raw of (ai.data.variants ?? []).slice(0, count)) {
      const v = validate(raw, src.question);
      if (!v.ok) {
        skipped.push(v.why);
        continue;
      }
      wellFormed.push(v.value);
    }

    // THE SECOND GATE. Shape is not correctness — see solveBack's header for
    // the four questions that taught this function so. Nothing reaches the
    // bank without being solved again by a caller that was never told the
    // answer.
    let checkUsage: unknown = null;
    const accepted: Candidate[] = [];
    if (wellFormed.length > 0) {
      const checked = await solveBack(wellFormed, {
        subject: src.subject ?? "(unknown)",
        chapter: src.chapter ?? "(unknown)",
        classLevel: String(src.class_level ?? "(unknown)"),
      });
      checkUsage = checked.usage;
      wellFormed.forEach((c, i) => {
        const verdict = checked.verdicts[i];
        if (verdict?.ok) accepted.push(c);
        else skipped.push(verdict?.why ?? "answer check produced no verdict");
      });
    }

    const usage = {
      model_id: ai.model_id ?? null,
      source: ai.source,
      prompt_tokens: ai.usage?.prompt_tokens ?? null,
      completion_tokens: ai.usage?.completion_tokens ?? null,
      elapsed_ms: Date.now() - startedAt,
      // Named separately so a run that spent on the check and stored nothing
      // reads as what it is, rather than as a generation that produced nothing.
      answer_check: checkUsage,
    };

    if (dryRun) {
      return jsonResponse({
        dry_run: true,
        source_question_id: src.id,
        tier,
        requested: count,
        well_formed: wellFormed.length,
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
        well_formed: wellFormed.length,
      note: wellFormed.length > 0
        ? "nothing was written — every well-formed variant failed the answer check (see skipped)"
        : "nothing was written — a variant that cannot be generated is skipped, not faked (§4.2a)",
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
      well_formed: wellFormed.length,
      inserted: inserted?.length ?? 0,
      variant_ids: (inserted ?? []).map((r) => r.id),
      skipped,
      usage,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error", retryable: true }, 500);
  }
});
