import { ACCURACY_BUILDING, ACCURACY_PROCEDURAL } from "@/academic/metrics/bands";

/**
 * The analysis frozen onto a practice session when the student saves it, so
 * a Saved Session reopens exactly as it was.
 *
 * Built in ONE place — PracticeService.saveSession — from the finished
 * session row and its recorded attempts, which are what the server graded and
 * rolled up. Screens used to build it themselves from whatever they held: the
 * result page froze its local copy and a hard "Practice" type label, the hub's
 * "Save latest result" froze no questions at all.
 *
 * No type label is stored: the label is a function of practice_mode
 * (practiceModeLabel), so a stored copy could only ever disagree with it.
 */
export type PracticeAnalysisSnapshot = {
  version: 2;
  subject: string;
  chapter: string;
  practiceMode: string | null;
  difficulty: string | null;
  questionCount: number;
  correctCount: number;
  wrongCount: number;
  skippedCount: number;
  /** correct ÷ answered (20261021000000); null when nothing was answered. */
  accuracy: number | null;
  xpEarned: number;
  totalTimeMs: number | null;
  finishedAt: string | null;
  startedAt: string | null;
  attempts: Array<{
    question: string;
    options: string[];
    correctIndex: number;
    /** -1 when the question was skipped. */
    selectedIndex: number;
    isCorrect: boolean;
    skipped: boolean;
    explanation?: string;
  }>;
  insights: {
    headline: string;
    bullets: string[];
    recommendations: string[];
  };
  statistics: {
    avgSecPerQuestion: number | null;
  };
};

/** The practice_sessions columns the snapshot freezes. */
export type PracticeSessionRecord = {
  subject: string | null;
  chapter: string | null;
  practice_mode?: string | null;
  difficulty?: string | null;
  question_count: number | null;
  correct_count: number | null;
  wrong_count?: number | null;
  skipped_count?: number | null;
  accuracy?: number | string | null;
  xp_earned?: number | null;
  total_time_ms?: number | null;
  finished_at: string | null;
  created_at: string | null;
};

/** One question_attempts row, as the server stored it. */
export type PracticeAttemptRecord = {
  generated_question: unknown;
  selected_answer: unknown;
  correct_answer: unknown;
  is_correct: boolean | null;
  skipped?: boolean | null;
};

function asObject(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function asIndex(o: Record<string, unknown>, ...keys: string[]): number | null {
  for (const k of keys) {
    const n = o[k];
    if (typeof n === "number" && Number.isInteger(n)) return n;
  }
  return null;
}

function asOptions(raw: unknown): string[] {
  if (Array.isArray(raw)) return raw.map(String);
  if (typeof raw === "string") {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed.map(String);
    } catch { /* not JSON — no options */ }
  }
  return [];
}

function count(n: number | null | undefined): number {
  return typeof n === "number" && Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

export function buildPracticeAnalysisSnapshot(
  session: PracticeSessionRecord,
  records: PracticeAttemptRecord[],
): PracticeAnalysisSnapshot {
  const questionCount = count(session.question_count);
  const correctCount = count(session.correct_count);
  const skippedCount = count(session.skipped_count);
  const wrongCount =
    session.wrong_count != null
      ? count(session.wrong_count)
      : Math.max(0, questionCount - correctCount - skippedCount);
  const accuracyRaw = session.accuracy == null ? null : Number(session.accuracy);
  const accuracy = accuracyRaw != null && Number.isFinite(accuracyRaw) ? Math.round(accuracyRaw) : null;
  const totalTimeMs = typeof session.total_time_ms === "number" && session.total_time_ms > 0
    ? session.total_time_ms
    : null;

  const attempts = records.map((r) => {
    const gq = asObject(r.generated_question);
    const skipped = Boolean(r.skipped);
    const explanation = typeof gq.explanation === "string" && gq.explanation.trim() ? gq.explanation : undefined;
    return {
      question: typeof gq.question === "string" ? gq.question : "",
      options: asOptions(gq.options),
      correctIndex: asIndex(asObject(r.correct_answer), "index", "correct_index") ?? -1,
      selectedIndex: skipped ? -1 : asIndex(asObject(r.selected_answer), "index", "selected_index") ?? -1,
      isCorrect: !skipped && r.is_correct === true,
      skipped,
      ...(explanation ? { explanation } : {}),
    };
  });

  const recommendations: string[] = [];
  if (accuracy != null && accuracy < ACCURACY_BUILDING) {
    recommendations.push("Review wrong answers in Mistake Book before your next session.");
  }
  if (accuracy != null && accuracy < ACCURACY_PROCEDURAL) {
    recommendations.push("Revise weak topics from Analysis, then retry this chapter.");
  }
  if (skippedCount > 0) {
    recommendations.push(`Revisit ${skippedCount} skipped question${skippedCount === 1 ? "" : "s"} in Skipped Practice.`);
  }
  if (recommendations.length === 0) {
    // §10.8 — the next step, never a verdict on the student.
    recommendations.push("Nothing outstanding from this session — keep a short daily practice going.");
  }

  const answered = correctCount + wrongCount;
  return {
    version: 2,
    subject: session.subject ?? "",
    chapter: session.chapter ?? "",
    practiceMode: session.practice_mode ?? null,
    difficulty: session.difficulty ?? null,
    questionCount,
    correctCount,
    wrongCount,
    skippedCount,
    accuracy,
    // XP is what the finish credited (practice_sessions.xp_earned), never derived here.
    xpEarned: count(session.xp_earned),
    totalTimeMs,
    finishedAt: session.finished_at,
    startedAt: session.created_at,
    attempts,
    insights: {
      // §10.8 — each headline says what to do next at that level.
      headline:
        accuracy == null
          ? "Nothing was answered — every question was skipped."
          : accuracy >= ACCURACY_PROCEDURAL
            ? "Keep a short daily practice going to hold this chapter."
            : accuracy >= ACCURACY_BUILDING
              ? "Tighten the weak spots before moving on."
              : "Needs recovery focus on missed concepts.",
      bullets: [
        answered > 0 ? `${correctCount} of ${answered} answered correctly (${accuracy}%)` : "No question answered",
        wrongCount > 0 ? `${wrongCount} incorrect` : "No incorrect answers",
        skippedCount > 0 ? `${skippedCount} skipped` : "No skips",
      ],
      recommendations,
    },
    statistics: {
      avgSecPerQuestion: totalTimeMs && questionCount > 0 ? Math.round(totalTimeMs / questionCount / 1000) : null,
    },
  };
}
