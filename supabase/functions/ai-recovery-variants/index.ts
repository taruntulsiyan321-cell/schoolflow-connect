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
// EVERY VARIANT PASSES THE QUALITY GATE (TODO A2, _shared/questionGate.ts):
// none of the CBT rubric's rules broken, solved to its key by a call never told
// it, and passed by a review on every criterion of the rubric. This function
// used to run its own answer check, one batched call per generation; that check
// is the gate's now, in one home for every writer. Every variant gated is
// recorded in question_gate_outcomes, and the bank door refuses one without a
// passing review (20261148000000).
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
//
// WHERE A VARIANT IS FILED
// Through public.store_generated_questions, and nowhere else. This function
// names only the source question and the tier; the database files the variant
// under the source's topic, chapter, subject, class, board and stream, and its
// difficulty. It used to copy those columns itself — including the old
// per-question `topic`/`concept` strings — which made every generator its own
// authority on what a stored question is labelled. A variant the door skips
// (a repeat of a question already in the bank, say) is reported, not faked.
import { stripOptionLabels } from "../_shared/optionLabels.ts";
import { corsHeaders, generateStructuredWithFallback, jsonResponse } from "../_shared/structuredCompletion.ts";
import { examLabel } from "../_shared/answerCheck.ts";
import { getConfiguredModelId } from "../_shared/modelRouter.ts";
import { formOf } from "../_shared/questionForms.ts";
import { gateQuestion, tallyGate } from "../_shared/questionGate.ts";
import { rubricLines, scopeLines } from "../_shared/questionRubric.ts";
import { loadChapterScope } from "../_shared/questionWriterDb.ts";
import { completeThinking } from "../_shared/thinkingCompletion.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

/** Normalised source for generation — bank row or private upload question. */
type SourceForGeneration = {
  /** Exactly one provenance key is set (§10.3 / KI74). */
  source_question_id: string | null;
  source_upload_question_id: string | null;
  topic_id: string;
  chapter_id: string | null;
  exam_id: string | null;
  exam_code: string | null;
  board: string | null;
  class_level: number | null;
  subject: string | null;
  chapter: string | null;
  topic_name: string | null;
  difficulty: string | null;
  question: string;
  options: unknown;
  correct_index: number | null;
  explanation: string | null;
};

type BankSourceRow = {
  id: string;
  class_level: number | null;
  subject: string | null;
  chapter: string | null;
  chapter_id: string | null;
  exam_id: string | null;
  board: string | null;
  competitive_exams: { code: string } | null;
  topic_id: string | null;
  topics: { name: string } | null;
  difficulty: string | null;
  question: string;
  options: unknown;
  correct_index: number | null;
  explanation: string | null;
};

type UploadSourceRow = {
  id: string;
  question_text: string;
  options: unknown;
  correct_index: number | null;
  explanation: string | null;
  difficulty: string | null;
  answer_source: string;
  chapter_id: string | null;
  topic_id: string | null;
  chapters: {
    name: string;
    curriculum_subjects: {
      name: string;
      curriculum_classes: { level: number } | null;
    } | null;
  } | null;
  topics: { name: string } | null;
};

type StoreResult = {
  inserted: { index: number; id: string }[];
  skipped: { index: number; reason: string; existing_id?: string }[];
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

/** A variant that is well formed, before the quality gate. */
type Candidate = { question: string; options: string[]; correct_index: number; explanation: string };

/**
 * Skipped, not faked. Every reason a variant is dropped is counted and named, so
 * "we made 2 of 3" is never reported as "we made 3" and a systematically bad
 * prompt shows up as a skip reason rather than as silence.
 */
function validate(v: GeneratedVariant, original: string): { ok: true; value: Candidate } | { ok: false; why: string } {
  const q = typeof v.question === "string" ? v.question.trim() : "";
  if (q.length < 12) return { ok: false, why: "question missing or too short" };

  if (!Array.isArray(v.options)) return { ok: false, why: "options not an array" };
  // The model sometimes letters its options ("A. 12:8:5"); the app letters
  // them itself, so a stored label shows twice ("AA. 12:8:5", 2026-09-25).
  const options = stripOptionLabels(
    v.options.map((o) => (typeof o === "string" ? o.trim() : "")).filter((o) => o.length > 0),
  );
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
    const sourceQuestionId = String(body.source_question_id ?? "").trim();
    const sourceUploadQuestionId = String(body.source_upload_question_id ?? "").trim();
    const tier = Number(body.tier);
    const count = Math.max(1, Math.min(5, Number(body.count ?? 1)));
    const dryRun = body.dry_run === true;

    // KI74 / §10.3 — exactly one source. Neither and both are refusals.
    const hasBank = sourceQuestionId.length > 0;
    const hasUpload = sourceUploadQuestionId.length > 0;
    if (hasBank === hasUpload) {
      return jsonResponse({
        error: "set exactly one of source_question_id / source_upload_question_id",
      }, 400);
    }
    // 1 or 2 only — see the header. question_bank_variant_tier_check would
    // refuse anything else anyway; refusing it here says why.
    if (![1, 2].includes(tier)) {
      return jsonResponse({
        error: "tier must be 1 or 2; tier 3 comes from the bank, not from generation",
      }, 400);
    }

    let src: SourceForGeneration;

    if (hasBank) {
      const { data: row, error: srcErr } = await admin
        .from("question_bank")
        .select(
          "id, class_level, subject, chapter, chapter_id, exam_id, board, competitive_exams(code), topic_id, topics(name), difficulty, question, options, correct_index, explanation",
        )
        .eq("id", sourceQuestionId)
        .single<BankSourceRow>();

      if (srcErr || !row) {
        return jsonResponse({ error: `source question not found: ${srcErr?.message ?? "no row"}` }, 404);
      }
      if (!row.topic_id) {
        return jsonResponse({
          error: "the source question has no topic, so a variant could not be filed",
          retryable: false,
        }, 422);
      }
      src = {
        source_question_id: row.id,
        source_upload_question_id: null,
        topic_id: row.topic_id,
        chapter_id: row.chapter_id,
        exam_id: row.exam_id,
        exam_code: row.competitive_exams?.code ?? null,
        board: row.board,
        class_level: row.class_level,
        subject: row.subject,
        chapter: row.chapter,
        topic_name: row.topics?.name ?? null,
        difficulty: row.difficulty,
        question: row.question,
        options: row.options,
        correct_index: row.correct_index,
        explanation: row.explanation,
      };
    } else {
      // Private upload question — load chapter/topic labels for the prompt;
      // store_generated_questions inherits taxonomy from topic_id + provenance.
      const { data: row, error: upErr } = await admin
        .from("student_upload_questions")
        .select(
          "id, question_text, options, correct_index, explanation, difficulty, answer_source, chapter_id, topic_id, chapters(name, curriculum_subjects(name, curriculum_classes(level))), topics(name)",
        )
        .eq("id", sourceUploadQuestionId)
        .single<UploadSourceRow>();

      if (upErr || !row) {
        return jsonResponse({
          error: `upload source question not found: ${upErr?.message ?? "no row"}`,
        }, 404);
      }
      // §6.2 / §10.2.4 — AI-answered never promotes; refuse before a paid call.
      if (row.answer_source === "ai") {
        return jsonResponse({
          error: "AI-answered upload questions are not eligible for promotion (§6.2 / §10.2.4)",
          retryable: false,
        }, 422);
      }
      // §10.2.1 — no real chapter → cannot clear the promotion gate.
      if (!row.chapter_id) {
        return jsonResponse({
          error: "upload source has no chapter_id — not eligible for promotion (§10.2.1)",
          retryable: false,
        }, 422);
      }
      if (!row.topic_id) {
        return jsonResponse({
          error: "upload source has no topic_id, so a variant could not be filed",
          retryable: false,
        }, 422);
      }

      const subject = row.chapters?.curriculum_subjects?.name ?? null;
      const classLevel = row.chapters?.curriculum_subjects?.curriculum_classes?.level ?? null;

      src = {
        source_question_id: null,
        source_upload_question_id: row.id,
        topic_id: row.topic_id,
        chapter_id: row.chapter_id,
        // A private upload names no exam; the reviewer is told its class.
        exam_id: null,
        exam_code: null,
        board: null,
        class_level: classLevel,
        subject,
        chapter: row.chapters?.name ?? null,
        topic_name: row.topics?.name ?? null,
        difficulty: row.difficulty,
        question: row.question_text,
        options: row.options,
        correct_index: row.correct_index,
        explanation: row.explanation,
      };
    }

    // The chapter's official syllabus, for the writer and the review (20261149000000).
    const scope = await loadChapterScope(admin, src.exam_id, src.chapter_id);

    // §4.2a's input list — and the chapter's syllabus — and nothing beyond it.
    const originalOptions = Array.isArray(src.options) ? (src.options as unknown[]).map(String) : [];
    const correctAnswer =
      src.correct_index !== null && originalOptions[src.correct_index] !== undefined
        ? originalOptions[src.correct_index]
        : "(not recorded)";

    const system =
      "You write multiple-choice questions for Indian students — school boards (CBSE/RBSE) and " +
      "entrance exams such as CUET, on the NCERT syllabus. " +
      "You are given ONE question a student got wrong, and you produce transfer variants of it.\n\n" +
      TIER_RULES[tier] +
      "\n\nHARD RULES:\n" +
      "- Exactly 4 options, all distinct, exactly one correct.\n" +
      "- The correct answer must be genuinely derivable from the question as written.\n" +
      "- Match the difficulty of the original. §4.2: if they failed an easy question, a hard " +
      "variant teaches nothing but discouragement.\n" +
      "- Stay inside the same chapter and topic.\n" +
      "- Write the explanation so it teaches the step the student most likely missed, in under " +
      "80 words of plain text — no headings or markdown.\n" +
      "- If you cannot write a genuine variant at this tier, return fewer. Returning a reworded " +
      "copy to fill the count is worse than returning nothing.\n" +
      "- Never write an assertion–reason question — the real paper does not set them; test the " +
      "same idea as a direct or statement-based question.\n\n" +
      "Every variant is reviewed against this rubric before a student sees it, and one that fails " +
      "any criterion is thrown away:\n" +
      rubricLines();

    const user = [
      `Chapter: ${src.chapter ?? "(unknown)"}`,
      `Topic: ${src.topic_name ?? "(unknown)"}`,
      `Subject: ${src.subject ?? "(unknown)"}`,
      `Class: ${src.class_level ?? "(unknown)"}`,
      ...scopeLines(scope),
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

    // THE QUALITY GATE. Shape is not correctness, and correctness is not
    // quality: each well-formed variant is gated on its own (questionGate.ts).
    const label = examLabel({ exam_code: src.exam_code, class_level: src.class_level, board: src.board });
    const gate = { think: completeThinking, model: getConfiguredModelId() };
    const outcomes = await Promise.all(wellFormed.map((c) => gateQuestion(gate, label, {
      subject: src.subject,
      chapter: src.chapter,
      topic: src.topic_name,
      form: formOf(c.question, c.options),
      question: c.question,
      options: c.options,
      correctIndex: c.correct_index,
      scope,
    })));
    const accepted = wellFormed.flatMap((c, i) => {
      const o = outcomes[i];
      if (o.kept) return [{ ...c, review: o.review, at: i }];
      skipped.push(`${o.stage}: ${o.reason}`);
      return [];
    });

    /** The gate's record: every variant it saw, kept or refused, and the bank row a kept one became. */
    const record = async (storedAs: Map<number, string>) => {
      if (outcomes.length === 0) return;
      const { error } = await admin.from("question_gate_outcomes").insert(outcomes.map((o, i) => ({
        writer: src.source_question_id ? "recovery_variant" : "upload_variant",
        ref: src.source_question_id ?? src.source_upload_question_id,
        exam_id: src.exam_id,
        subject: src.subject,
        chapter_id: src.chapter_id,
        topic_id: src.topic_id,
        form: formOf(wellFormed[i].question, wellFormed[i].options),
        question: wellFormed[i].question,
        options: wellFormed[i].options,
        correct_index: wellFormed[i].correct_index,
        stage: o.kept ? "kept" : o.stage,
        reason: o.kept ? null : o.reason,
        failed: o.kept ? [] : o.failed,
        review: o.review,
        question_id: storedAs.get(i) ?? null,
      })));
      if (error) console.error("ai-recovery-variants: gate record failed:", error.message);
    };

    const usage = {
      model_id: ai.model_id ?? null,
      source: ai.source,
      prompt_tokens: ai.usage?.prompt_tokens ?? null,
      completion_tokens: ai.usage?.completion_tokens ?? null,
      elapsed_ms: Date.now() - startedAt,
      // Named separately so a run that spent on the gate and stored nothing
      // reads as what it is, rather than as a generation that produced nothing.
      gate: tallyGate(outcomes),
    };

    const provenance = {
      source_question_id: src.source_question_id,
      source_upload_question_id: src.source_upload_question_id,
    };

    if (dryRun) {
      await record(new Map());
      return jsonResponse({
        dry_run: true,
        ...provenance,
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
      await record(new Map());
      return jsonResponse({
        ...provenance,
        tier,
        requested: count,
        inserted: 0,
        skipped,
        usage,
        well_formed: wellFormed.length,
        note: wellFormed.length > 0
          ? "nothing was written — every well-formed variant failed the quality gate (see skipped)"
          : "nothing was written — a variant that cannot be generated is skipped, not faked (§4.2a)",
      });
    }

    // Only what this function actually knows. Topic, chapter, subject, class,
    // board, stream and difficulty (§4.2: variants mirror what was failed) are
    // inherited from the source by the database; approval and activity are the
    // door's rule, per the header. Upload provenance leaves source_question_id null.
    const rows = accepted.map((v) => ({
      ...(src.source_question_id
        ? { source_question_id: src.source_question_id }
        : { source_upload_question_id: src.source_upload_question_id }),
      variant_tier: tier,
      question: v.question,
      question_format: "mcq",
      options: v.options,
      correct_index: v.correct_index,
      explanation: v.explanation,
      source: "ai_recovery_variant",
      quality_review: v.review,
    }));

    const { data: stored, error: storeErr } = await admin.rpc("store_generated_questions", {
      _questions: rows,
    });

    if (storeErr) {
      await record(new Map());
      return jsonResponse({ error: `store failed: ${storeErr.message}`, retryable: true }, 500);
    }

    const result = stored as StoreResult;
    for (const s of result.skipped ?? []) skipped.push(`not stored: ${s.reason}`);
    await record(new Map((result.inserted ?? []).map((r) => [accepted[r.index].at, r.id] as const)));

    return jsonResponse({
      ...provenance,
      tier,
      requested: count,
      well_formed: wellFormed.length,
      inserted: result.inserted?.length ?? 0,
      variant_ids: (result.inserted ?? []).map((r) => r.id),
      topic_id: src.topic_id,
      skipped,
      usage,
    });
  } catch (err) {
    return jsonResponse({ error: (err as Error).message ?? "Unknown error", retryable: true }, 500);
  }
});
