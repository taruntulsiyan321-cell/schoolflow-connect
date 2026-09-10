/**
 * Presentation boundary — the single primitive that converts an arbitrary
 * runtime value into text that is safe to show a user.
 *
 * WHY THIS EXISTS
 * ---------------
 * Every previous defect in this class had the same shape: some component
 * rendered `{value}` where `value` came straight out of Postgres, an RPC, an
 * AI reply, or a caught `Error`. When the value was not what the author
 * assumed, the user saw an internal representation — a UUID, `half_day`,
 * `[object Object]`, `undefined`, or a raw PostgREST message naming a table.
 *
 * The fix is not "check harder at each call site". It is to make one function
 * the only supported way to turn an unknown value into user-facing text, and
 * to make that function fail closed: when a value cannot be presented safely,
 * it returns an intentional fallback instead of leaking the raw value.
 *
 * This module is deliberately dependency-light (only the encoding repair SSOT)
 * so it can be used from services, hooks, components and tests alike.
 */

import { repairUtf8Mojibake, looksLikeUtf8Mojibake } from "@/lib/utf8MojibakeRepair";

/** The house fallback for "we have nothing safe to show here". */
export const NOT_AVAILABLE = "—";

/**
 * Strings that are always the result of a bug rather than real content.
 * Compared case-insensitively against the trimmed value.
 */
const LEAKED_INTERNAL_TOKENS = new Set([
  "undefined",
  "null",
  "nan",
  "[object object]",
  "[object array]",
  "[object promise]",
  "[object null]",
  "[object undefined]",
  "infinity",
  "-infinity",
]);

/** Canonical UUID — never a human-facing label on its own. */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * A truncated UUID head, e.g. `3f2a9c11`. Historically used as a "name"
 * fallback (`id.slice(0, 8)`), which is exactly the leak we are closing.
 */
const UUID_FRAGMENT_RE = /^[0-9a-f]{8,}$/i;

/** JSON-ish payloads that must never reach a text node. */
const JSON_SHAPED_RE = /^\s*[[{][\s\S]*[\]}]\s*$/;

/** U+FFFD is decoder output for bytes that could not be interpreted at all. */
const REPLACEMENT_CHAR_RE = /\uFFFD/;

/** C0/C1 control characters (excluding tab/newline/CR) left by broken encoders. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHAR_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/;

export type DisplayKind =
  /** Free text: sentences, descriptions, AI prose. */
  | "text"
  /** A short label: subject, chapter, status, badge. */
  | "label"
  /** A person / entity name. UUID-shaped values are rejected. */
  | "name";

export interface DisplayTextOptions {
  /** Shown when the value cannot be presented safely. Defaults to an em dash. */
  fallback?: string;
  /** What the value is meant to be. Tightens the rules. Defaults to `text`. */
  kind?: DisplayKind;
  /**
   * Permit an empty string result instead of substituting the fallback.
   * Only for callers that render their own empty state.
   */
  allowEmpty?: boolean;
  /** Hard cap; longer values are truncated on a word boundary with an ellipsis. */
  maxLength?: number;
}

export interface DisplayTextResult {
  /** Always safe to render. */
  text: string;
  /** True when the input was rejected and `text` is the fallback. */
  usedFallback: boolean;
  /** Present when rejected — why, for dev warnings and tests. */
  reason?:
    | "nullish"
    | "empty"
    | "not-a-primitive"
    | "leaked-internal-token"
    | "json-shaped"
    | "uuid"
    | "unrepairable-encoding"
    | "control-characters"
    | "non-finite-number";
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  const cut = value.slice(0, maxLength);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > maxLength * 0.6 ? cut.slice(0, lastSpace) : cut;
  return `${base.trimEnd()}…`;
}

/**
 * Collapse whitespace and strip characters that only ever appear because an
 * encoding went wrong. Legitimate content — including Devanagari, maths glyphs
 * and emoji — is left untouched.
 */
function normalizeWhitespace(value: string): string {
  return value
    .replace(/\u00AD/g, "") // soft hyphen
    .replace(/[\u200B-\u200D\uFEFF]/g, "") // zero-width joiners / BOM
    .replace(/[ \t\u00A0]+/g, " ")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .trim();
}

/**
 * Convert any value into text that is safe to display, or an intentional
 * fallback. This is the boundary: nothing else in the app should coerce an
 * unknown value to a string for display.
 */
export function describeDisplayText(
  value: unknown,
  options: DisplayTextOptions = {},
): DisplayTextResult {
  const {
    fallback = NOT_AVAILABLE,
    kind = "text",
    allowEmpty = false,
    maxLength,
  } = options;

  const reject = (reason: DisplayTextResult["reason"]): DisplayTextResult => ({
    text: fallback,
    usedFallback: true,
    reason,
  });

  if (value == null) return reject("nullish");

  // --- Non-string primitives ------------------------------------------------
  if (typeof value === "number") {
    if (!Number.isFinite(value)) return reject("non-finite-number");
    return { text: String(value), usedFallback: false };
  }
  if (typeof value === "bigint") {
    return { text: value.toString(), usedFallback: false };
  }
  if (typeof value === "boolean") {
    return { text: value ? "Yes" : "No", usedFallback: false };
  }
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) return reject("non-finite-number");
    return { text: value.toISOString().slice(0, 10), usedFallback: false };
  }

  // --- Anything else non-string is a programming error, never text ----------
  // Objects, arrays, functions, symbols, Promises. Historically these became
  // "[object Object]" via String() or template interpolation.
  if (typeof value !== "string") return reject("not-a-primitive");

  // --- Strings --------------------------------------------------------------
  let text = value;

  // Repair the known UTF-8-as-CP1252 corruption before judging the string.
  text = repairUtf8Mojibake(text);
  text = normalizeWhitespace(text);

  if (!text) return allowEmpty ? { text: "", usedFallback: false } : reject("empty");

  // Corruption that survived repair must never be shown.
  if (REPLACEMENT_CHAR_RE.test(text) || looksLikeUtf8Mojibake(text)) {
    return reject("unrepairable-encoding");
  }
  if (CONTROL_CHAR_RE.test(text)) return reject("control-characters");

  const lowered = text.toLowerCase();
  if (LEAKED_INTERNAL_TOKENS.has(lowered)) return reject("leaked-internal-token");

  // A serialized payload reached a text node.
  if (JSON_SHAPED_RE.test(text)) return reject("json-shaped");

  // Identifiers are never a label a human should read.
  if (UUID_RE.test(text)) return reject("uuid");
  if (kind === "name" && UUID_FRAGMENT_RE.test(text) && text.length >= 8) {
    return reject("uuid");
  }

  if (maxLength != null) text = truncate(text, maxLength);

  return { text, usedFallback: false };
}

/**
 * The everyday entry point: an always-safe string for rendering.
 *
 * ```tsx
 * <span>{toDisplayText(student.fullName, { kind: "name" })}</span>
 * ```
 */
export function toDisplayText(value: unknown, options?: DisplayTextOptions): string {
  return describeDisplayText(value, options).text;
}

/** True when the value would be rejected by the presentation boundary. */
export function isDisplaySafe(value: unknown, options?: DisplayTextOptions): boolean {
  return !describeDisplayText(value, options).usedFallback;
}

/** True for values that are identifiers rather than content. */
export function isIdentifierLike(value: unknown): boolean {
  if (typeof value !== "string") return false;
  const s = value.trim();
  return UUID_RE.test(s) || (UUID_FRAGMENT_RE.test(s) && s.length >= 8);
}

/**
 * A measured percentage, or the not-available dash when it was not measured.
 *
 * CHUNK 10.7. This existed twice — identically — as a local `pctOrDash` in
 * `PrincipalLiveAcademic.tsx` and `LiveClassPanels.tsx`, and turning on
 * strictNullChecks was about to require it in six more files. Two homes for one
 * rendering is G9's shape; eight would have guaranteed that some screen
 * eventually rendered the absent case differently from the rest.
 *
 * WHY THIS IS A PRESENTATION CONCERN AND NOT ARITHMETIC
 *
 * `Math.round(null)` is 0, and `${null}%` is "null%". Both are what happens when
 * a nullable metric reaches a template without passing through here — the first
 * silently, which is worse. The null contract only holds if "not measured" has
 * exactly ONE rendering, and this is it.
 *
 * NaN and Infinity are treated as not-measured rather than printed: a figure
 * that came out of a division by zero is not a measurement either.
 */
export function toPercentLabel(
  value: number | null | undefined,
  options: { digits?: number; fallback?: string } = {},
): string {
  const { digits = 0, fallback = NOT_AVAILABLE } = options;
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  // `Math.round` at 0 digits, deliberately: that is what both of the local
  // copies this replaces did, and `toFixed(0)` is not identical to it on every
  // input. Converging two renderings must not quietly become a third.
  return digits === 0 ? `${Math.round(value)}%` : `${value.toFixed(digits)}%`;
}

/**
 * A measured number, or the dash. The same contract as `toPercentLabel` without
 * the unit — for counts that can be genuinely absent, such as "marks pending"
 * on a teacher who has no exam to enter marks for.
 *
 * Note the difference from a measured zero: a count that IS zero passes through
 * as "0". Only null, undefined and non-finite values become the dash.
 */
export function toCountLabel(
  value: number | null | undefined,
  fallback = NOT_AVAILABLE,
): string {
  if (value === null || value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return String(value);
}
