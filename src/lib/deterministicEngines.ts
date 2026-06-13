/**
 * Client-side deterministic engines (mirror server logic for instant UI).
 * Metrics are NEVER delegated to AI.
 */

export type AttemptRecord = {
  is_correct: boolean;
  skipped?: boolean;
  time_taken_ms?: number | null;
  score?: number;
  subject?: string;
  chapter?: string | null;
  concept?: string | null;
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
};

export type MistakeErrorType =
  | "concept_error"
  | "calculation_error"
  | "careless_mistake"
  | "time_pressure_error"
  | "misinterpretation_error";

const ERROR_LABELS: Record<MistakeErrorType, string> = {
  concept_error: "Concept error",
  calculation_error: "Calculation error",
  careless_mistake: "Careless mistake",
  time_pressure_error: "Time pressure",
  misinterpretation_error: "Misinterpretation",
};

export function computeSessionAnalytics(attempts: AttemptRecord[]): SessionAnalytics {
  const total = attempts.length;
  const skipped = attempts.filter((a) => a.skipped).length;
  const correct = attempts.filter((a) => a.is_correct && !a.skipped).length;
  const wrong = total - skipped - correct;
  const answered = total - skipped;
  const accuracy = answered > 0 ? Math.round((correct / answered) * 1000) / 10 : 0;
  const timeMs = attempts.reduce((s, a) => s + (a.time_taken_ms ?? 0), 0);

  return {
    score: total > 0 ? Math.round((correct / total) * 1000) / 10 : 0,
    accuracy,
    time_taken_ms: timeMs,
    avg_time_per_question_ms: total > 0 ? Math.round(timeMs / total) : 0,
    total_questions: total,
    correct,
    wrong,
    skipped,
    strong_chapters: [],
    weak_chapters: [],
    strong_concepts: [],
    weak_concepts: [],
  };
}

export function classifyMistake(input: {
  student_answer?: { selected_index?: number; text?: string };
  correct_answer?: { correct_index?: number; text?: string };
  options?: string[];
  time_taken_ms?: number | null;
  times_wrong?: number;
}): MistakeErrorType {
  const sIdx = input.student_answer?.selected_index;
  const cIdx = input.correct_answer?.correct_index;
  const optCount = input.options?.length ?? 0;
  if (input.time_taken_ms != null && input.time_taken_ms < 8000 && optCount > 0) return "time_pressure_error";
  if (sIdx != null && cIdx != null && Math.abs(sIdx - cIdx) === 1) return "careless_mistake";
  if (sIdx != null && cIdx != null && optCount > 0 && Math.abs(sIdx - cIdx) >= 2) return "concept_error";
  if ((input.times_wrong ?? 1) >= 2) return "concept_error";
  return "misinterpretation_error";
}

export function mistakeTypeLabel(type: MistakeErrorType | string): string {
  return ERROR_LABELS[type as MistakeErrorType] ?? type;
}

export function computeMasteryScore(input: {
  total_attempts: number;
  correct_attempts: number;
  mistake_count: number;
  recovery_attempts?: number;
  recovery_correct?: number;
}): number {
  const attempts = Math.max(input.total_attempts, 1);
  const raw =
    (input.correct_attempts / attempts) * 70 -
    Math.min(input.mistake_count * 4, 30) +
    (input.recovery_attempts && input.recovery_attempts > 0
      ? ((input.recovery_correct ?? 0) / input.recovery_attempts) * 15
      : 0);
  return Math.max(0, Math.min(100, Math.round(raw * 10) / 10));
}
