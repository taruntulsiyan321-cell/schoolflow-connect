import type { AcademicLabelKind } from "./types";
import { canonicalizeConceptId, looksLikeAcademicSlug, slugifyAcademicId } from "./canonicalize";
import { CONCEPT_DISPLAY_DICTIONARY, TOKEN_DISPLAY } from "./dictionary";
import { lookupDisplayName } from "./registry";
import { repairUtf8Mojibake } from "@/lib/utf8MojibakeRepair";
import { CLASS_LEVEL_PATTERN } from "@/lib/curriculumScope";

const SMALL_WORDS = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "vs", "via"]);

/**
 * Bare demo/placeholder tokens that must never appear as academic metadata in product UI.
 * Exact match only (case-insensitive) — does not affect real titles like "Subject-Verb Agreement".
 */
const PLACEHOLDER_ACADEMIC_LABELS = new Set([
  "subject",
  "topic",
  "daily",
  "general",
  "concept",
  "chapter",
  "mixed",
  // Practice mode keys sometimes stored as chapter/concept by mistake
  "weak",
  "incorrect",
  "skipped",
  "timed",
]);

/** True when raw is empty or a banned placeholder label. */
export function isPlaceholderAcademicLabel(raw: string | null | undefined): boolean {
  if (raw == null) return true;
  const s = String(raw).trim().toLowerCase();
  if (!s) return true;
  return PLACEHOLDER_ACADEMIC_LABELS.has(s);
}

/** Leftover UTF-8-as-Windows-1252 / Latin-1 sequences after structural repair (labels). */
const MOJIBAKE_MAP: Array<[RegExp, string]> = [
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
  [/Â/g, ""],
  [/Ã—/g, "\u00D7"],
  [/Ã·/g, "\u00F7"],
  [/Â±/g, "\u00B1"],
  [/Ã±/g, "\u00F1"],
  [/âˆš/g, "\u221A"],
  [/âˆž/g, "\u221E"],
  [/â‰¤/g, "\u2264"],
  [/â‰¥/g, "\u2265"],
  [/Ï€/g, "\u03C0"],
  [/Î¸/g, "\u03B8"],
  [/Î±/g, "\u03B1"],
  [/Î²/g, "\u03B2"],
  [/Î£/g, "\u03A3"],
];

/**
 * Decode UTF-8-as-CP1252/Latin-1 corruption and normalize dashes/quotes
 * to clean ASCII hyphen / straight quotes for consistent UI.
 *
 * Quote/dash ASCII folding runs ONLY after mojibake is resolved — otherwise
 * CP1252 punctuation inside Devanagari mojibake (e.g. U+201A in à¤‚) is destroyed.
 */
export function fixMojibake(text: string | null | undefined): string {
  if (text == null) return "";
  let s = String(text);
  if (!s) return "";

  s = repairUtf8Mojibake(s);

  for (const [re, repl] of MOJIBAKE_MAP) {
    s = s.replace(re, repl);
  }

  // Never ASCII-fold curly quotes / dashes while Devanagari mojibake remains —
  // that path previously turned à¤‚ (U+201A) into à¤' and blocked later data repair.
  // Western leftovers still get dash/quote normalization below.
  if (/à[¤¥]/.test(s)) {
    return s.replace(/[ \t\u00A0]+/g, " ").trim();
  }

  s = s.replace(/\s*[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\s*/g, " - ");
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
  s = s.replace(/\u2026/g, "...");
  s = s.replace(/[ \t\u00A0]+/g, " ").trim();

  return s;
}

function titleCaseToken(token: string, index: number, total: number): string {
  const lower = token.toLowerCase();
  if (TOKEN_DISPLAY[lower] != null) {
    const mapped = TOKEN_DISPLAY[lower];
    if (SMALL_WORDS.has(lower) && index > 0 && index < total - 1) return mapped;
    if (!SMALL_WORDS.has(lower)) return mapped;
  }
  if (/^\d+[a-z]?$/i.test(token)) return token.toUpperCase();

  const keepSmall = index > 0 && index < total - 1 && SMALL_WORDS.has(lower);
  if (keepSmall) return lower;

  if (token.length <= 2 && token === token.toUpperCase()) return token;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

/**
 * Intelligent humanize for unknown slugs (educational token map + Title Case).
 * Always applies mojibake cleanup. A name a person wrote is cleaned and shown
 * as written: the concept dictionary names ids, and "Planning" is not the id
 * `planning` (see getTaxonomyTerm).
 */
export function humanizeAcademicLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  const cleaned = fixMojibake(String(raw));
  if (!cleaned) return "";
  if (!looksLikeAcademicSlug(cleaned)) return cleaned;

  const canon = canonicalizeConceptId(cleaned);
  if (CONCEPT_DISPLAY_DICTIONARY[canon]) {
    return CONCEPT_DISPLAY_DICTIONARY[canon];
  }

  // Always humanize internal ids — never leave bare lowercase / snake_case in UI
  const parts = cleaned.split(/[_-]+/).filter(Boolean);
  if (parts.length === 0) return cleaned;

  return parts.map((part, i) => titleCaseToken(part, i, parts.length)).join(" ");
}

/**
 * SSOT presentation entry: taxonomy displayName when known, else intelligent humanize.
 * NEVER returns raw snake_case to UI callers.
 */
export function presentAcademicLabel(
  raw: string | null | undefined,
  kind?: AcademicLabelKind,
): string {
  if (raw == null) return "";
  const cleaned = fixMojibake(String(raw));
  if (!cleaned) return "";
  // Never surface bare Subject / Topic / Daily / General as if they were real metadata.
  if (isPlaceholderAcademicLabel(cleaned)) return "";

  const fromRegistry = lookupDisplayName(cleaned, kind);
  if (fromRegistry) return fromRegistry;

  if (kind === "class_level") {
    const m = cleaned.match(CLASS_LEVEL_PATTERN);
    if (m) return `Class ${m[1]}`;
  }

  const humanized = humanizeAcademicLabel(cleaned);
  // Final guard: never leak snake_case
  if (/^[a-z0-9]+(?:_[a-z0-9]+)+$/.test(humanized)) {
    return humanized
      .split("_")
      .map((part, i, arr) => titleCaseToken(part, i, arr.length))
      .join(" ");
  }
  return humanized;
}

export function displayChapter(raw: string | null | undefined): string {
  return presentAcademicLabel(raw, "chapter");
}

export function displayConcept(raw: string | null | undefined): string {
  return presentAcademicLabel(raw, "concept");
}

export function displayTopic(raw: string | null | undefined): string {
  return presentAcademicLabel(raw, "topic");
}

export function displaySubject(raw: string | null | undefined): string {
  return presentAcademicLabel(raw, "subject");
}

export function academicMatchKey(raw: string | null | undefined): string {
  const cleaned = fixMojibake(raw).toLowerCase();
  if (!cleaned) return "";
  const canon = canonicalizeConceptId(cleaned);
  return (canon || cleaned)
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The same label, however it was written: slug, mojibake, case or an alias.
 * Never a label that merely CONTAINS the other — "Areas of Similar Triangles"
 * is not the chapter "Triangles".
 */
export function academicLabelEquals(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  const ka = academicMatchKey(a);
  const kb = academicMatchKey(b);
  if (!ka || !kb) return false;
  return ka === kb || canonicalizeConceptId(a) === canonicalizeConceptId(b);
}

/**
 * The same label, or one inside the other. For finding a label from a loose
 * query (an old link, a typed name); to decide that two labels name the same
 * thing, use academicLabelEquals.
 */
export function academicLabelMatches(
  stored: string | null | undefined,
  query: string | null | undefined,
): boolean {
  if (academicLabelEquals(stored, query)) return true;
  const a = academicMatchKey(stored);
  const b = academicMatchKey(query);
  if (!a || !b) return false;
  return a.includes(b) || b.includes(a);
}

export function toPresentedTerm(
  raw: string | null | undefined,
  kind?: AcademicLabelKind,
): { id: string; displayName: string } | null {
  if (isPlaceholderAcademicLabel(raw)) return null;
  const displayName = presentAcademicLabel(raw, kind);
  if (!displayName) return null;
  const id =
    kind === "concept" || kind === "topic"
      ? canonicalizeConceptId(raw) || slugifyAcademicId(raw)
      : String(raw).trim();
  return { id, displayName };
}
