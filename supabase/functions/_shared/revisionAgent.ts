import { generateStructuredWithFallback, jsonResponse } from "./gemini.ts";
import { buildAgentContext, type AcademicBrainRecord } from "./academicBrainBuilder.ts";

const MODELS = ["gemini-2.5-flash", "gemini-2.0-flash", "gemini-2.5-flash-lite"];

export async function handleRevisionAgentRequest(body: Record<string, unknown>): Promise<Response> {
  const brain = (body.academic_brain ?? body.brain ?? {}) as AcademicBrainRecord;
  const displayName = (body.display_name as string) ?? "Student";
  const revisionPlan = (body.revision_plan ?? {}) as Record<string, unknown>;
  const ctx = buildAgentContext(brain, displayName);

  const queueItems = (revisionPlan.queue_items ?? []) as {
    subject: string; chapter?: string; topic?: string; priority: number; reason?: string;
  }[];
  const brainPriorities = (revisionPlan.brain_priorities ?? []) as {
    concept: string; subject: string; priority: number; action?: string;
  }[];

  if (!queueItems.length && !brainPriorities.length && !ctx.weak_concepts?.length) {
    return jsonResponse({
      headline: "Revision queue is clear",
      today_plan: [],
      total_minutes: 0,
      priority_note: "Complete practice or DPPs to populate your revision plan.",
      source: "rule",
    });
  }

  const system =
    "You are a Revision Planning specialist for Indian school students (CBSE/NCERT). " +
    "Your ONLY job: create today's revision plan with priorities from structured data. " +
    "Do NOT invent random topics. Use only the provided queue items and weak concepts. " +
    "Do NOT recalculate any metrics.";

  const user = [
    `Student: ${ctx.display_name}`,
    `Improvement trend: ${ctx.improvement_trend}`,
    `Revision queue (pre-computed): ${JSON.stringify(queueItems.slice(0, 10))}`,
    `Brain priorities: ${JSON.stringify(brainPriorities.slice(0, 8))}`,
    `Weak concepts: ${JSON.stringify((ctx.weak_concepts as unknown[]).slice(0, 6))}`,
    `Mistake history summary: total=${ctx.mistake_summary.total}, recent_7d=${ctx.mistake_summary.recent_7d}`,
    `Recovery completion: ${ctx.recovery_completion_pct}%`,
  ].join("\n");

  const schema = {
    type: "object",
    properties: {
      headline: { type: "string" },
      priority_note: { type: "string" },
      total_minutes: { type: "number" },
      today_plan: {
        type: "array",
        items: {
          type: "object",
          properties: {
            topic: { type: "string" },
            subject: { type: "string" },
            chapter: { type: "string" },
            time_minutes: { type: "number" },
            action: { type: "string" },
            priority: { type: "number" },
            reason: { type: "string" },
          },
          required: ["topic", "subject", "time_minutes", "action", "priority"],
        },
      },
    },
    required: ["headline", "today_plan", "total_minutes", "priority_note"],
  };

  const result = await generateStructuredWithFallback<{
    headline: string;
    priority_note: string;
    total_minutes: number;
    today_plan: { topic: string; subject: string; chapter?: string; time_minutes: number; action: string; priority: number; reason?: string }[];
  }>({ system, user, schema, toolName: "emit_revision_plan" }, { models: MODELS });

  if (!result.ok) {
    return jsonResponse(buildRuleRevisionPlan(ctx, queueItems, brainPriorities), 200);
  }

  return jsonResponse({ ...result.data, source: "coach" });
}

function buildRuleRevisionPlan(
  ctx: ReturnType<typeof buildAgentContext>,
  queueItems: { subject: string; chapter?: string; topic?: string; priority: number; reason?: string }[],
  brainPriorities: { concept: string; subject: string; priority: number; action?: string }[],
) {
  const today_plan: { topic: string; subject: string; chapter?: string; time_minutes: number; action: string; priority: number; reason?: string }[] = [];

  for (const item of queueItems.slice(0, 4)) {
    today_plan.push({
      topic: item.topic ?? item.chapter ?? item.subject,
      subject: item.subject,
      chapter: item.chapter,
      time_minutes: item.priority >= 80 ? 25 : 15,
      action: "Revise NCERT section + attempt 3 similar questions",
      priority: item.priority,
      reason: item.reason,
    });
  }

  for (const bp of brainPriorities.slice(0, 3)) {
    if (today_plan.length >= 6) break;
    today_plan.push({
      topic: bp.concept,
      subject: bp.subject,
      time_minutes: 20,
      action: bp.action ?? "Review concept notes + practice",
      priority: bp.priority,
      reason: "Weak concept from academic profile",
    });
  }

  const total_minutes = today_plan.reduce((s, p) => s + p.time_minutes, 0);
  return {
    headline: today_plan.length ? `Today's revision: ${today_plan.length} topics` : "No revision scheduled",
    priority_note: "Prioritized from mistake history, recovery gaps, and weak concepts.",
    today_plan,
    total_minutes,
    source: "rule",
  };
}
