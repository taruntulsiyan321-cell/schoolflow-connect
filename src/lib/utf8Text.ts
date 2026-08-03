/**
 * Root UTF-8 / encoding repair for academic content (questions, options, explanations).
 * Fixes common UTF-8-as-Windows-1252 / Latin-1 mojibake while PRESERVING mathematical Unicode
 * (π θ √ α β Σ ∞ ≤ ≥ ± × ÷ superscripts/subscripts, fractions).
 *
 * Structural WIN1252→UTF-8 (Devanagari chapters, π, etc.) is in utf8MojibakeRepair.ts.
 * Taxonomy labels use `@/academic/taxonomy` fixMojibake (calls repairUtf8Mojibake first).
 * Question stems/options must use this module + MathText — never one-off char maps in pages.
 */

import { repairUtf8Mojibake } from "@/lib/utf8MojibakeRepair";

export {
  isCleanAcademicLabel,
  looksLikeUnresolvedMojibake,
  looksLikeUtf8Mojibake,
  repairUtf8Mojibake,
  UTF8_MOJIBAKE_SIGNATURE,
} from "@/lib/utf8MojibakeRepair";

/** Leftover UTF-8-as-Windows-1252 / Latin-1 sequences after structural repair. */
const CONTENT_MOJIBAKE: Array<[RegExp, string]> = [
  // punctuation
  [/â€”/g, "\u2014"],
  [/â€“/g, "\u2013"],
  [/â€˜/g, "\u2018"],
  [/â€™/g, "\u2019"],
  [/â€œ/g, "\u201C"],
  [/â€/g, "\u201D"],
  [/â€¦/g, "\u2026"],
  [/â€¢/g, "\u2022"],
  [/Â·/g, "\u00B7"],
  [/Â°/g, "\u00B0"],
  [/Â\s/g, " "],
  [/Â(?=[\u0080-\u00ff])/g, ""],
  // operators & relations
  [/Ã—/g, "\u00D7"],
  [/Ã·/g, "\u00F7"],
  [/Â±/g, "\u00B1"],
  [/â‰¤/g, "\u2264"],
  [/â‰¥/g, "\u2265"],
  [/â‰ /g, "\u2260"],
  [/âˆž/g, "\u221E"],
  [/âˆš/g, "\u221A"],
  [/âˆ‘/g, "\u2211"],
  [/âˆ«/g, "\u222B"],
  [/âˆ’/g, "\u2212"],
  [/âˆ™/g, "\u2219"],
  [/â‰ˆ/g, "\u2248"],
  [/âˆ¼/g, "\u223C"],
  [/âˆ´/g, "\u2234"],
  [/âˆµ/g, "\u2235"],
  [/âˆ /g, "\u2220"],
  [/âˆ¥/g, "\u2225"],
  [/âŠ‚/g, "\u2282"],
  [/âŠƒ/g, "\u2283"],
  [/âˆˆ/g, "\u2208"],
  [/âˆ‰/g, "\u2209"],
  [/âˆª/g, "\u222A"],
  [/âˆ©/g, "\u2229"],
  // Greek (UTF-8 CExx as Latin-1)
  [/Î±/g, "\u03B1"],
  [/Î²/g, "\u03B2"],
  [/Î³/g, "\u03B3"],
  [/Î´/g, "\u03B4"],
  [/Î¸/g, "\u03B8"],
  [/Î»/g, "\u03BB"],
  [/Î¼/g, "\u03BC"],
  [/Ï€/g, "\u03C0"],
  [/Ïƒ/g, "\u03C3"],
  [/Ï„/g, "\u03C4"],
  [/Ï†/g, "\u03C6"],
  [/Ï‰/g, "\u03C9"],
  [/Î£/g, "\u03A3"],
  [/Î /g, "\u03A0"],
  [/Î”/g, "\u0394"],
  [/Î˜/g, "\u0398"],
  [/Ã±/g, "\u00F1"],
  // vulgar fractions mis-encoded
  [/Â½/g, "\u00BD"],
  [/Â¼/g, "\u00BC"],
  [/Â¾/g, "\u00BE"],
  [/â…“/g, "\u2153"],
  [/â…”/g, "\u2154"],
  // superscripts / subscripts common corruption
  [/Â²/g, "\u00B2"],
  [/Â³/g, "\u00B3"],
  [/Â¹/g, "\u00B9"],
];

/**
 * Repair mojibake in question/option/explanation text.
 * Does NOT collapse en/em dashes to ASCII (preserves math minus / ranges).
 */
export function fixUtf8Content(text: string | null | undefined): string {
  if (text == null) return "";
  let s = repairUtf8Mojibake(text);
  if (!s) return "";

  for (const [re, repl] of CONTENT_MOJIBAKE) {
    s = s.replace(re, repl);
  }

  // Strip orphan C1 / soft hyphen noise without touching math glyphs
  s = s.replace(/\u00AD/g, "");
  s = s.replace(/[ \t\u00A0]+/g, " ");
  return s.trim();
}

/** True when text likely contains math that MathText / KaTeX should handle. */
export function looksLikeMathContent(text: string | null | undefined): boolean {
  if (!text) return false;
  const s = String(text);
  if (/\$[^$]+\$|\\\(|\\\[|\\frac|\\sqrt|\\sum|\\int|\\pi|\\theta|\\alpha|\\beta/.test(s)) {
    return true;
  }
  return /[πθ√αβΣ∞≤≥±×÷≠≈∂∇∫∏∑∠°½¼¾²³¹₀-₉⁰-⁹]/.test(s);
}
