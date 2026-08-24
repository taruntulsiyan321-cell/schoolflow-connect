/**
 * AI output presentation boundary.
 *
 * WHY THIS EXISTS
 * ---------------
 * `src/academic/ai/responseValidator.ts#validateModelResponse` exists, but an
 * audit of every `.tsx` render path found it has zero call sites in the UI.
 * Model output therefore reached `NovaMarkdown` — and several plain `{...}`
 * text nodes — completely unscreened.
 *
 * A language model can emit things that are not an answer: a JSON envelope it
 * was supposed to unwrap, a tool-call block, an internal id, a raw provider
 * error, or a half-written code fence. Rendering those as prose shows the
 * student the machinery instead of the reply.
 *
 * This module decides what is presentable. It does NOT try to repair meaning —
 * when output is not usable prose it says so, and the caller shows an
 * intentional message rather than a mangled one.
 */

import { toDisplayText } from "./safeText";

/** Bare identifiers have no place in an answer written for a student. */
const UUID_ANYWHERE_RE =
  /[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/gi;

/** Tool-call / function-call envelopes some models emit inline. */
const TOOL_BLOCK_RE =
  /<\/?(?:tool_call|tool_use|function_call|function_results?|antml:[a-z_]+)[^>]*>[\s\S]*?(?:<\/(?:tool_call|tool_use|function_call|function_results?|antml:[a-z_]+)>|$)/gi;

/** Stray opening/closing tags left after a truncated stream. */
const ORPHAN_TAG_RE =
  /<\/?(?:tool_call|tool_use|function_call|function_results?|thinking|scratchpad)[^>]*>/gi;

/** Internal scaffolding a model sometimes echoes back. */
const INTERNAL_MARKER_RE =
  /^\s*(?:system prompt|developer message|assistant:|system:|<\|[a-z_]+\|>)\s*$/gim;

/** An entire reply that is really a serialized payload. */
function isWholeJsonPayload(text: string): boolean {
  const t = text.trim();
  if (!/^[[{]/.test(t) || !/[\]}]$/.test(t)) return false;
  try {
    JSON.parse(t);
    return true;
  } catch {
    // Not valid JSON, but still an unclosed payload rather than prose when it
    // has no sentence punctuation at all.
    return t.length > 40 && !/[.!?]\s/.test(t);
  }
}

/** Count fence markers so a truncated stream does not break the renderer. */
function balanceCodeFences(text: string): string {
  const fences = (text.match(/^```/gm) ?? []).length;
  return fences % 2 === 0 ? text : `${text}\n\`\`\``;
}

export interface AssistantTextResult {
  /** Markdown that is safe to hand to the renderer. Empty when unusable. */
  markdown: string;
  /** True when nothing presentable survived screening. */
  unusable: boolean;
  /** Why it was rejected — for dev diagnostics and tests. */
  reason?: "empty" | "not-a-string" | "json-payload" | "only-machinery";
}

/**
 * Screen model output before it is rendered as markdown.
 *
 * Deliberately conservative: it removes machinery and identifiers, and rejects
 * whole-payload replies. It does not rewrite the model's words.
 */
export function toAssistantMarkdown(value: unknown): AssistantTextResult {
  if (value != null && typeof value !== "string") {
    return { markdown: "", unusable: true, reason: "not-a-string" };
  }

  // Checked before the generic boundary so the reason is accurate: the
  // boundary also rejects JSON-shaped text, but reports it as "empty" here.
  if (typeof value === "string" && isWholeJsonPayload(value)) {
    return { markdown: "", unusable: true, reason: "json-payload" };
  }

  const screened = toDisplayText(value, { fallback: "", allowEmpty: true });
  if (!screened) return { markdown: "", unusable: true, reason: "empty" };

  let text = screened
    .replace(TOOL_BLOCK_RE, "")
    .replace(ORPHAN_TAG_RE, "")
    .replace(INTERNAL_MARKER_RE, "")
    .replace(UUID_ANYWHERE_RE, "")
    // A stringified object that slipped into the model's own text.
    .replace(/\[object (?:Object|Array|Promise)\]/g, "")
    // Collapse the blank lines those removals leave behind.
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  if (!text || !/[\p{L}\p{N}]/u.test(text)) {
    return { markdown: "", unusable: true, reason: "only-machinery" };
  }

  text = balanceCodeFences(text);
  return { markdown: text, unusable: false };
}

/** Convenience: the markdown alone, empty string when unusable. */
export function toAssistantText(value: unknown): string {
  return toAssistantMarkdown(value).markdown;
}

/** Inline markdown emphasis a model adds to what should be a plain line. */
const INLINE_MARKDOWN_RE = /(\*\*|__|`|~~)/g;

/**
 * A single line of model-written prose for a heading, bullet or callout —
 * places that render a bare `{value}` and cannot handle block markdown.
 *
 * Strips the machinery `toAssistantMarkdown` removes, then flattens inline
 * markdown so `**Great work**` reads as `Great work` rather than showing the
 * asterisks. Returns an intentional fallback when nothing usable remains.
 */
export function toAiLine(value: unknown, fallback = ""): string {
  const { markdown, unusable } = toAssistantMarkdown(value);
  if (unusable) return fallback;
  return markdown
    .replace(/```[\s\S]*?```/g, "")
    .replace(INLINE_MARKDOWN_RE, "")
    .replace(/\s*\n+\s*/g, " ")
    .trim() || fallback;
}
