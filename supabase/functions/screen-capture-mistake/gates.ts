/**
 * Stage-1 intake + §6.3–§6.5 verdict gates — pure, no Deno / model I/O.
 * Binding: docs/screen-capture-mistakes-spec.md §5.1, §5.2, §6.3–§6.5, §7.3
 *
 * Kept separate so vitest can import without modelRouter.
 */

export type IntakeDropReason =
  | "app_not_allowed"
  | "lecture_playing"
  | "missing_package";

export type VerdictDropReason =
  | "correct_answer"
  | "score_only"
  | "teacher_solve"
  | "no_student_verdict"
  | "not_wrong"
  | "unreadable";

export type FrameExtraction = {
  /** Model / OCR confidence 0..1 */
  confidence: number;
  /** True when the frame is a score summary with no per-question verdict (§6.5). */
  score_only: boolean;
  /** True when a teacher is solving on screen, not the student's attempt (§6.4). */
  teacher_solve: boolean;
  /** Present when a question was readable. */
  question_text: string | null;
  options: string[] | null;
  student_chosen_index: number | null;
  correct_index: number | null;
  correct_answer: string | null;
  /** Explicit right/wrong attached to the student's answer (§6.3). */
  student_was_wrong: boolean | null;
  /** screen = verdict visible on frame; ai = model inferred. */
  answer_source: "screen" | "ai" | null;
};

export type IntakeInput = {
  package_name: string | null | undefined;
  allowed_packages: string[];
  /** On-device §5.2 suspect — Stage 1 may set from client stillness/text heuristics. */
  is_lecture_suspect?: boolean;
};

/** §5.1 / §5.2 — drop BEFORE any read. read=false means the reader must not run. */
export function applyIntakeGates(
  input: IntakeInput,
): { ok: true } | { ok: false; reason: IntakeDropReason; read: false } {
  if (input.is_lecture_suspect === true) {
    return { ok: false, reason: "lecture_playing", read: false };
  }
  const pkg = (input.package_name ?? "").trim();
  if (!pkg) {
    return { ok: false, reason: "missing_package", read: false };
  }
  const allowed = new Set(
    (input.allowed_packages ?? []).map((p) => p.trim().toLowerCase()).filter(Boolean),
  );
  if (allowed.size === 0 || !allowed.has(pkg.toLowerCase())) {
    return { ok: false, reason: "app_not_allowed", read: false };
  }
  return { ok: true };
}

const CONFIDENCE_FLOOR = 0.55;

/**
 * §6.3–§6.5 after extraction. Captures ONLY wrong answers with the student's
 * own answer beside a right/wrong verdict.
 */
export function applyVerdictGates(
  raw: FrameExtraction,
):
  | { ok: true; extraction: FrameExtraction }
  | { ok: false; reason: VerdictDropReason; read: true } {
  if (!Number.isFinite(raw.confidence) || raw.confidence < CONFIDENCE_FLOOR) {
    return { ok: false, reason: "unreadable", read: true };
  }
  if (raw.score_only) {
    return { ok: false, reason: "score_only", read: true };
  }
  if (raw.teacher_solve) {
    return { ok: false, reason: "teacher_solve", read: true };
  }
  const q = (raw.question_text ?? "").trim();
  if (!q) {
    return { ok: false, reason: "no_student_verdict", read: true };
  }
  if (raw.student_was_wrong === null || raw.student_was_wrong === undefined) {
    return { ok: false, reason: "no_student_verdict", read: true };
  }
  if (raw.student_chosen_index == null && !(raw.correct_answer ?? "").trim()) {
    // Need the student's choice on screen (§6.3 / §6.4).
    return { ok: false, reason: "no_student_verdict", read: true };
  }
  if (raw.student_was_wrong === false) {
    return { ok: false, reason: "correct_answer", read: true };
  }
  return { ok: true, extraction: raw };
}

/** §7.3 — collapse duplicates by normalised question text. */
export function fingerprintQuestionText(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, "")
    .trim();
}
