/**
 * Error presentation boundary.
 *
 * WHY THIS EXISTS
 * ---------------
 * `repository/base.ts#throwIfError` wraps the raw PostgREST/Postgres `message`
 * in an `AcademicRepositoryError`. Panels then did:
 *
 *     catch (e) { setError(e instanceof Error ? e.message : "Failed to load") }
 *     ...
 *     {error && <div>{error}</div>}
 *
 * which rendered database text straight to the user — messages that name
 * tables, columns and constraints:
 *
 *     new row violates row-level security policy for table "leave_requests"
 *     duplicate key value violates unique constraint "students_school_admission_uidx"
 *     Could not find the function public.rpc_weak_areas_v2(...) in the schema cache
 *
 * `toUserMessage` is the only supported way to turn a caught value into text
 * for a user. It classifies by SQLSTATE rather than trusting prose, so a new
 * database error can never introduce a new leak.
 *
 * IMPORTANT: this codebase raises ~190 deliberately user-facing messages from
 * PL/pgSQL (`RAISE EXCEPTION 'Join a class to play the Daily Challenge'`).
 * Those arrive as SQLSTATE `P0001` and ARE passed through — after redacting any
 * interpolated identifiers, because several of them substitute raw ids via `%`.
 */

import { toDisplayText, NOT_AVAILABLE } from "./safeText";

/** House fallback when nothing specific and safe can be said. */
export const GENERIC_ERROR_MESSAGE = "Something went wrong. Please try again.";

/** Longest message we will ever show; DB prose can be very long. */
const MAX_MESSAGE_LENGTH = 220;

/**
 * SQLSTATE / PostgREST codes mapped to messages written for a school user.
 * Anything not listed here falls back to the generic message — fail closed.
 */
const CODE_MESSAGES: Record<string, string> = {
  // --- Integrity -----------------------------------------------------------
  "23505": "That record already exists.",
  "23503": "This is still linked to other records, so it can't be changed.",
  "23502": "A required field is missing.",
  "23514": "One of the values isn't valid.",
  "22P02": "One of the values isn't in the expected format.",
  "22001": "One of the values is too long.",
  "22003": "A number is outside the allowed range.",

  // --- Authorisation -------------------------------------------------------
  "42501": "You don't have permission for this action. Contact your school admin.",
  "PGRST301": "Your session has expired. Please sign in again.",

  // --- Schema / deployment drift (never describe the schema to a user) -----
  "42P01": "This feature isn't available right now.",
  "42703": "This feature isn't available right now.",
  "42883": "This feature isn't available right now.",
  PGRST202: "This feature isn't available right now.",
  PGRST204: "This feature isn't available right now.",

  // --- Availability --------------------------------------------------------
  "40001": "The system was busy. Please try again.",
  "40P01": "The system was busy. Please try again.",
  "57014": "That took too long. Please try again.",
  "53300": "The system is busy right now. Please try again shortly.",
  "08006": "Connection lost. Check your network and try again.",
  "08003": "Connection lost. Check your network and try again.",
};

/**
 * Codes whose message text is authored by this application (PL/pgSQL
 * `RAISE EXCEPTION`) and is intended for the user.
 */
const APP_AUTHORED_CODES = new Set(["P0001"]);

/** Application error codes raised by the repository/service layer. */
const APP_ERROR_CODES = new Set([
  "validation_failed",
  "not_found",
  "tenant_violation",
]);

/**
 * Prose that proves a message came from the database/driver rather than from a
 * person. Any hit means we never show the message itself.
 */
const DB_NOISE_PATTERNS: RegExp[] = [
  /\brow-level security\b/i,
  /\bviolates\b.*\bconstraint\b/i,
  /\bduplicate key value\b/i,
  /\brelation\b\s+"/i,
  /\bcolumn\b\s+"/i,
  /\btable\b\s+"/i,
  /\bschema cache\b/i,
  /\bpublic\.[a-z_]+\(/i,
  /\bSELECT\b.*\bFROM\b/i,
  /\bINSERT INTO\b/i,
  /\bUPDATE\b.*\bSET\b/i,
  /\bpg_[a-z_]+\b/i,
  /\bSQLSTATE\b/i,
  /\bstack depth\b/i,
  /\bJWS?\b.*\b(invalid|expired|malformed)\b/i,
  /\bfetch failed\b/i,
  /\bTypeError\b|\bReferenceError\b|\bSyntaxError\b/,
  /\bat\s+\w+\s+\(.*:\d+:\d+\)/, // stack frames
];

/** Identifiers that must be scrubbed out of an otherwise-safe message. */
const UUID_ANYWHERE_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

interface ErrorLike {
  message?: unknown;
  code?: unknown;
  status?: unknown;
  details?: unknown;
  hint?: unknown;
  error_description?: unknown;
  name?: unknown;
}

function asErrorLike(value: unknown): ErrorLike | null {
  if (value == null) return null;
  if (typeof value === "object") return value as ErrorLike;
  return null;
}

function readCode(err: ErrorLike): string | null {
  const raw = err.code;
  if (typeof raw === "string" && raw.trim()) return raw.trim();
  if (typeof raw === "number") return String(raw);
  return null;
}

/**
 * Strip identifiers and trailing driver detail from an app-authored message,
 * then run it through the display boundary.
 */
function sanitizeAuthoredMessage(message: string): string | null {
  let text = message.replace(UUID_ANYWHERE_RE, "").replace(/\s{2,}/g, " ").trim();
  // PL/pgSQL sometimes appends context after a newline; keep the first line.
  text = text.split("\n")[0].trim();
  // A message reduced to punctuation by redaction is not worth showing.
  if (!/[a-z]/i.test(text)) return null;
  const safe = toDisplayText(text, { maxLength: MAX_MESSAGE_LENGTH, fallback: "" });
  return safe || null;
}

/** True when the message is clearly machine-generated. */
export function looksLikeDatabaseNoise(message: string): boolean {
  return DB_NOISE_PATTERNS.some((re) => re.test(message));
}

export interface UserMessageOptions {
  /** Shown when nothing safe and specific can be derived. */
  fallback?: string;
}

/**
 * Turn any caught value into a message that is safe to show a user.
 *
 * Never returns raw database, driver or stack text. Unrecognised errors
 * collapse to `fallback` (default: the house generic message).
 */
export function toUserMessage(error: unknown, options: UserMessageOptions = {}): string {
  const fallback = options.fallback ?? GENERIC_ERROR_MESSAGE;

  if (error == null) return fallback;

  // A plain string thrown by app code is treated as authored copy.
  if (typeof error === "string") {
    if (looksLikeDatabaseNoise(error)) return fallback;
    return sanitizeAuthoredMessage(error) ?? fallback;
  }

  const err = asErrorLike(error);
  if (!err) return fallback;

  const code = readCode(err);
  const rawMessage =
    typeof err.message === "string"
      ? err.message
      : typeof err.error_description === "string"
        ? err.error_description
        : "";

  // 1. Application-authored database exceptions are meant for the user.
  if (code && APP_AUTHORED_CODES.has(code) && rawMessage) {
    if (!looksLikeDatabaseNoise(rawMessage)) {
      const authored = sanitizeAuthoredMessage(rawMessage);
      if (authored) return authored;
    }
    return fallback;
  }

  // 2. Application error classes from the repository/service layer.
  if (code && APP_ERROR_CODES.has(code) && rawMessage) {
    const authored = sanitizeAuthoredMessage(rawMessage);
    if (authored) return authored;
  }

  // 3. Known database / transport codes get a house message.
  if (code && CODE_MESSAGES[code]) return CODE_MESSAGES[code];

  // 4. HTTP-ish statuses from edge functions and auth.
  const status = typeof err.status === "number" ? err.status : null;
  if (status === 401) return "Your session has expired. Please sign in again.";
  if (status === 403) {
    return "You don't have permission for this action. Contact your school admin.";
  }
  if (status === 404) return "This feature isn't available right now.";
  if (status === 408 || status === 504) return "That took too long. Please try again.";
  if (status === 429) return "Too many attempts. Please wait a moment and try again.";
  if (status != null && status >= 500) {
    return "The service is temporarily unavailable. Please try again.";
  }

  // 5. Network failures surface as a bare TypeError from fetch.
  if (
    rawMessage &&
    /\b(failed to fetch|network ?error|load failed|networkerror)\b/i.test(rawMessage)
  ) {
    return "Network error. Check your connection and try again.";
  }

  // 6. Anything that still smells like the database never reaches the user.
  if (!rawMessage || looksLikeDatabaseNoise(rawMessage)) return fallback;

  // 7. An unrecognised error with an unsuspicious message: show it, sanitized.
  //    Errors carrying a database code are excluded — an unmapped SQLSTATE
  //    means we do not yet know the message is safe.
  if (code && /^(?:[0-9A-Z]{5}|PGRST\d{3})$/.test(code)) return fallback;

  return sanitizeAuthoredMessage(rawMessage) ?? fallback;
}

/**
 * Convenience for the very common panel shape:
 * `catch (e) { setError(toErrorMessage(e, "Failed to load homework")) }`
 */
export function toErrorMessage(error: unknown, fallback: string): string {
  return toUserMessage(error, { fallback });
}

/** A short, safe label for inline slots that cannot fit a sentence. */
export function toErrorLabel(error: unknown): string {
  const msg = toUserMessage(error, { fallback: "" });
  return msg || NOT_AVAILABLE;
}
