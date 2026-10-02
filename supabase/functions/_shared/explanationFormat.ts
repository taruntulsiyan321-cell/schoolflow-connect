/**
 * A proper explanation, as the owner ruled it (2026-10-02): the answer, the
 * working step by step, and for every wrong option, why it is wrong.
 *
 *     Answer: (B) <the right option>
 *
 *     <the working>
 *
 *     Why the other options are wrong:
 *     (A) <why>
 *     (C) <why>
 *     (D) <why>
 *
 * The database decides what passes: public.explanation_is_proper
 * (20261138000000), which keeps question_bank.explanation_status. This module
 * WRITES that shape and checks a draft against the same thresholds before it
 * is stored, so a model's thin answer is caught here and not left for the
 * rewrite queue. explanationFormat.test.ts reads the migration and fails if the
 * numbers drift, and runs the migration's own fixture through both.
 *
 * Pure: no Deno, no network.
 */

export const OPTION_LETTERS = "ABCDEFGH";
export const WRONG_HEADING = "Why the other options are wrong:";
/** explanation_is_proper: the working is at least this long… */
export const MIN_WORKING_CHARS = 120;
/** …and each wrong option's line at least this long. */
export const MIN_REASON_CHARS = 25;

export type ExplanationParts = {
  /** The working, step by step. May run over several lines. */
  working: string;
  /** One reason per wrong option, by its index in the options. */
  wrong: Array<{ index: number; reason: string }>;
};

export function letterOf(index: number): string {
  return OPTION_LETTERS[index] ?? "?";
}

/** "(B)" or "B" or "b" → 1; anything else → null. */
export function indexOfLetter(raw: unknown): number | null {
  const m = String(raw ?? "").trim().match(/^\(?([A-Ha-h])\)?\.?$/);
  return m ? OPTION_LETTERS.indexOf(m[1].toUpperCase()) : null;
}

const oneLine = (s: string) => s.replace(/\s+/g, " ").trim();

/** Paragraph breaks kept, everything else tidied; never a blank line run. */
function tidyWorking(s: string): string {
  return s
    .replace(/\r\n/g, "\n")
    .split(/\n{2,}/)
    .map((p) => p.split("\n").map((l) => l.replace(/[ \t]+/g, " ").trim()).filter(Boolean).join("\n"))
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

/** Why a draft falls short of the rule, or null when it meets it. */
export function explanationShortfall(options: string[], correctIndex: number, parts: ExplanationParts): string | null {
  if (options.length < 2 || options.length > OPTION_LETTERS.length) return "the question needs 2–8 options";
  if (!Number.isInteger(correctIndex) || correctIndex < 0 || correctIndex >= options.length) return "the answer is not one of the options";
  const working = tidyWorking(parts.working ?? "");
  if (working.length < MIN_WORKING_CHARS) return `the working is ${working.length} characters; it needs ${MIN_WORKING_CHARS}`;
  if (working.includes(WRONG_HEADING)) return "the working contains the wrong-options heading";
  for (let i = 0; i < options.length; i++) {
    if (i === correctIndex) continue;
    const reasons = parts.wrong.filter((w) => w.index === i);
    if (reasons.length !== 1) return `option ${letterOf(i)} needs exactly one reason`;
    const reason = oneLine(reasons[0].reason ?? "");
    if (reason.length < MIN_REASON_CHARS) return `the reason for option ${letterOf(i)} is too short`;
  }
  if (parts.wrong.some((w) => w.index === correctIndex)) return "the right option is listed as wrong";
  if (parts.wrong.some((w) => w.index < 0 || w.index >= options.length)) return "a reason names an option the question does not have";
  return null;
}

/**
 * The explanation in the ruled shape, or null when the draft falls short —
 * never a padded or partial one.
 */
export function composeExplanation(options: string[], correctIndex: number, parts: ExplanationParts): string | null {
  if (explanationShortfall(options, correctIndex, parts)) return null;
  const lines = [...parts.wrong]
    .sort((a, b) => a.index - b.index)
    .map((w) => `(${letterOf(w.index)}) ${oneLine(w.reason)}`);
  return [
    `Answer: (${letterOf(correctIndex)}) ${oneLine(String(options[correctIndex]))}`,
    "",
    tidyWorking(parts.working),
    "",
    WRONG_HEADING,
    ...lines,
  ].join("\n");
}

/** Asking for an explanation of a question whose answer is already settled. */
export function explainSystemPrompt(examLabel: string): string {
  return [
    `You are an expert teacher preparing students for ${examLabel}. Explain a multiple-choice question whose correct answer is given.`,
    "",
    "working: the full reasoning a good teacher writes on the board — start from the concept or rule, then each step to the answer; for a calculation, every step with its numbers. At least 3 sentences (120+ characters).",
    'wrong: one line for EACH other option saying exactly why it is wrong — the mistake or misconception that leads a student to it. 25+ characters each, never just "incorrect".',
    'Do not address "the student", and do not mention an answer key.',
    "",
    'Reply with JSON only: {"working":"…","wrong":[{"option":"A","reason":"…"},…]}',
  ].join("\n");
}

export function explainUserPrompt(q: {
  subject: string | null;
  chapter: string | null;
  topic: string | null;
  question: string;
  options: string[];
  correctIndex: number;
  previous: string | null;
}): string {
  return [
    q.subject ? `Subject: ${q.subject}` : "",
    q.chapter ? `Chapter: ${q.chapter}` : "",
    q.topic ? `Topic: ${q.topic}` : "",
    `Question: ${q.question}`,
    q.options.map((o, i) => `${letterOf(i)}. ${o}`).join("\n"),
    `Correct answer: (${letterOf(q.correctIndex)}) ${q.options[q.correctIndex]}`,
    q.previous && q.previous.trim().length > 20 ? `A note that came with the question (use only if it is right): ${q.previous.trim().slice(0, 1200)}` : "",
  ].filter(Boolean).join("\n");
}

/** A model's reply for one question's explanation, read leniently. */
export function readExplanationParts(raw: unknown): ExplanationParts | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as { working?: unknown; wrong?: unknown };
  if (typeof r.working !== "string" || !Array.isArray(r.wrong)) return null;
  const wrong: ExplanationParts["wrong"] = [];
  for (const w of r.wrong) {
    if (!w || typeof w !== "object") continue;
    const o = w as { option?: unknown; index?: unknown; reason?: unknown };
    const index = typeof o.index === "number" ? o.index : indexOfLetter(o.option);
    if (index == null || typeof o.reason !== "string") continue;
    wrong.push({ index, reason: o.reason });
  }
  return { working: r.working, wrong };
}
