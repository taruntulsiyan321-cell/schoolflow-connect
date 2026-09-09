/**
 * An answer is a POSITION, not a word — turn it back into the word.
 *
 * `test_questions.correct` and `test_answers.response` are jsonb, and for the
 * formats this product auto-marks they hold an index into the option list:
 *
 *     { "indexes": [1] }        the second option
 *     { "text": "…" }           free text (short / long / fill)
 *     { "value": 12 }           numerical
 *     { "correct_index": 1 }    a legacy shape still present in seeded rows
 *
 * All 576 legacy `test_questions` rows once stored the LABEL instead of the
 * position and could never be marked right (`20260914110000`), so the position
 * form is the one that means anything, and it means nothing without the option
 * list beside it. `String(response)` on any of these renders "[object Object]",
 * which is the rendering-integrity defect one layer below the DOM.
 *
 * Returns `null` — never a guess and never an empty string — when the payload
 * cannot be read. The caller decides what "we cannot show this" looks like;
 * this function will not invent a blank that reads like "they left it empty".
 */

/** The option list as an array of strings, or `null` when it is not one. */
function toOptionList(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null;
  return options.map((o) => (typeof o === "string" ? o : String(o ?? "")));
}

export function answerToText(value: unknown, options: unknown): string | null {
  if (value === null || value === undefined) return null;

  // A bare string or number is already the answer.
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (typeof value !== "object") return null;
  const v = value as {
    indexes?: unknown;
    text?: unknown;
    value?: unknown;
    correct_index?: unknown;
  };

  const list = toOptionList(options);

  const positions: number[] = Array.isArray(v.indexes)
    ? v.indexes.filter((i): i is number => typeof i === "number" && Number.isInteger(i))
    : typeof v.correct_index === "number" && Number.isInteger(v.correct_index)
      ? [v.correct_index]
      : [];

  if (positions.length) {
    if (!list) return null;
    // An index outside the list is a broken row, not an answer. Drop it rather
    // than render "undefined" — and if nothing survives, say nothing.
    const words = positions
      .map((i) => (i >= 0 && i < list.length ? list[i] : null))
      .filter((w): w is string => typeof w === "string" && w.trim() !== "");
    return words.length ? words.join(" · ") : null;
  }

  if (typeof v.text === "string" && v.text.trim()) return v.text.trim();
  if (typeof v.value === "number" && Number.isFinite(v.value)) return String(v.value);
  if (typeof v.value === "string" && v.value.trim()) return v.value.trim();

  return null;
}
