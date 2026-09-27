/**
 * Deterministic Analytics Engine — NEVER uses AI.
 * Computes score, accuracy, timing, strong/weak chapters & concepts.
 */

export type SessionAnalytics = {
  score: number;
  accuracy: number;
  time_taken_ms: number;
  avg_time_per_question_ms: number;
  total_questions: number;
  correct: number;
  wrong: number;
  skipped: number;
  strong_chapters: { chapter: string; subject: string }[];
  weak_chapters: { chapter: string; subject: string }[];
  strong_concepts: { concept: string; subject: string; chapter?: string | null }[];
  weak_concepts: { concept: string; subject: string; chapter?: string | null }[];
  computed_at: string;
};



/** Build compact structured summary for AI agents — no raw question dumps. */
export function buildAnalyticsSummaryForAgents(analytics: SessionAnalytics) {
  return {
    score: analytics.score,
    accuracy_pct: analytics.accuracy,
    avg_time_per_question_ms: analytics.avg_time_per_question_ms,
    totals: {
      questions: analytics.total_questions,
      correct: analytics.correct,
      wrong: analytics.wrong,
      skipped: analytics.skipped,
    },
    strong_chapters: analytics.strong_chapters.slice(0, 5),
    weak_chapters: analytics.weak_chapters.slice(0, 5),
    strong_concepts: analytics.strong_concepts.slice(0, 6),
    weak_concepts: analytics.weak_concepts.slice(0, 6),
  };
}
