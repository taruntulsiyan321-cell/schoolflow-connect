/**
 * An answer is a POSITION, not a word — turn it back into the word, or into the
 * position, from whichever shape the row happens to carry.
 *
 * `test_questions.correct`, `test_answers.response`, `student_mistakes.
 * correct_answer` and `student_mistakes.student_answer` are all jsonb, and
 * between them they hold SIX shapes. Measured on production, 2026-09-15:
 *
 *     { "index": 1, "text": "…" }        58 mistake rows — what practice writes
 *     { "indexes": [1] }                  9 mistake rows — the test path
 *     { "text": "…" }                     free text (short / long / fill)
 *     { "value": 12 }                     numerical
 *     { "correct_index": 1 }              a legacy shape, 0 rows left
 *     "C"                                483 mistake rows — a retired backfill,
 *                                        stored with options = null
 *
 * ── WHY THIS FILE IS THE ONLY DECODER ────────────────────────────────────────
 *
 * It was not. Four call sites each wrote their own, and three of them read a
 * key that matches NOTHING in the table:
 *
 *   MistakeBook.answerIndex      correct_index | indexes   → resolved 9 of 550
 *   mistakeRecovery              correct_index             → resolved 0 of 550
 *   analyticsInsights            correct_index             → resolved 0 of 550
 *
 * The cost was not cosmetic. The Mistake Book compares the option a student
 * clicks against this index; with the index null, EVERY answer scored wrong,
 * the retry could never reach the 70% that clears an entry, and so no entry
 * could ever leave the book. That is one of the two exits the spec allows —
 * and above the relearn boundary it is the only one — so chapters sat at 9, 12
 * and 26 open mistakes with no reachable way down.
 *
 * `index` was never added here because this file was written for the test
 * tables and practice grew its own shape afterwards. That is exactly the
 * failure mode of a decoder per consumer: the shapes drift and nobody owns the
 * union. So every reader now comes through these two functions, and a new
 * shape is added HERE, once.
 *
 * Both return `null` — never a guess, never an empty string — when the payload
 * cannot be read. The caller decides what "we cannot show this" looks like;
 * neither will invent a blank that reads like "they left it empty", nor
 * position 0, which reads like "they answered A".
 */

/** The option list as an array of strings, or `null` when it is not one. */
function toOptionList(options: unknown): string[] | null {
  if (!Array.isArray(options)) return null;
  return options.map((o) => (typeof o === "string" ? o : String(o ?? "")));
}

function asPosition(n: unknown): number | null {
  return typeof n === "number" && Number.isInteger(n) && n >= 0 ? n : null;
}

/**
 * Every position this payload names, in the order the row means them.
 *
 * `indexes` first because it is the only shape that can carry more than one.
 * The single-value keys are then read in the order they appear in the data, and
 * they agree wherever a row carries two of them (practice writes `index` and
 * `selected_index` with the same value).
 */
export function answerToIndexes(value: unknown, options?: unknown): number[] {
  if (value === null || value === undefined || typeof value !== "object") return [];
  const v = value as {
    indexes?: unknown; index?: unknown;
    correct_index?: unknown; selected_index?: unknown;
  };

  const found: number[] = Array.isArray(v.indexes)
    ? v.indexes.map(asPosition).filter((i): i is number => i !== null)
    : [v.index, v.correct_index, v.selected_index]
        .map(asPosition)
        .filter((i): i is number => i !== null)
        .slice(0, 1);

  // A position outside the option list is a broken row, not an answer. Only
  // checkable when the list is actually to hand.
  const list = toOptionList(options);
  return list ? found.filter((i) => i < list.length) : found;
}

/**
 * The single position this answer names, or null.
 *
 * When the payload carries no position but does carry a word, and the option
 * list is to hand, the word is matched back to its position — that is what
 * makes the 483 backfill rows ("C", with options) and free-text rows usable
 * rather than silently unmarkable.
 */
export function answerToIndex(value: unknown, options?: unknown): number | null {
  const positions = answerToIndexes(value, options);
  if (positions.length) return positions[0];

  const list = toOptionList(options);
  if (!list || list.length === 0) return null;

  const word =
    typeof value === "string"
      ? value
      : typeof value === "object" && value !== null
        ? (() => {
            const v = value as { text?: unknown; value?: unknown };
            if (typeof v.text === "string") return v.text;
            if (typeof v.value === "string") return v.value;
            if (typeof v.value === "number") return String(v.value);
            return null;
          })()
        : typeof value === "number" && Number.isFinite(value)
          ? String(value)
          : null;

  const needle = word?.trim();
  if (!needle) return null;

  const exact = list.findIndex((o) => o.trim() === needle);
  if (exact >= 0) return exact;

  const loose = list.findIndex((o) => o.trim().toLowerCase() === needle.toLowerCase());
  if (loose >= 0) return loose;

  // A lone A–Z letter is an option LABEL, not an option. Only read it as one
  // when it is not itself one of the options, or "A" would match an option
  // whose text happens to be "A".
  if (/^[A-Za-z]$/.test(needle)) {
    const pos = needle.toUpperCase().charCodeAt(0) - 65;
    if (pos >= 0 && pos < list.length) return pos;
  }
  return null;
}

export function answerToText(value: unknown, options: unknown): string | null {
  if (value === null || value === undefined) return null;

  const list = toOptionList(options);
  const positions = answerToIndexes(value, options);
  if (positions.length) {
    if (!list) return null;
    const words = positions
      .map((i) => (i >= 0 && i < list.length ? list[i] : null))
      .filter((w): w is string => typeof w === "string" && w.trim() !== "");
    if (words.length) return words.join(" · ");
  }

  // A bare string or number is already the answer.
  if (typeof value === "string") return value.trim() || null;
  if (typeof value === "number" && Number.isFinite(value)) return String(value);

  if (typeof value !== "object") return null;
  const v = value as { text?: unknown; value?: unknown };
  if (typeof v.text === "string" && v.text.trim()) return v.text.trim();
  if (typeof v.value === "number" && Number.isFinite(v.value)) return String(v.value);
  if (typeof v.value === "string" && v.value.trim()) return v.value.trim();

  return null;
}
