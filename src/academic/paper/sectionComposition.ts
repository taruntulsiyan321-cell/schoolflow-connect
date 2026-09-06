/**
 * How a section's questions are composed from the two sources, and what the
 * teacher is told when they do not add up.
 *
 * Pure. The retrieval and the generation happen elsewhere; this decides how
 * many of each are needed and reports the gap.
 *
 * THE RULE. Structure adherence is the requirement: five 3-mark short answers
 * means exactly five. So:
 *
 *   · MCQ sections    — BANK FIRST, generate the shortfall. A section asking
 *                       for 20 that the bank answers with 6 needs 14 generated.
 *   · short / long    — generated outright; the bank is MCQ-shaped
 *                       (`options` and `correct_index` are NOT NULL on it), so
 *                       there is nothing to retrieve.
 *
 * A SHORTFALL IS REPORTED, NOT BLOCKING. Narrow chapter-plus-difficulty slices
 * are expected to come up short; broad coverage is adequate. The teacher is
 * told the number and the reason and decides.
 */

export type SectionFormat = "mcq" | "short" | "long";

export type SectionPlan = {
  format: SectionFormat;
  targetCount: number;
};

export type SourcePlan = {
  /** How many to take from the bank. Always 0 for a written-answer section. */
  fromBank: number;
  /** How many to ask the generator for. */
  toGenerate: number;
};

/**
 * What to ask each source for, given what the bank actually returned.
 *
 * `retrievedCount` is what retrieval found AFTER the guard, not before — a
 * question the guard rejected was never available, and counting it here would
 * under-generate and leave the section short without saying so.
 */
export function planSources(plan: SectionPlan, retrievedCount: number): SourcePlan {
  const target = Math.max(0, Math.trunc(plan.targetCount));
  if (plan.format !== "mcq") {
    return { fromBank: 0, toGenerate: target };
  }
  const fromBank = Math.max(0, Math.min(target, Math.trunc(retrievedCount)));
  return { fromBank, toGenerate: target - fromBank };
}

export type SectionOutcome = {
  targetCount: number;
  retrieved: number;
  generated: number;
  /** targetCount minus what was actually assembled. Never negative. */
  shortfall: number;
  /** True when the section did not reach the blueprint. */
  short: boolean;
};

export function summariseSection(
  plan: SectionPlan,
  retrieved: number,
  generated: number,
): SectionOutcome {
  const targetCount = Math.max(0, Math.trunc(plan.targetCount));
  const got = Math.max(0, Math.trunc(retrieved)) + Math.max(0, Math.trunc(generated));
  const assembled = Math.min(got, targetCount);
  const shortfall = Math.max(0, targetCount - assembled);
  return {
    targetCount,
    retrieved: Math.max(0, Math.trunc(retrieved)),
    generated: Math.max(0, Math.trunc(generated)),
    shortfall,
    short: shortfall > 0,
  };
}

export type PaperQuestionMarks = {
  /** NULL means "use the section's marks_per_question". */
  marks: number | null;
};

/**
 * The paper's total, computed rather than stored, so it cannot drift from the
 * questions it is the sum of. A per-question override wins over the section's
 * rate; anything else uses the section rate.
 */
export function sectionTotalMarks(
  marksPerQuestion: number,
  questions: PaperQuestionMarks[],
): number {
  return questions.reduce(
    (sum, q) => sum + (q.marks != null && q.marks > 0 ? q.marks : marksPerQuestion),
    0,
  );
}

export function paperTotalMarks(
  sections: { marksPerQuestion: number; questions: PaperQuestionMarks[] }[],
): number {
  return sections.reduce(
    (sum, s) => sum + sectionTotalMarks(s.marksPerQuestion, s.questions),
    0,
  );
}
