/**
 * §7.1 — read one captured frame: question, student choice, correct, wrong?
 * Binding: docs/screen-capture-mistakes-spec.md §6.3–§6.5, §7.1
 */
import {
  completeWithQwen,
  isOpenRouterConfigured,
} from "../_shared/modelRouter.ts";
import type { FrameExtraction } from "./gates.ts";

const SYSTEM = [
  "You read ONE screenshot from a student's exam-prep app (e.g. Physics Wallah).",
  "Return ONLY one JSON object. No markdown fences. No commentary.",
  "",
  "Capture ONLY when the screen shows the STUDENT'S OWN answer AND a right/wrong",
  "verdict at the same time (screen-capture-mistakes-spec §6.3).",
  "",
  "Set score_only=true when you see a total score / marks summary WITHOUT",
  "per-question verdicts (§6.5). Do not invent which questions were wrong.",
  "",
  "Set teacher_solve=true when a teacher/lecturer is solving on screen (lecture,",
  "live class, solution walkthrough) and it is NOT the student's attempt (§6.4).",
  "",
  "Fields:",
  '- confidence: 0..1 how sure you are of the read',
  "- score_only: boolean",
  "- teacher_solve: boolean",
  "- question_text: string or null",
  "- options: string[] or null (MCQ choices in order)",
  "- student_chosen_index: 0-based index of the student's choice, or null",
  "- correct_index: 0-based correct option when visible, or null",
  "- correct_answer: string when non-MCQ / when index unavailable",
  "- student_was_wrong: true | false | null — null if no clear student verdict",
  '- answer_source: "screen" when the key/verdict is visible; "ai" only if you',
  "  must infer the correct option and the screen lacks it (rare for PW review)",
].join("\n");

function parseExtraction(text: string): FrameExtraction | null {
  const trimmed = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let obj: Record<string, unknown>;
  try {
    obj = JSON.parse(trimmed) as Record<string, unknown>;
  } catch {
    const start = trimmed.indexOf("{");
    const end = trimmed.lastIndexOf("}");
    if (start < 0 || end <= start) return null;
    try {
      obj = JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  const optionsRaw = obj.options;
  const options = Array.isArray(optionsRaw)
    ? optionsRaw.map((o) => String(o)).filter((s) => s.trim().length > 0)
    : null;

  const idx = (v: unknown): number | null => {
    if (typeof v === "number" && Number.isInteger(v) && v >= 0) return v;
    if (typeof v === "string" && /^\d+$/.test(v.trim())) return Number(v.trim());
    return null;
  };

  let student_was_wrong: boolean | null = null;
  if (typeof obj.student_was_wrong === "boolean") {
    student_was_wrong = obj.student_was_wrong;
  }

  const answer_source =
    obj.answer_source === "ai" || obj.answer_source === "screen"
      ? obj.answer_source
      : null;

  return {
    confidence:
      typeof obj.confidence === "number" && Number.isFinite(obj.confidence)
        ? Math.max(0, Math.min(1, obj.confidence))
        : 0,
    score_only: obj.score_only === true,
    teacher_solve: obj.teacher_solve === true,
    question_text:
      typeof obj.question_text === "string" && obj.question_text.trim()
        ? obj.question_text.trim()
        : null,
    options: options && options.length > 0 ? options : null,
    student_chosen_index: idx(obj.student_chosen_index),
    correct_index: idx(obj.correct_index),
    correct_answer:
      typeof obj.correct_answer === "string" && obj.correct_answer.trim()
        ? obj.correct_answer.trim()
        : null,
    student_was_wrong,
    answer_source,
  };
}

export async function extractFrame(imageDataUri: string): Promise<
  | { ok: true; extraction: FrameExtraction }
  | { ok: false; error: string }
> {
  if (!isOpenRouterConfigured()) {
    return { ok: false, error: "openrouter_not_configured" };
  }
  const result = await completeWithQwen({
    system: SYSTEM,
    user: "Extract the capture fields from this single frame.",
    images: [imageDataUri],
    max_tokens: 900,
    temperature: 0.1,
    budget_tier: "medium",
  });
  if (!result.ok) {
    return { ok: false, error: result.error };
  }
  const extraction = parseExtraction(result.text);
  if (!extraction) {
    return { ok: false, error: "unparseable_extraction" };
  }
  return { ok: true, extraction };
}
