/**
 * Custom Practice — §10.2 promotion gates.
 * Binding: docs/custom-practice-upload-spec.md
 *
 * A generated variant enters the shared bank only when all four hold.
 * Near-duplicate detection stays with the caller (embed match against
 * `question_bank.embedding`); this module only consumes the boolean.
 */

export type UploadPromotionInput = {
  /** Real curriculum chapter — not a free-text guess (§5 / §10.2.1). */
  chapterId: string | null | undefined;
  /** MCQ options on the generated variant (§10.2.2). */
  options: readonly string[] | null | undefined;
  /** Index of the single correct option (§10.2.2). */
  correctIndex: number | null | undefined;
  /** Explanation required with the variant (§10.2.2). */
  explanation: string | null | undefined;
  /** True when embed match says this is a near-duplicate (§10.2.3). */
  isNearDup: boolean;
  /** Provenance of the source upload question (§6.2 / §10.2.4). */
  answerSource: "file" | "ai";
};

/** §10.2.1 — source resolved to a real chapter_id. */
export function hasRealChapterId(input: Pick<UploadPromotionInput, "chapterId">): boolean {
  return typeof input.chapterId === "string" && input.chapterId.trim().length > 0;
}

/**
 * §10.2.2 — variant validates: options present, exactly one correct key,
 * and a non-empty explanation.
 */
export function hasValidVariant(
  input: Pick<UploadPromotionInput, "options" | "correctIndex" | "explanation">,
): boolean {
  const options = input.options;
  if (!Array.isArray(options) || options.length === 0) return false;
  if (!options.every((o) => typeof o === "string" && o.trim().length > 0)) return false;

  const idx = input.correctIndex;
  if (typeof idx !== "number" || !Number.isInteger(idx)) return false;
  if (idx < 0 || idx >= options.length) return false;

  const explanation = input.explanation;
  if (typeof explanation !== "string" || explanation.trim().length === 0) return false;

  return true;
}

/** §10.2.3 — not a near-duplicate of a bank question. */
export function isNotNearDuplicate(input: Pick<UploadPromotionInput, "isNearDup">): boolean {
  return input.isNearDup === false;
}

/** §10.2.4 — source question was not AI-answered. */
export function sourceNotAiAnswered(input: Pick<UploadPromotionInput, "answerSource">): boolean {
  return input.answerSource === "file";
}

/** True only when all four §10.2 gates pass. */
export function canPromote(input: UploadPromotionInput): boolean {
  return (
    hasRealChapterId(input) &&
    hasValidVariant(input) &&
    isNotNearDuplicate(input) &&
    sourceNotAiAnswered(input)
  );
}
