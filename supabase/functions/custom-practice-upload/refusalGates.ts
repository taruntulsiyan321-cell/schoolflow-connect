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

/** §13 — max pages per upload. Enforced in custom-practice-upload after media load. */
export const UPLOAD_MAX_PAGES = 20;

/** §13 — max bytes. Storage bucket is the home; edge re-checks after download. */
export const UPLOAD_MAX_BYTES = 20 * 1024 * 1024;

/** §4.4 — a one-question "session" is worse than an honest refusal. */
export const MIN_USABLE_QUESTIONS = 3;

/**
 * How long an upload may sit in `processing` before a re-run is allowed again.
 * Without a window, a crash between "processing" and a verdict would strand the
 * file forever; with one, the student can retry and nothing else can.
 */
export const PROCESSING_STALE_MS = 10 * 60 * 1000;

/**
 * May this upload be classified NOW?
 *
 * A FILE IS CLASSIFIED ONCE. Measured on production 2026-09-27: a CUET Commerce
 * account uploaded a Chemistry worksheet at 02:57, answered three of its
 * questions a minute later — two of them wrong — and at 07:22 the same file was
 * classified AGAIN. That second run ruled it `unusable` and did exactly what
 * §4.3 says: deleted the questions, under a student who had already practised
 * them. It also spent a second `custom_practice.upload` from their plan to
 * reach a verdict that was already made, because the plan is asked before
 * anything looks at the status.
 *
 * The screen only offers "Classify again" for `pending` and `failed`, so nothing
 * a student can tap does this. That is not a reason for the server to allow it:
 * the button's visibility is not a fence.
 *
 * Pure, so it is tested without Deno and without a deploy.
 */
export function mayClassify(
  upload: { status?: string | null; updated_at?: string | null },
  now: number = Date.now(),
): { ok: true } | { ok: false; code: string; message: string } {
  const status = (upload.status ?? "").trim();

  // The first run, and the retry the screen offers. A failed run released its
  // plan use, so charging for the retry is right.
  if (status === "pending" || status === "failed" || status === "") return { ok: true };

  if (status === "processing") {
    const started = upload.updated_at ? Date.parse(upload.updated_at) : Number.NaN;
    if (Number.isFinite(started) && now - started >= PROCESSING_STALE_MS) return { ok: true };
    return {
      ok: false,
      code: "already_processing",
      message: "This file is still being read. Give it a moment.",
    };
  }

  // ready | unusable — a verdict exists. Re-running it would delete what the
  // student is practising and charge them again for the same answer.
  return {
    ok: false,
    code: "already_classified",
    message: "This file has already been checked, so it was not read again.",
  };
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
