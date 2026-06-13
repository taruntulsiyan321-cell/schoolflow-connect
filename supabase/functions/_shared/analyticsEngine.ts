/**
 * Deterministic Analytics Engine — NEVER uses AI.
 * Computes score, accuracy, timing, strong/weak chapters & concepts.
 */

export type AttemptRecord = {
  is_correct: boolean;
  skipped?: boolean;
  time_taken_ms?: number | null;
  score?: number;
  subject?: string;
  chapter?: string | null;
  concept?: string | null;
  subconcept?: string | null;
  difficulty?: string | null;
};

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

function countByKey<T extends Record<string, unknown>>(
  items: T[],
  keyFn: (item: T) => string,
  filterFn?: (item: T) => boolean,
): Map<string, { count: number; sample: T }> {
  const map = new Map<string, { count: number; sample: T }>();
  for (const item of items) {
    if (filterFn && !filterFn(item)) continue;
    const k = keyFn(item);
    const prev = map.get(k);
    if (prev) prev.count += 1;
    else map.set(k, { count: 1, sample: item });
  }
  return map;
}

export function computeSessionAnalytics(attempts: AttemptRecord[]): SessionAnalytics {
  const total = attempts.length;
  const skipped = attempts.filter((a) => a.skipped).length;
  const correct = attempts.filter((a) => a.is_correct && !a.skipped).length;
  const wrong = attempts.filter((a) => !a.is_correct && !a.skipped).length;
  const answered = total - skipped;
  const accuracy = answered > 0 ? Math.round((correct / answered) * 1000) / 10 : 0;
  const timeMs = attempts.reduce((s, a) => s + (a.time_taken_ms ?? 0), 0);
  const avgTime = total > 0 ? Math.round(timeMs / total) : 0;
  const score =
    attempts.length > 0
      ? Math.round((attempts.reduce((s, a) => s + (a.score ?? (a.is_correct ? 1 : 0)), 0) / attempts.length) * 10) / 10
      : 0;

  const strongChapterMap = countByKey(
    attempts,
    (a) => `${a.subject ?? "General"}::${a.chapter ?? "general"}`,
    (a) => a.is_correct && !!a.chapter,
  );
  const weakChapterMap = countByKey(
    attempts,
    (a) => `${a.subject ?? "General"}::${a.chapter ?? "general"}`,
    (a) => !a.is_correct && !a.skipped && !!a.chapter,
  );

  const strongConceptMap = countByKey(
    attempts,
    (a) => `${a.subject ?? "General"}::${a.concept ?? "general"}`,
    (a) => a.is_correct && !!a.concept,
  );
  const weakConceptMap = countByKey(
    attempts,
    (a) => `${a.subject ?? "General"}::${a.concept ?? "general"}`,
    (a) => !a.is_correct && !a.skipped && !!a.concept,
  );

  const toChapterList = (m: Map<string, { count: number; sample: AttemptRecord }>) =>
    [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 5)
      .map(([, v]) => ({
        chapter: v.sample.chapter ?? "General",
        subject: v.sample.subject ?? "General",
      }));

  const toConceptList = (m: Map<string, { count: number; sample: AttemptRecord }>) =>
    [...m.entries()]
      .sort((a, b) => b[1].count - a[1].count)
      .slice(0, 8)
      .map(([, v]) => ({
        concept: v.sample.concept ?? "General",
        subject: v.sample.subject ?? "General",
        chapter: v.sample.chapter,
      }));

  return {
    score,
    accuracy,
    time_taken_ms: timeMs,
    avg_time_per_question_ms: avgTime,
    total_questions: total,
    correct,
    wrong,
    skipped,
    strong_chapters: toChapterList(strongChapterMap),
    weak_chapters: toChapterList(weakChapterMap),
    strong_concepts: toConceptList(strongConceptMap),
    weak_concepts: toConceptList(weakConceptMap),
    computed_at: new Date().toISOString(),
  };
}

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
