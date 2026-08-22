/**
 * Concept Mastery Engine — deterministic 0-100 scoring. NEVER uses AI.
 */

/** Compact mastery summary for agents. */
export function buildMasterySummaryForAgents(
  items: {
    concept: string;
    subject: string;
    chapter?: string | null;
    mastery_score: number;
    mistake_count?: number;
  }[],
) {
  const weak = items.filter((m) => m.mastery_score < 60).slice(0, 8);
  const strong = items.filter((m) => m.mastery_score >= 75).slice(0, 6);
  const avg = items.length
    ? Math.round(items.reduce((s, m) => s + m.mastery_score, 0) / items.length)
    : 0;
  return { avg_mastery: avg, weak_concepts: weak, strong_concepts: strong, total_tracked: items.length };
}
