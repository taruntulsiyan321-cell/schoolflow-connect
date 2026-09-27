/**
 * Mistake Classification Engine — rule-based deterministic. NEVER uses AI for classification.
 */

type MistakeErrorType =
  | "concept_error"
  | "calculation_error"
  | "careless_mistake"
  | "time_pressure_error"
  | "misinterpretation_error";


const LABELS: Record<MistakeErrorType, string> = {
  concept_error: "Concept error",
  calculation_error: "Calculation error",
  careless_mistake: "Careless mistake",
  time_pressure_error: "Time pressure error",
  misinterpretation_error: "Misinterpretation error",
};




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
