/**
 * Frozen Practice Analysis payload — saved with the session so reopen
 * shows the same summary without regenerating analysis.
 */
export type PracticeAnalysisSnapshot = {
  version: 1;
  subject: string;
  chapter: string;
  practiceMode: string | null;
  practiceTypeLabel: string;
  difficulty: string | null;
  questionCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  accuracy: number;
  xpEarned: number;
  totalTimeMs: number | null;
  finishedAt: string | null;
  startedAt: string | null;
  /** Attempt-level review for identical reopen when DB attempts are sparse */
  attempts?: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    selectedIndex: number;
    isCorrect: boolean;
    skipped?: boolean;
    explanation?: string;
  }>;
  insights?: {
    headline?: string;
    bullets?: string[];
    recommendations?: string[];
  };
  statistics?: {
    avgSecPerQuestion?: number | null;
    bookmarked?: number;
  };
};

export function buildPracticeAnalysisSnapshot(input: {
  subject: string;
  chapter: string;
  practiceMode?: string | null;
  practiceTypeLabel?: string;
  difficulty?: string | null;
  questionCount: number;
  correctCount: number;
  wrongCount?: number;
  skippedCount?: number;
  accuracy?: number | null;
  xpEarned?: number;
  totalTimeMs?: number | null;
  finishedAt?: string | null;
  startedAt?: string | null;
  attempts?: PracticeAnalysisSnapshot["attempts"];
  bookmarked?: number;
}): PracticeAnalysisSnapshot {
  const questionCount = Math.max(0, input.questionCount);
  const correctCount = Math.max(0, input.correctCount);
  const skippedCount = Math.max(0, input.skippedCount ?? 0);
  const wrongCount =
    input.wrongCount ?? Math.max(0, questionCount - correctCount - skippedCount);
  const accuracy =
    typeof input.accuracy === "number"
      ? input.accuracy
      : questionCount > 0
        ? Math.round((correctCount / questionCount) * 100)
        : 0;
  const avgSec =
    input.totalTimeMs && questionCount > 0
      ? Math.round(input.totalTimeMs / questionCount / 1000)
      : null;

  const recommendations: string[] = [];
  if (accuracy < 60) {
    recommendations.push("Review wrong answers in Mistake Book before your next session.");
  }
  if (accuracy < 80) {
    recommendations.push("Revise weak topics from Analysis, then retry this chapter.");
  }
  if (skippedCount > 0) {
    recommendations.push(`Revisit ${skippedCount} skipped question${skippedCount === 1 ? "" : "s"} in Skipped Practice.`);
  }
  if (recommendations.length === 0) {
    recommendations.push("Strong session — keep the streak with a short daily practice.");
  }

  return {
    version: 1,
    subject: input.subject,
    chapter: input.chapter,
    practiceMode: input.practiceMode ?? null,
    practiceTypeLabel: input.practiceTypeLabel ?? "Practice",
    difficulty: input.difficulty ?? null,
    questionCount,
    correctCount,
    wrongCount,
    skippedCount,
    accuracy,
    xpEarned: input.xpEarned ?? correctCount * 10,
    totalTimeMs: input.totalTimeMs ?? null,
    finishedAt: input.finishedAt ?? null,
    startedAt: input.startedAt ?? null,
    attempts: input.attempts,
    insights: {
      headline:
        accuracy >= 80
          ? "Solid performance — concepts are sticking."
          : accuracy >= 60
            ? "Progressing — tighten weak spots next."
            : "Needs recovery focus on missed concepts.",
      bullets: [
        `${correctCount}/${questionCount} correct (${accuracy}%)`,
        wrongCount > 0 ? `${wrongCount} incorrect` : "No incorrect answers",
        skippedCount > 0 ? `${skippedCount} skipped` : "No skips",
      ],
      recommendations,
    },
    statistics: {
      avgSecPerQuestion: avgSec,
      bookmarked: input.bookmarked ?? 0,
    },
  };
}
