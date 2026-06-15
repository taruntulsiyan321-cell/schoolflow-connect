import type { ConceptRecoveryReport } from "@/lib/conceptReportFallback";

export type PracticeAttemptSnapshot = {
  question: string;
  options: string[];
  correctIndex: number;
  selectedIndex: number;
  isCorrect: boolean;
  explanation?: string;
};

export type PracticeSessionResultState = {
  subject: string;
  chapter: string;
  attempts: PracticeAttemptSnapshot[];
  startedAt?: string;
};

export function buildPracticeRecoveryReport(
  sessionId: string,
  subject: string,
  chapter: string,
  attempts: PracticeAttemptSnapshot[],
  timeMinutes = 1,
): ConceptRecoveryReport {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;
  const concept = chapter;

  const weak =
    accuracy < 70
      ? [{ subject, chapter, concept, accuracy }]
      : [];
  const strong =
    accuracy >= 80
      ? [{ subject, chapter, concept, accuracy }]
      : [];

  return {
    source_type: "practice_session",
    source_id: sessionId,
    accuracy_pct: accuracy,
    correct_count: correct,
    total_count: total,
    time_minutes: timeMinutes,
    weak_concepts: weak,
    strong_concepts: strong,
    recovery_assignments: [],
    improvement_areas: weak.map((w) => w.concept),
    insights: undefined,
  };
}

export function snapshotsToAttemptRows(attempts: PracticeAttemptSnapshot[]) {
  return attempts.map((a, i) => ({
    id: `local-${i}`,
    generated_question: { question: a.question, options: a.options },
    correct_answer: { index: a.correctIndex, text: a.options[a.correctIndex] ?? "" },
    selected_answer: { index: a.selectedIndex, text: a.options[a.selectedIndex] ?? "" },
    is_correct: a.isCorrect,
    created_at: new Date().toISOString(),
  }));
}

export function persistAndGoToPracticeResult(
  nav: (path: string, opts?: { replace?: boolean; state?: PracticeSessionResultState }) => void,
  sessionId: string,
  state: PracticeSessionResultState,
) {
  try {
    sessionStorage.setItem(`practice-session-result-${sessionId}`, JSON.stringify(state));
  } catch {
    /* quota / private mode */
  }
  nav(`/student/practice/session/${sessionId}/result`, { replace: true, state });
}
