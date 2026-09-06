/**
 * The quality guard for questions entering a paper.
 *
 * Pure. No client, no network, no clock — every input is passed in, so each
 * rule can be tested on its own and a rejection can be explained to the teacher
 * rather than silently swallowed.
 *
 * WHAT IT CHECKS, in the order a question meets it:
 *
 *   1. malformed        — no question text; an MCQ without exactly four options
 *                         or with `correct_index` outside them.
 *   2. answerless       — a short/long question with no answer text. Also a
 *                         database constraint (`qpq_answer_shape`), so a caller
 *                         that skips this guard still cannot store one.
 *   3. off-chapter      — the question's chapter is not one the section asked
 *                         for. Compared on a normalised form, because the bank
 *                         holds "Accounting Ratios" and "accounting  ratios".
 *   4. near-duplicate   — cosine similarity >= NEAR_DUPLICATE_SIMILARITY
 *                         against anything already in the bank, measured in the
 *                         SAME embedding space retrieval uses.
 *
 * EVERY REJECTION CARRIES A REASON. A question the teacher asked for and did
 * not get is reported as a shortfall with its cause; nothing is dropped
 * quietly. That is the difference between a guard and data loss.
 */
import { NEAR_DUPLICATE_SIMILARITY } from "@/academic/metrics/thresholds";

/** The four options an MCQ must have. Not a threshold — a format. */
const MCQ_OPTION_COUNT = 4;

export type GuardCandidate = {
  question: string;
  /** MCQ only. */
  options?: string[] | null;
  correct_index?: number | null;
  /** short / long only. */
  answer?: string | null;
  explanation?: string | null;
  chapter?: string | null;
  /** The embedding for this question, when one could be computed. */
  embedding?: number[] | null;
};

export type GuardContext = {
  format: "mcq" | "short" | "long";
  /** Chapters the section asked for. Empty means the section did not restrict. */
  chapters: string[];
  /**
   * Vectors already in the bank for this slice, to check duplication against.
   * Absent or empty means the check cannot run — which is reported, not passed.
   */
  existingEmbeddings?: number[][];
};

export type GuardRejection =
  | { kind: "malformed"; detail: string }
  | { kind: "answerless"; detail: string }
  | { kind: "off_chapter"; detail: string }
  | { kind: "near_duplicate"; detail: string };

export type GuardVerdict =
  | { ok: true; duplicateCheck: "ran" | "skipped_no_embedding" | "skipped_no_corpus" }
  | { ok: false; rejection: GuardRejection };

/** Fold the spellings the bank actually holds onto one comparable form. */
export function normaliseChapter(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Cosine similarity of two equal-length vectors, or null when it is undefined —
 * different lengths, or a zero-norm vector. Null means "could not measure",
 * never 0, because 0 would read as "completely different" and let a duplicate
 * through.
 */
export function cosineSimilarity(a: number[], b: number[]): number | null {
  if (a.length === 0 || a.length !== b.length) return null;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return null;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/** The closest match in the corpus, or null when nothing is measurable. */
export function closestSimilarity(
  embedding: number[],
  corpus: number[][],
): number | null {
  let best: number | null = null;
  for (const other of corpus) {
    const s = cosineSimilarity(embedding, other);
    if (s === null) continue;
    if (best === null || s > best) best = s;
  }
  return best;
}

export function guardQuestion(
  candidate: GuardCandidate,
  context: GuardContext,
): GuardVerdict {
  // 1. malformed
  const text = (candidate.question ?? "").trim();
  if (!text) {
    return { ok: false, rejection: { kind: "malformed", detail: "no question text" } };
  }

  if (context.format === "mcq") {
    const options = (candidate.options ?? []).map((o) => (o ?? "").trim());
    if (options.length !== MCQ_OPTION_COUNT || options.some((o) => !o)) {
      return {
        ok: false,
        rejection: {
          kind: "malformed",
          detail: `an MCQ needs ${MCQ_OPTION_COUNT} non-empty options, got ${options.filter(Boolean).length}`,
        },
      };
    }
    const idx = candidate.correct_index;
    if (idx === null || idx === undefined || !Number.isInteger(idx) || idx < 0 || idx >= options.length) {
      return {
        ok: false,
        rejection: { kind: "malformed", detail: `correct_index ${String(idx)} is not one of the options` },
      };
    }
  } else {
    // 2. answerless — the whole point of a written-answer question
    if (!(candidate.answer ?? "").trim()) {
      return {
        ok: false,
        rejection: { kind: "answerless", detail: `a ${context.format} answer question with no answer` },
      };
    }
  }

  // 3. off-chapter
  if (context.chapters.length > 0) {
    const asked = new Set(context.chapters.map(normaliseChapter));
    const got = normaliseChapter(candidate.chapter ?? "");
    if (!got || !asked.has(got)) {
      return {
        ok: false,
        rejection: {
          kind: "off_chapter",
          detail: got
            ? `chapter "${candidate.chapter}" was not asked for`
            : "no chapter on the question",
        },
      };
    }
  }

  // 4. near-duplicate
  //
  // A check that cannot run is REPORTED as not having run. Returning ok with no
  // distinction would make "no embedding available" indistinguishable from
  // "verified unique", which is exactly the shape that makes a guard worthless.
  if (!candidate.embedding || candidate.embedding.length === 0) {
    return { ok: true, duplicateCheck: "skipped_no_embedding" };
  }
  const corpus = context.existingEmbeddings ?? [];
  if (corpus.length === 0) {
    return { ok: true, duplicateCheck: "skipped_no_corpus" };
  }
  const closest = closestSimilarity(candidate.embedding, corpus);
  if (closest !== null && closest >= NEAR_DUPLICATE_SIMILARITY) {
    return {
      ok: false,
      rejection: {
        kind: "near_duplicate",
        detail: `similarity ${closest.toFixed(4)} to a question already in the bank`,
      },
    };
  }
  return { ok: true, duplicateCheck: "ran" };
}
