/**
 * One-shot handoff so a result/question screen can tell Nova which question
 * the student was just looking at. Backed by sessionStorage (survives the
 * page navigation, cleared on tab close) — not a new persistence layer.
 */

export type NovaQuestionHandoff = {
  question: string;
  options?: string[];
  correctIndex?: number | null;
  subject?: string;
  chapter?: string;
  topic?: string;
};

const KEY = "gurukul.nova.question_context.v1";

export function setNovaQuestionContext(ctx: NovaQuestionHandoff): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(ctx));
  } catch {
    /* ignore quota/private-mode failures — Nova just won't have this context */
  }
}

/** Reads and clears the pending handoff — call once when Nova mounts a new conversation. */
export function consumeNovaQuestionContext(): NovaQuestionHandoff | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    if (!raw) return null;
    sessionStorage.removeItem(KEY);
    const parsed = JSON.parse(raw) as NovaQuestionHandoff;
    return parsed && typeof parsed.question === "string" ? parsed : null;
  } catch {
    return null;
  }
}
