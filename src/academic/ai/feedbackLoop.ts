/**
 * AI Feedback Loop — capture like/accept/retry signals for later prompt eval.
 * Never auto-promotes prompts; redacts free-text comments.
 */

export type FeedbackSignalType =
  | "like"
  | "dislike"
  | "useful"
  | "not_useful"
  | "accept"
  | "reject"
  | "edit"
  | "retry"
  | "dismiss"
  | "complete"
  | "show_full_solution"
  | "correction";

export type FeedbackTargetKind = "response" | "recommendation" | "artifact" | "prompt";

export type FeedbackSignalInput = {
  request_id?: string | null;
  school_id?: string | null;
  actor_user_id: string;
  actor_role?: string | null;
  feature_id?: string | null;
  signal_type: FeedbackSignalType;
  target_kind?: FeedbackTargetKind;
  target_ref?: string | null;
  rating?: number | null;
  comment?: string | null;
  metadata?: Record<string, unknown>;
};

export type FeedbackSignalRow = {
  request_id: string | null;
  school_id: string | null;
  actor_user_id: string;
  actor_role: string | null;
  feature_id: string | null;
  signal_type: FeedbackSignalType;
  target_kind: FeedbackTargetKind;
  target_ref: string | null;
  rating: number | null;
  comment_redacted: string | null;
  metadata: Record<string, unknown>;
};

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const PHONE_RE = /\b\+?\d[\d\s\-()]{7,}\d\b/g;
const UUID_RE =
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/gi;

/** Strip obvious PII from free-text feedback before persistence. */
export function redactFeedbackComment(comment: string | null | undefined): string | null {
  if (!comment) return null;
  let t = comment.trim().slice(0, 500);
  if (!t) return null;
  t = t.replace(EMAIL_RE, "[redacted-email]");
  t = t.replace(PHONE_RE, "[redacted-phone]");
  t = t.replace(UUID_RE, "[redacted-id]");
  return t;
}

export function buildFeedbackRow(input: FeedbackSignalInput): FeedbackSignalRow {
  const rating =
    typeof input.rating === "number" && input.rating >= 1 && input.rating <= 5
      ? Math.round(input.rating)
      : null;

  return {
    request_id: input.request_id ?? null,
    school_id: input.school_id ?? null,
    actor_user_id: input.actor_user_id,
    actor_role: input.actor_role ?? null,
    feature_id: input.feature_id ?? null,
    signal_type: input.signal_type,
    target_kind: input.target_kind ?? "response",
    target_ref: input.target_ref ?? null,
    rating,
    comment_redacted: redactFeedbackComment(input.comment),
    metadata: input.metadata ?? {},
  };
}

/**
 * Persist a feedback signal. Returns the row written (or built locally on failure).
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function captureFeedbackSignal(
  client: any,
  input: FeedbackSignalInput,
): Promise<{ ok: boolean; row: FeedbackSignalRow; error?: string }> {
  const row = buildFeedbackRow(input);
  try {
    const { error } = await client.from("ai_feedback_signals").insert(row);
    if (error) {
      return { ok: false, row, error: String(error.message ?? error) };
    }
    return { ok: true, row };
  } catch (e) {
    return {
      ok: false,
      row,
      error: e instanceof Error ? e.message : "feedback_insert_failed",
    };
  }
}
