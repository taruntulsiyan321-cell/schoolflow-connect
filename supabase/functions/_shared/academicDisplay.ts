/**
 * Edge mirror of academic presentation (subset).
 * Full SSOT: src/academic/taxonomy + src/lib/academicPresentation.ts
 * Keep dictionary keys in sync for commerce concept display.
 */

const SMALL_WORDS = new Set(["a", "an", "the", "and", "or", "of", "in", "on", "to", "for", "vs", "via"]);

const CONCEPT_DISPLAY: Record<string, string> = {
  cash_book: "Cash Book",
  brs_purpose: "Purpose of Bank Reconciliation Statement",
  bank_reconciliation_statement: "Bank Reconciliation Statement",
  double_entry: "Double Entry System",
  journal_proper: "Journal Proper",
  accounting_equation: "Accounting Equation",
  bookkeeping_vs_accounting: "Bookkeeping vs Accounting",
  adjustments_bs: "Adjustments in the Balance Sheet",
  trial_balance: "Trial Balance",
  trading_account: "Trading Account",
  pl_account: "Profit and Loss Account",
  balance_sheet: "Balance Sheet",
  meaning_objectives: "Meaning and Objectives",
  gaap: "GAAP",
};

const SUBJECT_DISPLAY: Record<string, string> = {
  accountancy: "Accountancy",
  accounts: "Accountancy",
  business_studies: "Business Studies",
  bst: "Business Studies",
  economics: "Economics",
  mathematics: "Mathematics",
  maths: "Mathematics",
  english: "English",
  hindi: "Hindi",
  physics: "Physics",
  chemistry: "Chemistry",
  biology: "Biology",
};

const ALIAS_TO_ID: Record<string, string> = {
  brs: "bank_reconciliation_statement",
  "bank reconciliation": "bank_reconciliation_statement",
  "bank reconciliation statement": "bank_reconciliation_statement",
  cashbook: "cash_book",
  "cash book": "cash_book",
  "double entry": "double_entry",
  "double entry system": "double_entry",
  "journal proper": "journal_proper",
  "proper journal": "journal_proper",
};

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
  [/Ã±/g, "\u00F1"],
];

/** CP1252 C1-gap → original byte (mirror of src/lib/utf8MojibakeRepair). */
const CP1252_CP_TO_BYTE = new Map<number, number>([
  [0x20ac, 0x80], [0x201a, 0x82], [0x0192, 0x83], [0x201e, 0x84],
  [0x2026, 0x85], [0x2020, 0x86], [0x2021, 0x87], [0x02c6, 0x88],
  [0x2030, 0x89], [0x0160, 0x8a], [0x2039, 0x8b], [0x0152, 0x8c],
  [0x017d, 0x8e], [0x2018, 0x91], [0x2019, 0x92], [0x201c, 0x93],
  [0x201d, 0x94], [0x2022, 0x95], [0x2013, 0x96], [0x2014, 0x97],
  [0x02dc, 0x98], [0x2122, 0x99], [0x0161, 0x9a], [0x203a, 0x9b],
  [0x0153, 0x9c], [0x017e, 0x9e], [0x0178, 0x9f],
]);

function repairUtf8Mojibake(text: string): string {
  if (!/à¤|à¥|â€|âˆ|â‰|Ã.|Î.|Ï[€\u0080-\u00ff]|Â[°·¹²³½¼¾]/.test(text)) return text;
  const bytes: number[] = [];
  for (const ch of text) {
    const cp = ch.codePointAt(0)!;
    const mapped = CP1252_CP_TO_BYTE.get(cp);
    if (mapped != null) bytes.push(mapped);
    else if (cp <= 0xff) bytes.push(cp);
    else return text;
  }
  try {
    const decoded = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(bytes));
    return decoded && decoded !== text ? decoded : text;
  } catch {
    return text;
  }
}

function slugify(raw: string): string {
  return raw
    .trim()
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

export function canonicalizeConceptId(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (ALIAS_TO_ID[lower]) return ALIAS_TO_ID[lower];
  const slug = slugify(trimmed);
  if (ALIAS_TO_ID[slug]) return ALIAS_TO_ID[slug];
  const spaced = slug.replace(/_/g, " ");
  if (ALIAS_TO_ID[spaced]) return ALIAS_TO_ID[spaced];
  return slug;
}

export function looksLikeAcademicSlug(raw: string): boolean {
  const s = raw.trim();
  if (!s) return false;
  if (/\s/.test(s)) return false;
  if (!/[_-]/.test(s)) return CONCEPT_DISPLAY[s] != null;
  return /^[a-z0-9]+(?:[_-][a-z0-9]+)+$/i.test(s) && s === s.toLowerCase();
}

export function fixMojibake(text: string | null | undefined): string {
  if (text == null) return "";
  let s = String(text);
  if (!s) return "";
  s = repairUtf8Mojibake(s);
  for (const [re, repl] of MOJIBAKE_MAP) s = s.replace(re, repl);
  // Skip ASCII-fold while unresolved mojibake remains (protects Devanagari CP1252 bytes)
  if (/à¤|à¥/.test(s)) return s.replace(/[ \t\u00A0]+/g, " ").trim();
  s = s.replace(/\s*[\u2010-\u2015\u2212\uFE58\uFE63\uFF0D]\s*/g, " - ");
  s = s.replace(/[\u2018\u2019\u201A\u201B]/g, "'");
  s = s.replace(/[\u201C\u201D\u201E\u201F]/g, '"');
  s = s.replace(/\u2026/g, "...");
  s = s.replace(/[ \t\u00A0]+/g, " ").trim();
  return s;
}

function titleCaseToken(token: string, index: number, total: number): string {
  const lower = token.toLowerCase();
  if (lower === "vs") return "vs";
  if (lower === "bst") return "BST";
  if (lower === "brs") return "BRS";
  if (lower === "bs") return "BS";
  if (lower === "ii") return "II";
  if (lower === "iii") return "III";
  if (lower === "iv") return "IV";
  if (/^\d+[a-z]?$/i.test(token)) return token.toUpperCase();
  const keepSmall = index > 0 && index < total - 1 && SMALL_WORDS.has(lower);
  if (keepSmall) return lower;
  if (token.length <= 2 && token === token.toUpperCase()) return token;
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

export function humanizeAcademicLabel(raw: string | null | undefined): string {
  if (raw == null) return "";
  const cleaned = fixMojibake(String(raw));
  if (!cleaned) return "";
  const canon = canonicalizeConceptId(cleaned);
  if (CONCEPT_DISPLAY[canon]) return CONCEPT_DISPLAY[canon];
  if (SUBJECT_DISPLAY[slugify(cleaned)]) return SUBJECT_DISPLAY[slugify(cleaned)];
  if (!looksLikeAcademicSlug(cleaned) && !/^[a-z]+(?:_[a-z0-9]+)+$/.test(cleaned)) return cleaned;
  const parts = cleaned.split(/[_-]+/).filter(Boolean);
  if (parts.length === 0) return cleaned;
  return parts.map((part, i) => titleCaseToken(part, i, parts.length)).join(" ");
}

export function presentAcademicLabel(
  raw: string | null | undefined,
  _kind?: "subject" | "chapter" | "topic" | "concept" | "question_type",
): string {
  return humanizeAcademicLabel(raw);
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
