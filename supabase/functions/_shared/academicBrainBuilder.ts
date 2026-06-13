/**
 * Academic Brain builder — structures deterministic data for agent consumption.
 * Agents receive summaries ONLY, never raw test dumps.
 */

import { buildAnalyticsSummaryForAgents, type SessionAnalytics } from "./analyticsEngine.ts";
import { buildMasterySummaryForAgents } from "./conceptMasteryEngine.ts";
import { buildClassificationSummaryForAgents } from "./mistakeClassificationEngine.ts";

export type AcademicBrainRecord = {
  strong_subjects?: unknown[];
  weak_subjects?: unknown[];
  strong_chapters?: unknown[];
  weak_chapters?: unknown[];
  strong_concepts?: unknown[];
  weak_concepts?: unknown[];
  mistake_history?: Record<string, unknown>;
  recovery_history?: Record<string, unknown>;
  practice_history?: Record<string, unknown>;
  speed_trend?: Record<string, unknown>;
  accuracy_trend?: Record<string, unknown>;
  consistency_trend?: Record<string, unknown>;
  mastery_snapshot?: unknown[];
  mistake_classification_trends?: Record<string, number>;
  last_session_analytics?: SessionAnalytics | Record<string, unknown>;
  recovery_completion_pct?: number;
  improvement_trend?: string;
  total_activities?: number;
};

export function buildAgentContext(
  brain: AcademicBrainRecord,
  displayName = "Student",
) {
  const masteryItems = (brain.mastery_snapshot ?? []) as {
    concept: string;
    subject: string;
    chapter?: string | null;
    mastery_score: number;
    mistake_count?: number;
  }[];

  const mistakeHist = brain.mistake_history ?? {};
  const totalMistakes = Number(mistakeHist.total_mistakes ?? 0);
  const classTrends = brain.mistake_classification_trends ?? {};

  const sessionAnalytics = brain.last_session_analytics as SessionAnalytics | undefined;
  const analyticsSummary = sessionAnalytics?.total_questions
    ? buildAnalyticsSummaryForAgents(sessionAnalytics)
    : null;

  return {
    display_name: displayName,
    improvement_trend: brain.improvement_trend ?? "steady",
    recovery_completion_pct: brain.recovery_completion_pct ?? 0,
    total_activities: brain.total_activities ?? 0,
    strong_subjects: (brain.strong_subjects ?? []).slice(0, 4),
    weak_subjects: (brain.weak_subjects ?? []).slice(0, 4),
    strong_chapters: (brain.strong_chapters ?? []).slice(0, 5),
    weak_chapters: (brain.weak_chapters ?? []).slice(0, 5),
    weak_concepts: (brain.weak_concepts ?? []).slice(0, 8),
    strong_concepts: (brain.strong_concepts ?? []).slice(0, 6),
    mastery: buildMasterySummaryForAgents(masteryItems),
    mistake_summary: {
      total: totalMistakes,
      unmastered: Number(mistakeHist.unmastered ?? 0),
      recent_7d: Number(mistakeHist.recent_7d ?? 0),
      by_subject: mistakeHist.by_subject ?? {},
    },
    recovery_summary: brain.recovery_history ?? {},
    practice_summary: brain.practice_history ?? {},
    speed_summary: brain.speed_trend ?? {},
    accuracy_summary: brain.accuracy_trend ?? {},
    consistency_summary: brain.consistency_trend ?? {},
    classification: buildClassificationSummaryForAgents(classTrends, totalMistakes),
    session_analytics: analyticsSummary,
  };
}
