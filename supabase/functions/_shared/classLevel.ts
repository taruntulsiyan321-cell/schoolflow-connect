/**
 * Parse class level from arabic digits or Roman numerals.
 * Mirrors src/lib/curriculumScope.ts parseClassLevel — edge cannot import @/lib.
 * Longest Roman first so XII is not read as X.
 */
const ARABIC = /\b(12|11|10|9|8|7|6|5)\b/;
const ROMAN = /\b(XII|XI|IX|VIII|VII|VI|X|V)\b/;
const ROMAN_LEVELS: Record<string, number> = {
  V: 5,
  VI: 6,
  VII: 7,
  VIII: 8,
  IX: 9,
  X: 10,
  XI: 11,
  XII: 12,
};

export function parseClassLevel(label?: string | null): number | null {
  if (!label) return null;
  const text = String(label);
  const arabic = text.match(ARABIC);
  if (arabic) return Number(arabic[1]);
  const roman = text.toUpperCase().match(ROMAN);
  if (!roman) return null;
  return ROMAN_LEVELS[roman[1]] ?? null;
}
