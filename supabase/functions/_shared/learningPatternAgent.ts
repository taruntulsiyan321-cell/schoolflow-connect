import { generateStructuredWithFallback, jsonResponse } from "./structuredCompletion.ts";
import { buildAgentContext, type AcademicBrainRecord } from "./academicBrainBuilder.ts";

export async function handleLearningPatternRequest(body: Record<string, unknown>): Promise<Response> {
  const brain = (body.academic_brain ?? body.brain ?? {}) as AcademicBrainRecord;
  const displayName = (body.display_name as string) ?? "Student";
  const ctx = buildAgentContext(brain, displayName);

  if (!ctx.weak_concepts?.length && !ctx.mastery.total_tracked) {
    return jsonResponse({
      patterns: [],
      headline: "Complete practice to unlock learning patterns",
      insights: ["Your learning style profile builds after a few practice sessions."],
      source: "rule",
    });
  }

  const system =
    "You are a Learning Pattern Analyst for Indian school students (CBSE/NCERT). " +
    "Your ONLY job: identify learning patterns from structured metrics — NOT to compute scores or accuracy. " +
    "All numbers are pre-computed. Never recalculate metrics. " +
    "Focus on: formula-based strength, multi-concept struggle, speed-accuracy tradeoffs, consistency patterns.";

  const user = [
    `Student: ${ctx.display_name}`,
    `Improvement trend: ${ctx.improvement_trend}`,
    `Avg mastery: ${ctx.mastery.avg_mastery}%`,
    `Weak concepts (pre-computed): ${JSON.stringify(ctx.weak_concepts.slice(0, 6))}`,
    `Strong concepts: ${JSON.stringify(ctx.strong_concepts.slice(0, 4))}`,
    `Mistake classification breakdown: ${JSON.stringify(ctx.classification.breakdown)}`,
    `Speed: ${JSON.stringify(ctx.speed_summary)}`,
    `Accuracy trend: ${JSON.stringify(ctx.accuracy_summary)}`,
    `Practice sessions: ${JSON.stringify(ctx.practice_summary)}`,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      headline: { type: "string" },
      patterns: {
        type: "array",
        items: {
          type: "object",
          properties: {
            label: { type: "string" },
            description: { type: "string" },
            evidence: { type: "string" },
          },
          required: ["label", "description"],
        },
      },
      insights: { type: "array", items: { type: "string" } },
    },
    required: ["headline", "patterns", "insights"],
  };

  const result = await generateStructuredWithFallback<{
    headline: string;
    patterns: { label: string; description: string; evidence?: string }[];
    insights: string[];
  }>({ system, user, schema, toolName: "emit_learning_patterns" });

  if (!result.ok) {
    return jsonResponse(buildRuleLearningPatterns(ctx), 200);
  }

  return jsonResponse({ ...result.data, source: "coach" });
}

function buildRuleLearningPatterns(ctx: ReturnType<typeof buildAgentContext>) {
  const patterns: { label: string; description: string; evidence?: string }[] = [];
  const dominant = ctx.classification.dominant_error_type;

  if (dominant === "concept_error") {
    patterns.push({
      label: "Conceptual gaps",
      description: "Mistakes cluster around fundamental understanding — revisit NCERT theory before more practice.",
      evidence: `${ctx.classification.breakdown[0]?.pct ?? 0}% concept errors`,
    });
  } else if (dominant === "calculation_error") {
    patterns.push({
      label: "Formula application strength",
      description: "You understand concepts but slip on calculations — slow down and show each step.",
      evidence: "Calculation errors dominate",
    });
  } else if (dominant === "time_pressure_error") {
    patterns.push({
      label: "Speed-accuracy tradeoff",
      description: "Fast answers lead to errors — practice timed sets only after accuracy is solid.",
      evidence: "Time pressure errors detected",
    });
  }

  if ((ctx.weak_concepts as unknown[]).length >= 3) {
    patterns.push({
      label: "Multi-concept struggle",
      description: "Weakness spans several concepts — tackle one at a time with focused recovery.",
    });
  }

  return {
    headline: patterns.length ? patterns[0].label : "Building your learning profile",
    patterns,
    insights: patterns.map((p) => p.description),
    source: "rule",
  };
}
