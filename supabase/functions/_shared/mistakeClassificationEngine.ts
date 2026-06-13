/**
 * Mistake Classification Engine — rule-based deterministic. NEVER uses AI for classification.
 */

export type MistakeErrorType =
  | "concept_error"
  | "calculation_error"
  | "careless_mistake"
  | "time_pressure_error"
  | "misinterpretation_error";

export type ClassifyInput = {
  student_answer?: { selected_index?: number; text?: string };
  correct_answer?: { correct_index?: number; text?: string };
  options?: string[];
  time_taken_ms?: number | null;
  times_wrong?: number;
};

const LABELS: Record<MistakeErrorType, string> = {
  concept_error: "Concept error",
  calculation_error: "Calculation error",
  careless_mistake: "Careless mistake",
  time_pressure_error: "Time pressure error",
  misinterpretation_error: "Misinterpretation error",
};

export function classifyMistake(input: ClassifyInput): MistakeErrorType {
  const sIdx = input.student_answer?.selected_index;
  const cIdx = input.correct_answer?.correct_index;
  const optCount = input.options?.length ?? 0;
  const sText = (input.student_answer?.text ?? "").toLowerCase();
  const cText = (input.correct_answer?.text ?? "").toLowerCase();
  const timesWrong = input.times_wrong ?? 1;

  if (input.time_taken_ms != null && input.time_taken_ms < 8000 && optCount > 0) {
    return "time_pressure_error";
  }

  if (sIdx != null && cIdx != null && Math.abs(sIdx - cIdx) === 1) {
    return "careless_mistake";
  }

  if (sText && cText && /[0-9]/.test(sText) && /[0-9]/.test(cText) && sText.slice(0, 3) === cText.slice(0, 3)) {
    return "calculation_error";
  }

  if (sIdx != null && cIdx != null && optCount > 0 && Math.abs(sIdx - cIdx) >= 2) {
    return "concept_error";
  }

  if (timesWrong >= 2) return "concept_error";

  return "misinterpretation_error";
}

export function mistakeTypeLabel(type: MistakeErrorType): string {
  return LABELS[type];
}

export function aggregateClassificationTrends(
  mistakes: { error_type?: string | null }[],
): Record<string, number> {
  const trends: Record<string, number> = {};
  for (const m of mistakes) {
    const t = m.error_type ?? "unknown";
    trends[t] = (trends[t] ?? 0) + 1;
  }
  return trends;
}

/** Structured classification summary for agents — counts only, no raw answers. */
export function buildClassificationSummaryForAgents(
  trends: Record<string, number>,
  totalMistakes: number,
) {
  const sorted = Object.entries(trends)
    .sort((a, b) => b[1] - a[1])
    .map(([type, count]) => ({
      type,
      label: LABELS[type as MistakeErrorType] ?? type,
      count,
      pct: totalMistakes > 0 ? Math.round((count / totalMistakes) * 100) : 0,
    }));
  const dominant = sorted[0]?.type ?? "concept_error";
  return { total_mistakes: totalMistakes, breakdown: sorted.slice(0, 5), dominant_error_type: dominant };
}
