/**
 * Multi-Agent Academic Intelligence Orchestrator.
 * Flow: Brain → Learning Pattern → Recovery → Revision → Coach
 * Each agent has ONE responsibility. Deterministic metrics come from brain/RPCs only.
 */

import { invokeEdgeFunction } from "@/lib/edgeFunction";
import {
  buildAgentPayload,
  cacheAgentInsight,
  fetchAcademicBrain,
  fetchRevisionPlan,
  getCachedAgentInsight,
  type AcademicBrain,
  type RevisionPlanPayload,
} from "@/lib/academicBrain";

export type LearningPatternInsight = {
  headline: string;
  patterns: { label: string; description: string; evidence?: string }[];
  insights: string[];
  source: "coach" | "rule";
};

export type RecoveryPlanInsight = {
  headline: string;
  focus_message: string;
  plan: {
    concept: string;
    subject: string;
    chapter?: string;
    question_count: number;
    priority: number;
    rationale: string;
  }[];
  total_questions: number;
  source: "coach" | "rule";
};

export type RevisionPlanInsight = {
  headline: string;
  priority_note: string;
  total_minutes: number;
  today_plan: {
    topic: string;
    subject: string;
    chapter?: string;
    time_minutes: number;
    action: string;
    priority: number;
    reason?: string;
  }[];
  source: "coach" | "rule";
};

export type CoachReport = {
  headline: string;
  summary: string;
  today_focus: string;
  diagnosis?: string;
  next_steps: string[];
  encouragement?: string;
  source: "coach" | "rule";
};

export type AcademicIntelligenceBundle = {
  brain: AcademicBrain;
  learningPatterns: LearningPatternInsight | null;
  recoveryPlan: RecoveryPlanInsight | null;
  revisionPlan: RevisionPlanInsight | null;
  coachReport: CoachReport | null;
  revisionQueue: RevisionPlanPayload | null;
};

async function invokeAgent<T extends Record<string, unknown>>(
  name: string,
  body: Record<string, unknown>,
): Promise<T | null> {
  const { data, error } = await invokeEdgeFunction<T>(name, body);
  if (error || !data) {
    console.warn(`${name} unavailable:`, error);
    return null;
  }
  return data;
}

export async function runLearningPatternAgent(
  brain: AcademicBrain,
  displayName?: string,
): Promise<LearningPatternInsight> {
  const cached = await getCachedAgentInsight("learning_pattern");
  if (cached?.headline) return cached as unknown as LearningPatternInsight;

  const payload = buildAgentPayload(brain, displayName);
  const result = await invokeAgent<LearningPatternInsight>("ai-learning-pattern-agent", payload);
  const insight = result ?? {
    headline: "Building your learning profile",
    patterns: [],
    insights: ["Complete practice to unlock learning patterns."],
    source: "rule" as const,
  };
  await cacheAgentInsight("learning_pattern", insight, insight.source === "coach" ? "coach" : "rule");
  return insight;
}

export async function runRecoveryAgent(
  brain: AcademicBrain,
  displayName?: string,
): Promise<RecoveryPlanInsight> {
  const cached = await getCachedAgentInsight("recovery");
  if (cached?.headline) return cached as unknown as RecoveryPlanInsight;

  const payload = buildAgentPayload(brain, displayName);
  const result = await invokeAgent<RecoveryPlanInsight>("ai-recovery-agent", payload);
  const insight = result ?? {
    headline: "No recovery needed",
    focus_message: "Keep practicing.",
    plan: [],
    total_questions: 0,
    source: "rule" as const,
  };
  await cacheAgentInsight("recovery", insight, insight.source === "coach" ? "coach" : "rule");
  return insight;
}

export async function runRevisionAgent(
  brain: AcademicBrain,
  revisionQueue: RevisionPlanPayload,
  displayName?: string,
): Promise<RevisionPlanInsight> {
  const cached = await getCachedAgentInsight("revision");
  if (cached?.headline) return cached as unknown as RevisionPlanInsight;

  const payload = {
    ...buildAgentPayload(brain, displayName),
    revision_plan: revisionQueue,
  };
  const result = await invokeAgent<RevisionPlanInsight>("ai-revision-agent", payload);
  const insight = result ?? {
    headline: "Revision queue ready",
    priority_note: revisionQueue.sort_note,
    total_minutes: 0,
    today_plan: [],
    source: "rule" as const,
  };
  await cacheAgentInsight("revision", insight, insight.source === "coach" ? "coach" : "rule");
  return insight;
}

export async function runAcademicCoachAgent(
  brain: AcademicBrain,
  learningPatterns: LearningPatternInsight,
  recoveryPlan: RecoveryPlanInsight,
  revisionPlan: RevisionPlanInsight,
  displayName?: string,
): Promise<CoachReport> {
  const cached = await getCachedAgentInsight("coach");
  if (cached?.headline) return cached as unknown as CoachReport;

  const payload = {
    ...buildAgentPayload(brain, displayName),
    learning_patterns: learningPatterns,
    recovery_plan: recoveryPlan,
    revision_plan: revisionPlan,
  };
  const result = await invokeAgent<CoachReport>("ai-academic-coach-agent", payload);
  const insight = result ?? {
    headline: learningPatterns.headline,
    summary: recoveryPlan.focus_message,
    today_focus: revisionPlan.today_plan[0]?.action ?? "Start practice today.",
    next_steps: [
      recoveryPlan.focus_message,
      revisionPlan.priority_note,
      ...learningPatterns.insights.slice(0, 2),
    ].filter(Boolean),
    source: "rule" as const,
  };
  await cacheAgentInsight("coach", insight, insight.source === "coach" ? "coach" : "rule");
  return insight;
}

/** Full pipeline: deterministic brain first, then each specialist agent sequentially. */
export async function runAcademicIntelligencePipeline(
  displayName?: string,
): Promise<AcademicIntelligenceBundle> {
  const [brain, revisionQueue] = await Promise.all([
    fetchAcademicBrain(),
    fetchRevisionPlan(),
  ]);

  const learningPatterns = await runLearningPatternAgent(brain, displayName);
  const recoveryPlan = await runRecoveryAgent(brain, displayName);
  const revisionPlan = await runRevisionAgent(brain, revisionQueue, displayName);
  const coachReport = await runAcademicCoachAgent(
    brain,
    learningPatterns,
    recoveryPlan,
    revisionPlan,
    displayName,
  );

  return {
    brain,
    learningPatterns,
    recoveryPlan,
    revisionPlan,
    coachReport,
    revisionQueue,
  };
}
