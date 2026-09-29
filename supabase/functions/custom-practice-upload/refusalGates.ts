/**
 * §4.2–§4.4 refusal gates — pure, no Deno / model I/O.
 * Binding: docs/custom-practice-upload-spec.md
 *
 * Kept separate from classify.ts so app vitest can import this module
 * without pulling supabase/functions/_shared/modelRouter (Deno) into tsc.
 */
import type { ClassifierResult, ExtractedQuestion } from "./types.ts";

/** §4.2 — below this the verdict is forced to unusable. */
export const CONFIDENCE_THRESHOLD = 0.55;

/** §13 — max pages per upload. Enforced in custom-practice-upload after media load. */
export const UPLOAD_MAX_PAGES = 20;

/** §13 — max bytes. Storage bucket is the home; edge re-checks after download. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** §4.4 — a one-question "session" is worse than an honest refusal. */
export const MIN_USABLE_QUESTIONS = 3;

/**
 * A question Practice can put to the student: two or more options and an
 * option index to grade on — the rule Practice applies before it shows an
 * uploaded question, and the server's `_brought_question_askable`. A question
 * whose answer is text only is kept, but it cannot be practised, so it is not
 * a usable question for §4.4 or a mode for §8.
 */
export function isAskable(q: Pick<ExtractedQuestion, "options" | "correct_index">): boolean {
  return Array.isArray(q.options) && q.options.length >= 2 && Number.isInteger(q.correct_index);
}

/**
 * §4.4 — the refusal for too little to practise: fewer than
 * MIN_USABLE_QUESTIONS askable questions and no notes. Null when the upload
 * may be used. Applied to what the model returned, and again to what is kept
 * once questions outside the student's stream are set aside — a file of five
 * questions, three of them another subject's, leaves two.
 */
export function tooFewToPractise(
  questions: Pick<ExtractedQuestion, "options" | "correct_index">[],
  noteCount: number,
): string | null {
  const askable = questions.filter(isAskable).length;
  if (askable >= MIN_USABLE_QUESTIONS || noteCount > 0) return null;
  return askable === 0
    ? "No usable questions or notes were found in this file."
    : `Only ${askable} usable question(s) found — need at least ${MIN_USABLE_QUESTIONS} to practise, or upload notes.`;
}

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
  const tooFew = tooFewToPractise(questions, notes.length);
  if (tooFew) {
    return { verdict: "unusable", confidence, refusal_reason: tooFew, questions: [], notes: [] };
  }

  // Align verdict with what we actually kept: questions means questions that
  // can be practised.
  const hasQ = questions.some(isAskable);
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
