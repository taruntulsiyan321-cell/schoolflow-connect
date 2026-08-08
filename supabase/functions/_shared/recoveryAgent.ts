import { generateStructuredWithFallback, jsonResponse } from "./structuredCompletion.ts";
import { buildAgentContext, type AcademicBrainRecord } from "./academicBrainBuilder.ts";

export async function handleRecoveryAgentRequest(body: Record<string, unknown>): Promise<Response> {
  const brain = (body.academic_brain ?? body.brain ?? {}) as AcademicBrainRecord;
  const displayName = (body.display_name as string) ?? "Student";
  const ctx = buildAgentContext(brain, displayName);

  const weak = ctx.weak_concepts as { concept: string; subject: string; chapter?: string; mastery_score?: number }[];

  if (!weak.length) {
    return jsonResponse({
      headline: "No recovery needed right now",
      plan: [],
      total_questions: 0,
      focus_message: "Keep practicing — recovery plans appear when weak concepts are detected.",
      source: "rule",
    });
  }

  const system =
    "You are a Recovery Planning specialist for Indian school students. " +
    "Your ONLY job: create a recovery plan with question counts per weak concept. " +
    "All mastery scores and mistake counts are pre-computed — do NOT recalculate. " +
    "Assign 5-15 questions per concept based on severity (lower mastery = more questions).";

  const user = [
    `Student: ${ctx.display_name}`,
    `Recovery completion: ${ctx.recovery_completion_pct}%`,
    `Open recovery assignments: ${(ctx.recovery_summary as Record<string, unknown>).open ?? 0}`,
    `Weak concepts (pre-computed): ${JSON.stringify(weak.slice(0, 8))}`,
    `Mistake frequency by subject: ${JSON.stringify(ctx.mistake_summary.by_subject)}`,
    `Dominant error type: ${ctx.classification.dominant_error_type}`,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      headline: { type: "string" },
      focus_message: { type: "string" },
      plan: {
        type: "array",
        items: {
          type: "object",
          properties: {
            concept: { type: "string" },
            subject: { type: "string" },
            chapter: { type: "string" },
            question_count: { type: "number" },
            priority: { type: "number" },
            rationale: { type: "string" },
          },
          required: ["concept", "subject", "question_count", "priority", "rationale"],
        },
      },
      total_questions: { type: "number" },
    },
    required: ["headline", "plan", "total_questions", "focus_message"],
  };

  const result = await generateStructuredWithFallback<{
    headline: string;
    focus_message: string;
    plan: { concept: string; subject: string; chapter?: string; question_count: number; priority: number; rationale: string }[];
    total_questions: number;
  }>({ system, user, schema, toolName: "emit_recovery_plan" });

  if (!result.ok) {
    return jsonResponse(buildRuleRecoveryPlan(ctx, weak), 200);
  }

  return jsonResponse({ ...result.data, source: "coach" });
}

function buildRuleRecoveryPlan(
  ctx: ReturnType<typeof buildAgentContext>,
  weak: { concept: string; subject: string; chapter?: string; mastery_score?: number }[],
) {
  const plan = weak.slice(0, 6).map((w, i) => {
    const mastery = w.mastery_score ?? 40;
    const qCount = mastery < 35 ? 12 : mastery < 50 ? 8 : 5;
    return {
      concept: w.concept,
      subject: w.subject,
      chapter: w.chapter ?? "",
      question_count: qCount,
      priority: 90 - i * 10,
      rationale: `${Math.round(mastery)}% mastery — targeted practice needed.`,
    };
  });
  const total = plan.reduce((s, p) => s + p.question_count, 0);
  return {
    headline: `Recovery plan: ${plan.length} concepts`,
    focus_message: `Start with "${plan[0]?.concept}" — ${plan[0]?.question_count} questions.`,
    plan,
    total_questions: total,
    source: "rule",
  };
}
