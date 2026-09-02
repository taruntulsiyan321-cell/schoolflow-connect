import type { ConceptRecoveryReport } from "@/lib/conceptReportFallback";
import { supabase } from "@/integrations/supabase/client";
import { sessionAccuracy } from "@/academic/metrics/practice";
import { valueOr } from "@/academic/metrics/types";

export type PracticeAttemptSnapshot = {
  question: string;
  options: string[];
  correctIndex: number;
  selectedIndex: number;
  isCorrect: boolean;
  skipped?: boolean;
  explanation?: string;
  /** When set, finish RPC grades against question_bank (ignores client isCorrect). */
  bankQuestionId?: string | null;
  subject?: string;
  chapter?: string;
  concept?: string;
  topic?: string;
  difficulty?: string;
  source?: string;
  practiceMode?: string;
  sourceId?: string | null;
  timeTakenMs?: number | null;
  hintUsed?: boolean;
  solutionViewed?: boolean;
  confidence?: number | null;
  attemptNumber?: number | null;
  timedOut?: boolean;
  answeredAt?: string;
  classLevel?: number | null;
  board?: string | null;
  stream?: string | null;
  schoolId?: string | null;
  templateId?: string | null;
};

export type PracticeAttemptMeta = {
  solution_viewed?: boolean;
  confidence?: number | null;
  attempt_number?: number | null;
  timed_out?: boolean;
  practice_mode?: string | null;
  source_id?: string | null;
  class_level?: number | null;
  board?: string | null;
  stream?: string | null;
  topic?: string | null;
  difficulty?: string | null;
  school_id?: string | null;
  answered_at?: string | null;
  hint_used?: boolean;
};

/** Finish-RPC aggregates — prefer over client tallies on the result page. */
export type PracticeServerStats = {
  questionCount?: number;
  correctCount?: number;
  wrongCount?: number;
  skippedCount?: number;
  accuracy?: number;
  xpEarned?: number;
  totalTimeMs?: number | null;
};

export type PracticeSessionResultState = {
  subject: string;
  chapter: string;
  attempts: PracticeAttemptSnapshot[];
  startedAt?: string;
  /** From rpc_finish_practice_session — SSOT until practice_sessions row hydrates. */
  serverStats?: PracticeServerStats | null;
};

/** Build the optional intelligence meta blob for rpc_record_question_attempt. */
export function buildAttemptMeta(a: PracticeAttemptSnapshot): PracticeAttemptMeta {
  return {
    solution_viewed: a.solutionViewed ?? false,
    confidence: a.confidence ?? null,
    attempt_number: a.attemptNumber ?? null,
    timed_out: a.timedOut ?? false,
    practice_mode: a.practiceMode ?? a.source ?? null,
    source_id: a.sourceId ?? null,
    class_level: a.classLevel ?? null,
    board: a.board ?? null,
    stream: a.stream ?? null,
    topic: a.topic ?? a.concept ?? a.chapter ?? null,
    difficulty: a.difficulty ?? null,
    school_id: a.schoolId ?? null,
    answered_at: a.answeredAt ?? new Date().toISOString(),
    hint_used: a.hintUsed ?? false,
  };
}

export function buildPracticeRecoveryReport(
  sessionId: string,
  subject: string,
  chapter: string,
  attempts: PracticeAttemptSnapshot[],
  timeMinutes = 1,
): ConceptRecoveryReport {
  const total = attempts.length;
  const correct = attempts.filter((a) => a.isCorrect).length;
  // Chunk 10. Was `total ? … : 0` — the same expression, with the same defect,
  // in five files. A session with nothing attempted is not a session scored
  // zero. valueOr(..., 0) keeps this snapshot's numeric shape for its callers,
  // but the zero now comes from ONE place that knows it is standing in for
  // no_data, instead of five that thought it was an answer.
  const accuracyMetric = sessionAccuracy(correct, total);
  const accuracy = valueOr(accuracyMetric, 0);
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

/** Full finish-batch payload — every field Practice Intelligence can consume. */
export function attemptsToFinishPayload(attempts: PracticeAttemptSnapshot[]) {
  return attempts.map((a) => {
    const meta = buildAttemptMeta(a);
    return {
      bank_question_id: a.bankQuestionId ?? null,
      template_id: a.templateId ?? null,
      generated_question: {
        question: a.question,
        options: a.options,
        explanation: a.explanation ?? "",
        bank_question_id: a.bankQuestionId ?? null,
        subject: a.subject ?? null,
        chapter: a.chapter ?? null,
        concept: a.concept ?? a.chapter ?? null,
        topic: a.topic ?? a.concept ?? a.chapter ?? null,
        difficulty: a.difficulty ?? null,
        practice_mode: a.practiceMode ?? a.source ?? null,
      },
      selected_answer: {
        index: a.selectedIndex,
        selected_index: a.selectedIndex,
        text: a.options[a.selectedIndex] ?? "",
      },
      // Server ignores these when bank_question_id is present; kept for audit/legacy.
      correct_answer: {
        index: a.correctIndex,
        correct_index: a.correctIndex,
        text: a.options[a.correctIndex] ?? "",
      },
      is_correct: a.skipped || a.timedOut ? false : a.isCorrect,
      score: a.skipped || a.timedOut ? 0 : a.isCorrect ? 1 : 0,
      skipped: Boolean(a.skipped || a.timedOut),
      time_taken_ms: a.timeTakenMs ?? null,
      hint_used: a.hintUsed ?? false,
      solution_viewed: a.solutionViewed ?? false,
      confidence: a.confidence ?? null,
      attempt_number: a.attemptNumber ?? null,
      timed_out: a.timedOut ?? false,
      practice_mode: a.practiceMode ?? a.source ?? "practice",
      source: a.source ?? "practice",
      source_id: a.sourceId ?? null,
      topic: a.topic ?? a.concept ?? a.chapter ?? null,
      difficulty: a.difficulty ?? null,
      class_level: a.classLevel ?? null,
      board: a.board ?? null,
      stream: a.stream ?? null,
      school_id: a.schoolId ?? null,
      answered_at: a.answeredAt ?? null,
      meta,
    };
  });
}

export async function finishPracticeSessionWithAttempts(
  sessionId: string,
  attempts: PracticeAttemptSnapshot[],
) {
  try {
    const { PracticeService, resolveStudentServiceContext } = await import("@/academic");
    const ctx = await resolveStudentServiceContext();
    return {
      data: await PracticeService.finish(ctx, {
        _session_id: sessionId,
        _attempts: attemptsToFinishPayload(attempts),
      }),
      error: null,
    };
  } catch {
    // Last-resort RPC — PracticeService path is preferred (emit + live bus).
    return supabase.rpc("rpc_finish_practice_session", {
      _session_id: sessionId,
      _attempts: attemptsToFinishPayload(attempts),
    });
  }
}
