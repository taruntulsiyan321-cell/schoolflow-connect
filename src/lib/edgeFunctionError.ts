/**
 * Read the JSON body an edge function returned with a non-2xx status.
 *
 * WHY THIS EXISTS. `supabase.functions.invoke` rejects any non-2xx into
 * `error` and leaves `data` null. The thrown `FunctionsHttpError` stringifies
 * to "Edge Function returned a non-2xx status code" — the SERVER'S MESSAGE IS
 * NOT IN IT. It is in `error.context`, an undrained `Response`.
 *
 * So `dpp-generate-questions` returning
 *   429 { "error": "Daily AI generation budget ... has been reached" }
 * reached the teacher as "Question generation failed". The budget message was
 * written, sent, and thrown away at the last step. Measured 2026-09-06: no file
 * in `src/` referenced `FunctionsHttpError` or `error.context`, so this was
 * true of every edge-function call site in the app, not just this one.
 *
 * `context` is a Response and can only be read ONCE. It is cloned before
 * reading so a caller that also inspects it is not handed a drained body.
 */

export type EdgeFunctionFailure = {
  /** HTTP status, when one could be recovered. */
  status: number | null;
  /** The function's own `error` string, when it sent one. */
  message: string | null;
  /** The function's own `error_code`, for branching without parsing prose. */
  errorCode: string | null;
  /** Whatever else the body carried, for callers that need a detail. */
  body: Record<string, unknown> | null;
};

function isResponseLike(v: unknown): v is Response {
  return (
    typeof v === "object" && v !== null &&
    typeof (v as Response).status === "number" &&
    typeof (v as Response).text === "function"
  );
}

/**
 * Never throws and never rejects. A failure to read the failure must not
 * replace the caller's real error with a parsing error — callers fall back to
 * their own message when every field comes back null.
 */
export async function readEdgeFunctionError(error: unknown): Promise<EdgeFunctionFailure> {
  const empty: EdgeFunctionFailure = { status: null, message: null, errorCode: null, body: null };

  const ctx = (error as { context?: unknown } | null)?.context;
  if (!isResponseLike(ctx)) return empty;

  const status = typeof ctx.status === "number" ? ctx.status : null;

  let raw = "";
  try {
    // Clone first: a Response body is single-use, and draining the caller's
    // copy to build an error message would be a nasty thing to leave behind.
    raw = await (typeof ctx.clone === "function" ? ctx.clone() : ctx).text();
  } catch {
    return { ...empty, status };
  }
  if (!raw.trim()) return { ...empty, status };

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // A non-JSON body is still evidence; hand back a trimmed form of it.
    return { status, message: raw.trim().slice(0, 300), errorCode: null, body: null };
  }
  if (typeof parsed !== "object" || parsed === null) return { ...empty, status };

  const body = parsed as Record<string, unknown>;
  const message = typeof body.error === "string" && body.error.trim() ? body.error : null;
  const errorCode = typeof body.error_code === "string" && body.error_code.trim()
    ? body.error_code
    : null;

  return { status, message, errorCode, body };
}

/**
 * The message to show a user for a failed edge-function call: the function's
 * own words when it sent any, the caller's fallback otherwise.
 */
export async function edgeFunctionErrorMessage(error: unknown, fallback: string): Promise<string> {
  const failure = await readEdgeFunctionError(error);
  return failure.message ?? fallback;
}
