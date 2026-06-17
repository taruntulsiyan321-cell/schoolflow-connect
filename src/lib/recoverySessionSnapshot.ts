import type { ConceptRecoveryReport } from "@/lib/conceptReportFallback";

export type RecoveryAttemptSnapshot = {
  questionId: string;
  question: string;
  options: string[];
  correctIndex: number;
  selectedIndex: number;
  isCorrect: boolean;
  explanation?: string;
};

export type RecoverySessionResultState = {
  assignmentId: string;
  subject: string;
  chapter?: string;
  concept: string;
  severity?: string;
  attempts: RecoveryAttemptSnapshot[];
  startedAt?: string;
};

export function buildRecoveryAssignmentReport(
  assignmentId: string,
  subject: string,
  chapter: string | undefined,
  concept: string,
  attempts: RecoveryAttemptSnapshot[],
  timeMinutes = 1,
): ConceptRecoveryReport {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;

  const weak =
    accuracy < 70
      ? [{ subject, chapter, concept, accuracy }]
      : [];
  const strong =
    accuracy >= 80
      ? [{ subject, chapter, concept, accuracy }]
      : [];

  return {
    source_type: "recovery_assignment",
    source_id: assignmentId,
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

export function recoverySnapshotsToAttemptRows(attempts: RecoveryAttemptSnapshot[]) {
  return attempts.map((a, i) => ({
    id: a.questionId || `local-${i}`,
    generated_question: { question: a.question, options: a.options },
    correct_answer: { index: a.correctIndex, text: a.options[a.correctIndex] ?? "" },
    selected_answer: { index: a.selectedIndex, text: a.options[a.selectedIndex] ?? "" },
    is_correct: a.isCorrect,
    explanation: a.explanation,
    created_at: new Date().toISOString(),
  }));
}

export function persistRecoveryResult(
  nav: (path: string, opts?: { replace?: boolean; state?: RecoverySessionResultState }) => void,
  state: RecoverySessionResultState,
) {
  try {
    sessionStorage.setItem(`recovery-result-${state.assignmentId}`, JSON.stringify(state));
  } catch {
    /* ignore */
  }
  nav(`/student/recovery/${state.assignmentId}/result`, { replace: true, state });
}

export function readRecoveryResultState(assignmentId: string): RecoverySessionResultState | null {
  try {
    const raw = sessionStorage.getItem(`recovery-result-${assignmentId}`);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as RecoverySessionResultState;
    return parsed?.attempts?.length ? parsed : null;
  } catch {
    return null;
  }
}

export function writeRecoveryResultState(state: RecoverySessionResultState): void {
  try {
    sessionStorage.setItem(`recovery-result-${state.assignmentId}`, JSON.stringify(state));
  } catch {
    /* ignore quota */
  }
}

type AttemptRowLike = {
  id: string;
  generated_question?: { question?: string; options?: string[] };
};

export function attemptRowHasContent(row: AttemptRowLike): boolean {
  const q = (row.generated_question?.question ?? "").trim();
  const opts = row.generated_question?.options;
  return q.length > 0 && Array.isArray(opts) && opts.length >= 2;
}

/** Prefer rows with question text — DB often has answered=true but empty client-generated fields. */
export function mergeRecoveryAttemptRows<T extends AttemptRowLike>(db: T[], local: T[]): T[] {
  if (local.length === 0) return db;
  if (db.length === 0) return local;

  const localById = new Map(local.map((r) => [r.id, r]));
  const merged = db.map((row, i) => {
    if (attemptRowHasContent(row)) return row;
    const byId = localById.get(row.id);
    if (byId && attemptRowHasContent(byId)) return byId;
    const byOrder = local[i];
    if (byOrder && attemptRowHasContent(byOrder)) return byOrder;
    return byId ?? byOrder ?? row;
  });

  const seen = new Set(merged.map((r) => r.id));
  for (const row of local) {
    if (!seen.has(row.id) && attemptRowHasContent(row)) {
      merged.push(row);
      seen.add(row.id);
    }
  }

  const withContent = merged.filter(attemptRowHasContent);
  return withContent.length > 0 ? withContent : local.length > 0 ? local : db;
}
