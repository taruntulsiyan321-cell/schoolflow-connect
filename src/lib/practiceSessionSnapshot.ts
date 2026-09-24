import type { ConceptRecoveryReport } from "@/lib/conceptReportFallback";
import { supabase } from "@/integrations/supabase/client";
import { sessionAccuracy } from "@/academic/metrics/practice";
import { valueOr } from "@/academic/metrics/types";
import { ACCURACY_CONCEPTUAL } from "@/academic/metrics/bands";

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
  /** Spec §9 — real chapters.id for upload/tagged rows; drives mistake chapter_id. */
  chapterId?: string | null;
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
  /** null when nothing was answered — the finish stores no accuracy then. */
  accuracy?: number | null;
  xpEarned?: number;
  totalTimeMs?: number | null;
};

export type PracticeSessionResultState = {
  /** Empty when the session had no single subject. */
  subject: string;
  /** Empty when the session had no single chapter — never a guess at one. */
  chapter: string;
  /** The session's practice_mode, which names it when it has no chapter. */
  practiceMode?: string | null;
  attempts: PracticeAttemptSnapshot[];
  startedAt?: string;
  /** From rpc_finish_practice_session — SSOT until practice_sessions row hydrates. */
  serverStats?: PracticeServerStats | null;
  /**
   * Present only when the session was a §4.2 recovery session.
   *
   * Carried through rather than re-fetched because the result screen must
   * report the engine's verdict, not re-derive one: §4.2b decides readiness
   * from TWO rates against two different thresholds, and a screen that
   * recomputed it from the raw score would be a second home for both numbers
   * — and would have no way to say WHICH half failed, which is the entire
   * point of keeping them apart.
   */
  recovery?: import("@/academic").RecoverySessionOutcome | null;
  /**
   * Present only when the session was a §5.4 revision check.
   *
   * Carried for the same reason `recovery` is: §5.5 decides pass or fail
   * against REVISION_PASS_THRESHOLD and §5.3 schedules the next date from
   * the 7/21/60 ladder, both server-side against recovery_constants. A screen
   * that re-derived either would be a second home for both.
   *
   * It was missing, and so was the card: Practice computed this outcome and
   * dropped it, so a student who sat a revision check was never told whether
   * they passed, how far into the run they were, or when to come back.
   */
  revision?: import("@/academic").RevisionSessionOutcome | null;
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
  /** null when no question carried a timing — never a floor of one minute. */
  timeMinutes: number | null = null,
): ConceptRecoveryReport {
  // Answered, not attempted: a skipped question is not a wrong answer
  // (20261021000000). This report counted every skip as a miss, so a session
  // skipped end to end flagged its chapter weak at 0%.
  const answered = attempts.filter((a) => !a.skipped && !a.timedOut);
  const correct = answered.filter((a) => a.isCorrect).length;
  const accuracyMetric = sessionAccuracy(correct, answered.length);
  // The weak flag below asks the metric itself, so "nothing answered" can
  // never read as a weak chapter; the reported figure is absent, not 0%.
  const accuracy = valueOr(accuracyMetric, 0);
  const accuracyReported = accuracyMetric.state === "ok" ? accuracy : null;
  const concept = chapter;

  // The weak-topic bar IS the conceptual readiness bar; it was a bare 70.
  const weak =
    accuracyMetric.state === "ok" && accuracy < ACCURACY_CONCEPTUAL
      ? [{ subject, chapter, concept, accuracy }]
      : [];

  return {
    source_type: "practice_session",
    source_id: sessionId,
    accuracy_pct: accuracyReported,
    correct_count: correct,
    total_count: answered.length,
    time_minutes: timeMinutes,
    weak_concepts: weak,
    improvement_areas: weak.map((w) => w.concept),
    insights: undefined,
  };
}

export function snapshotsToAttemptRows(attempts: PracticeAttemptSnapshot[]) {
  return attempts.map((a, i) => {
    const skipped = Boolean(a.skipped || a.timedOut);
    return {
      id: `local-${i}`,
      generated_question: { question: a.question, options: a.options, explanation: a.explanation },
      correct_answer: { index: a.correctIndex, text: a.options[a.correctIndex] ?? "" },
      selected_answer: skipped ? null : { index: a.selectedIndex, text: a.options[a.selectedIndex] ?? "" },
      is_correct: skipped ? false : a.isCorrect,
      skipped,
      created_at: new Date().toISOString(),
    };
  });
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
        chapter_id: a.chapterId ?? null,
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
