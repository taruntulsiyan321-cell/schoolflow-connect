/**
 * Class-level parsing for edge (Nova match gates).
 * Client mirror: src/lib/parseClassLevel.ts
 * (bodies below the SHARED BODY marker must stay identical).
 */

// ── SHARED BODY (parity-checked — do not edit one side alone) ──────────────

/** EVERY class level the platform teaches. Ordered DESC for regex longest-first habit. */
export const CLASS_LEVELS = [12, 11, 10, 9, 8, 7, 6, 5] as const;

/** A class level the platform teaches. Derived — never re-listed. */
export type ClassLevel = (typeof CLASS_LEVELS)[number];

/** Ascending, for anything that renders the list to a person. */
export const CLASS_LEVELS_ASCENDING: readonly ClassLevel[] = [...CLASS_LEVELS].sort(
  (a, b) => a - b,
);

/** Built from CLASS_LEVELS so the pattern and the list cannot drift apart. */
export const CLASS_LEVEL_PATTERN = new RegExp(`\\b(${CLASS_LEVELS.join("|")})\\b`);

/** True when a number is a class level the platform teaches. */
export function isClassLevel(n: unknown): n is ClassLevel {
  return typeof n === "number" && (CLASS_LEVELS as readonly number[]).includes(n);
}

/**
 * Parse class level from digits or Roman numerals
 * (e.g. "Class-10", "Std 9", "XI-A", "Class XII", "V-B").
 * Longest-first Roman: with "X" ahead of "XII" the alternation matches the X in XII.
 */
export function parseClassLevel(label?: string | null): number | null {
  if (!label) return null;
  const text = String(label);
  const m = text.match(CLASS_LEVEL_PATTERN);
  if (m) return Number(m[1]);
  const roman = text.toUpperCase().match(/\b(XII|XI|IX|VIII|VII|VI|X|V)\b/);
  if (!roman) return null;
  const romanLevels: Record<string, number> = {
    V: 5,
    VI: 6,
    VII: 7,
    VIII: 8,
    IX: 9,
    X: 10,
    XI: 11,
    XII: 12,
  };
  return romanLevels[roman[1]] ?? null;
}
