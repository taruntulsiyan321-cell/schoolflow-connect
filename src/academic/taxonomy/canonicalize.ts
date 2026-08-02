import type { TaxonomyKind } from "./types";
import { repairUtf8Mojibake } from "@/lib/utf8MojibakeRepair";

/** Collapse whitespace / punctuation into a stable slug id. */
export function slugifyAcademicId(raw: string | null | undefined): string {
  if (raw == null) return "";
  return String(raw)
    .trim()
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    // Keep Devanagari so Hindi chapter/concept ids stay unique and human-matchable
    .replace(/[^a-z0-9\u0900-\u097f]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/_+/g, "_");
}

/**
 * Stable chapter term id — unique across subject + class when titles repeat
 * (e.g. Introduction 11/12, Thermodynamics physics/chemistry).
 */
export function chapterTermId(
  displayName: string,
  subjectId: string,
  classLevel: number,
): string {
  const base = slugifyAcademicId(displayName);
  const subject = slugifyAcademicId(subjectId) || "subject";
  return `${base || "chapter"}_${subject}_c${classLevel}`;
}

/** Alias / synonym → canonical concept (or chapter) slug. */
const ALIAS_TO_CANONICAL: Record<string, string> = {
  brs: "bank_reconciliation_statement",
  "bank reconciliation": "bank_reconciliation_statement",
  "bank reconciliation statement": "bank_reconciliation_statement",
  "bank_reconciliation": "bank_reconciliation_statement",
  brs_purpose: "brs_purpose",
  "purpose of brs": "brs_purpose",
  "purpose of bank reconciliation statement": "brs_purpose",
  cashbook: "cash_book",
  "cash book": "cash_book",
  "double entry": "double_entry",
  "double entry system": "double_entry",
  "double-entry": "double_entry",
  "journal proper": "journal_proper",
  "proper journal": "journal_proper",
  bst: "business_studies",
  "business studies": "business_studies",
  accounts: "accountancy",
  accounting: "accountancy",
  eco: "economics",
  maths: "mathematics",
  math: "mathematics",
  p_and_l: "pl_account",
  "p&l": "pl_account",
  "profit and loss": "pl_account",
  "profit & loss": "pl_account",
  "trial balance": "trial_balance",
  "balance sheet": "balance_sheet",
  "trading account": "trading_account",
  gaap: "gaap",
  "accounting equation": "accounting_equation",
  "book keeping vs accounting": "bookkeeping_vs_accounting",
  "bookkeeping vs accounting": "bookkeeping_vs_accounting",
};

/**
 * Resolve a raw label / alias / slug to a canonical concept id (slug).
 * Does not invent ids for free-form prose — returns slugify of input.
 */
export function canonicalizeConceptId(raw: string | null | undefined): string {
  if (raw == null) return "";
  const trimmed = String(raw).trim();
  if (!trimmed) return "";

  const lower = trimmed.toLowerCase().replace(/\s+/g, " ");
  if (ALIAS_TO_CANONICAL[lower]) return ALIAS_TO_CANONICAL[lower];

  const slug = slugifyAcademicId(trimmed);
  if (ALIAS_TO_CANONICAL[slug]) return ALIAS_TO_CANONICAL[slug];

  // Underscore / hyphen variants of known aliases
  const spaced = slug.replace(/_/g, " ");
  if (ALIAS_TO_CANONICAL[spaced]) return ALIAS_TO_CANONICAL[spaced];

  return slug;
}

/**
 * Merge near-duplicate labels into one canonical display form.
 * Prefers the label that already looks human (has spaces / Title Case)
 * over snake_case, and longer descriptive names over short codes.
 */
export function mergeDuplicateLabels(
  labels: Array<string | null | undefined>,
): { canonicalId: string; displayName: string; merged: string[] }[] {
  const buckets = new Map<string, string[]>();
  for (const label of labels) {
    if (label == null || !String(label).trim()) continue;
    const id = canonicalizeConceptId(label);
    if (!id) continue;
    const list = buckets.get(id) ?? [];
    list.push(String(label).trim());
    buckets.set(id, list);
  }

  const score = (s: string): number => {
    let n = 0;
    if (/\s/.test(s)) n += 4;
    if (/[A-Z]/.test(s) && /[a-z]/.test(s)) n += 2;
    if (!/_/.test(s)) n += 3;
    if (s.length > 12) n += 1;
    if (/^[A-Z]{2,5}$/.test(s)) n -= 2; // bare acronyms lose to full names
    return n + Math.min(s.length, 40) / 40;
  };

  return [...buckets.entries()].map(([canonicalId, merged]) => {
    const unique = [...new Set(merged)];
    const displayName = unique.slice().sort((a, b) => score(b) - score(a))[0] ?? canonicalId;
    return { canonicalId, displayName, merged: unique };
  });
}

export function kindFromColumn(column: string): TaxonomyKind | null {
  switch (column) {
    case "board":
      return "board";
    case "class_level":
    case "class":
      return "class_level";
    case "subject":
      return "subject";
    case "chapter":
      return "chapter";
    case "topic":
      return "topic";
    case "concept":
      return "concept";
    case "question_format":
    case "question_type":
      return "question_type";
    default:
      return null;
  }
}

/**
 * Normalize an incoming teacher/AI/seed label for storage:
 * - concepts/topics → canonical slug id
 * - chapters/subjects → cleaned display title (not forced to slug)
 * - UTF-8 mojibake repaired at ingest so DB never stores à¤… for Devanagari
 */
export function normalizeIncomingAcademicTerm(
  raw: string | null | undefined,
  kind: TaxonomyKind,
): string {
  if (raw == null) return "";
  const trimmed = repairUtf8Mojibake(String(raw)).trim();
  if (!trimmed) return "";

  if (kind === "concept" || kind === "topic") {
    return canonicalizeConceptId(trimmed);
  }
  if (kind === "question_type") {
    return slugifyAcademicId(trimmed).replace(/-/g, "_");
  }
  if (kind === "board") {
    return slugifyAcademicId(trimmed);
  }
  if (kind === "class_level") {
    const m = trimmed.match(/\b(6|7|8|9|10|11|12)\b/);
    return m ? m[1] : trimmed;
  }
  // subject / chapter — keep readable title; collapse inner whitespace
  return trimmed.replace(/\s+/g, " ");
}
