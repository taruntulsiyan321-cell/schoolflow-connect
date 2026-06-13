import { generateStructuredWithFallback, jsonResponse } from "./gemini.ts";
import { buildAgentContext, type AcademicBrainRecord } from "./academicBrainBuilder.ts";

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];

export async function handleAcademicCoachRequest(body: Record<string, unknown>): Promise<Response> {
  const brain = (body.academic_brain ?? body.brain ?? {}) as AcademicBrainRecord;
  const displayName = (body.display_name as string) ?? "Student";
  const learningPatterns = (body.learning_patterns ?? {}) as Record<string, unknown>;
  const recoveryPlan = (body.recovery_plan ?? {}) as Record<string, unknown>;
  const revisionPlan = (body.revision_plan ?? {}) as Record<string, unknown>;
  const ctx = buildAgentContext(brain, displayName);

  const system =
    "You are an Academic Coach for Indian school students (CBSE/NCERT). " +
    "Your ONLY job: write a concise, actionable coaching report synthesizing pre-computed analytics, " +
    "learning patterns, recovery plan, and revision plan. " +
    "NEVER recalculate scores, accuracy, or mastery — all metrics are provided. " +
    "Be encouraging, specific, and actionable. No jargon. Max 3-4 sentences per section.";

  const user = [
    `Student: ${ctx.display_name}`,
    `=== Pre-computed Analytics ===`,
    `Improvement trend: ${ctx.improvement_trend}`,
    `Recovery completion: ${ctx.recovery_completion_pct}%`,
    `Session analytics: ${JSON.stringify(ctx.session_analytics)}`,
    `Mastery summary: ${JSON.stringify(ctx.mastery)}`,
    `Mistake summary: ${JSON.stringify(ctx.mistake_summary)}`,
    `=== Learning Patterns (from specialist) ===`,
    JSON.stringify(learningPatterns),
    `=== Recovery Plan (from specialist) ===`,
    JSON.stringify(recoveryPlan),
    `=== Revision Plan (from specialist) ===`,
    JSON.stringify(revisionPlan),
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      headline: { type: "string" },
      summary: { type: "string" },
      today_focus: { type: "string" },
      diagnosis: { type: "string" },
      next_steps: { type: "array", items: { type: "string" } },
      encouragement: { type: "string" },
    },
    required: ["headline", "summary", "today_focus", "next_steps"],
  };

  const result = await generateStructuredWithFallback<{
    headline: string;
    summary: string;
    today_focus: string;
    diagnosis?: string;
    next_steps: string[];
    encouragement?: string;
  }>({ system, user, schema, toolName: "emit_coach_report" }, { models: MODELS });

  if (!result.ok) {
    return jsonResponse(buildRuleCoachReport(ctx, learningPatterns, recoveryPlan, revisionPlan), 200);
  }

  return jsonResponse({ ...result.data, source: "coach" });
}

function buildRuleCoachReport(
  ctx: ReturnType<typeof buildAgentContext>,
  learningPatterns: Record<string, unknown>,
  recoveryPlan: Record<string, unknown>,
  revisionPlan: Record<string, unknown>,
) {
  const weak = (ctx.weak_concepts as { concept: string }[]) ?? [];
  const topWeak = weak[0]?.concept;
  const recoveryHeadline = String(recoveryPlan.headline ?? "");
  const revisionHeadline = String(revisionPlan.headline ?? "");
  const patternHeadline = String(learningPatterns.headline ?? "");

  const headline = topWeak
    ? `Focus on "${topWeak}" this week`
    : "Your academic profile is building";

  const todayFocus = revisionPlan.today_plan
    ? revisionHeadline
    : topWeak
      ? `Spend 20 min on ${topWeak} — review NCERT then fix mistakes in Recovery.`
      : "Start a 15-minute practice session.";

  const next_steps: string[] = [];
  if (recoveryHeadline) next_steps.push(recoveryHeadline);
  if (revisionHeadline) next_steps.push(revisionHeadline);
  if (patternHeadline) next_steps.push(patternHeadline);
  if (!next_steps.length) next_steps.push("Complete practice to unlock personalised coaching.");

  return {
    headline,
    summary: `Tracked ${ctx.mastery.total_tracked} concepts. Trend: ${ctx.improvement_trend}. Recovery: ${ctx.recovery_completion_pct}% complete.`,
    today_focus: todayFocus,
    diagnosis: topWeak
      ? `Weakness detected in ${topWeak} and ${Math.max(0, weak.length - 1)} other concepts.`
      : "",
    next_steps: next_steps.slice(0, 4),
    encouragement: ctx.improvement_trend === "improving"
      ? "You're on an upward trend — keep the momentum!"
      : "Small daily fixes beat cramming. You've got this.",
    source: "rule",
  };
}
