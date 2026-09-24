/**
 * §4.2–§4.4 refusal gates — pure, no Deno / model I/O.
 * Binding: docs/custom-practice-upload-spec.md
 *
 * Kept separate from classify.ts so app vitest can import this module
 * without pulling supabase/functions/_shared/modelRouter (Deno) into tsc.
 */
import type { ClassifierResult } from "./types.ts";

/** §4.2 — below this the verdict is forced to unusable. */
export const CONFIDENCE_THRESHOLD = 0.55;

/** §4.4 — a one-question "session" is worse than an honest refusal. */
export const MIN_USABLE_QUESTIONS = 3;

/** Apply §4.2–§4.4 gates. Pure — safe to unit-test offline. */
export function applyRefusalGates(raw: ClassifierResult): ClassifierResult {
  let verdict = raw.verdict;
  let confidence = Number.isFinite(raw.confidence)
    ? Math.max(0, Math.min(1, raw.confidence))
    : 0;
  let questions = raw.questions;
  let notes = raw.notes;
  let refusal_reason = raw.refusal_reason;

  if (confidence < CONFIDENCE_THRESHOLD) {
    verdict = "unusable";
    refusal_reason =
      refusal_reason?.trim() ||
      "Could not read this file confidently enough to use it for practice.";
    questions = [];
    notes = [];
  }

  if (verdict === "unusable") {
    return {
      verdict: "unusable",
      confidence,
      refusal_reason:
        refusal_reason?.trim() ||
        "This file could not be used for practice.",
      questions: [],
      notes: [],
    };
  }

  // §4.4 — fewer than 3 usable questions and no notes → unusable.
  if (questions.length < MIN_USABLE_QUESTIONS && notes.length === 0) {
    return {
      verdict: "unusable",
      confidence,
      refusal_reason:
        questions.length === 0
          ? "No usable questions or notes were found in this file."
          : `Only ${questions.length} usable question(s) found — need at least ${MIN_USABLE_QUESTIONS} to practise, or upload notes.`,
      questions: [],
      notes: [],
    };
  }

  // Align verdict with what we actually kept.
  const hasQ = questions.length > 0;
  const hasN = notes.length > 0;
  if (hasQ && hasN) verdict = "mixed";
  else if (hasQ) verdict = "questions";
  else if (hasN) verdict = "notes";
  else {
    return {
      verdict: "unusable",
      confidence,
      refusal_reason: "No usable questions or notes were found in this file.",
      questions: [],
      notes: [],
    };
  }

  return {
    verdict,
    confidence,
    refusal_reason: null,
    questions,
    notes,
  };
}
