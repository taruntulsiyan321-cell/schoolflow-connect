import type { BoardId, Chapter, ClassLevel, Concept, Subject, TaxonomyTerm } from "../types";
import { slugifyAcademicId } from "../canonicalize";
import { CONCEPT_DISPLAY_DICTIONARY } from "../dictionary";

const BOARD: BoardId = "rbse";

function subject(
  id: string,
  displayName: string,
  aliases: string[] = [],
): Subject {
  return {
    id,
    displayName,
    aliases,
    kind: "subject",
    board: BOARD,
  };
}

function chapter(
  displayName: string,
  subjectId: string,
  classLevel: ClassLevel,
  aliases: string[] = [],
): Chapter {
  const id = slugifyAcademicId(displayName);
  return {
    id,
    displayName,
    aliases,
    kind: "chapter",
    board: BOARD,
    classLevel,
    subjectId,
    parentId: subjectId,
  };
}

export const COMMERCE_SUBJECTS: Subject[] = [
  subject("accountancy", "Accountancy", ["accounts", "accounting"]),
  subject("business_studies", "Business Studies", ["bst", "business studies (bst)"]),
  subject("economics", "Economics", ["eco"]),
  subject("mathematics", "Mathematics", ["maths", "math"]),
  subject("english", "English", ["english core"]),
  subject("hindi", "Hindi", ["hindi core"]),
];

/** NCERT-aligned RBSE commerce chapters (11–12) already seeded in question_bank. */
export const COMMERCE_CHAPTERS: Chapter[] = [
  // Accountancy 11
  chapter("Introduction to Accounting", "accountancy", 11),
  chapter("Theory Base of Accounting", "accountancy", 11),
  chapter("Recording of Transactions-I", "accountancy", 11, ["recording of transactions i"]),
  chapter("Recording of Transactions-II", "accountancy", 11, ["recording of transactions ii"]),
  chapter("Bank Reconciliation Statement", "accountancy", 11, ["brs", "bank reconciliation"]),
  chapter("Trial Balance and Rectification of Errors", "accountancy", 11),
  chapter("Depreciation, Provisions and Reserves", "accountancy", 11),
  chapter("Financial Statements - I", "accountancy", 11, ["financial statements i", "financial statements – i"]),
  chapter("Financial Statements - II", "accountancy", 11, ["financial statements ii", "financial statements – ii"]),
  // Accountancy 12
  chapter("Accounting for Partnership - Basic Concepts", "accountancy", 12),
  chapter("Reconstitution - Admission", "accountancy", 12),
  chapter("Reconstitution - Retirement/Death", "accountancy", 12),
  chapter("Dissolution of Partnership Firm", "accountancy", 12),
  chapter("Accounting for Share Capital", "accountancy", 12),
  chapter("Issue and Redemption of Debentures", "accountancy", 12),
  chapter("Financial Statements of a Company", "accountancy", 12),
  chapter("Analysis of Financial Statements", "accountancy", 12),
  chapter("Accounting Ratios", "accountancy", 12),
  chapter("Cash Flow Statement", "accountancy", 12),
  // Business Studies 11
  chapter("Nature and Purpose of Business", "business_studies", 11),
  chapter("Forms of Business Organisation", "business_studies", 11),
  chapter("Private, Public and Global Enterprises", "business_studies", 11),
  chapter("Business Services", "business_studies", 11),
  chapter("Emerging Modes of Business", "business_studies", 11),
  chapter("Social Responsibilities of Business and Business Ethics", "business_studies", 11),
  chapter("Formation of a Company", "business_studies", 11),
  chapter("Sources of Business Finance", "business_studies", 11),
  chapter("MSME and Business Entrepreneurship", "business_studies", 11),
  chapter("Internal Trade", "business_studies", 11),
  chapter("International Business", "business_studies", 11),
  // Business Studies 12
  chapter("Nature and Significance of Management", "business_studies", 12),
  chapter("Principles of Management", "business_studies", 12),
  chapter("Business Environment", "business_studies", 12),
  chapter("Planning", "business_studies", 12),
  chapter("Organising", "business_studies", 12),
  chapter("Staffing", "business_studies", 12),
  chapter("Directing", "business_studies", 12),
  chapter("Controlling", "business_studies", 12),
  chapter("Financial Management", "business_studies", 12),
  chapter("Marketing Management", "business_studies", 12),
  chapter("Consumer Protection", "business_studies", 12),
];

/** Concept terms from seed slugs with curated (or dictionary) display names. */
export function buildCommerceConceptTerms(): Concept[] {
  return Object.entries(CONCEPT_DISPLAY_DICTIONARY).map(([id, displayName]) => ({
    id,
    displayName,
    aliases: buildConceptAliases(id, displayName),
    kind: "concept" as const,
    board: BOARD,
  }));
}

function buildConceptAliases(id: string, displayName: string): string[] {
  const aliases = new Set<string>();
  aliases.add(displayName);
  aliases.add(displayName.toLowerCase());
  if (id === "brs_purpose" || id === "bank_reconciliation_statement") {
    aliases.add("BRS");
    aliases.add("brs");
    aliases.add("Bank Reconciliation");
  }
  if (id === "journal_proper") {
    aliases.add("Proper Journal");
  }
  if (id === "double_entry") {
    aliases.add("Double Entry");
    aliases.add("Double-Entry System");
  }
  if (id === "cash_book") {
    aliases.add("Cashbook");
  }
  // spaced form of slug
  aliases.add(id.replace(/_/g, " "));
  return [...aliases];
}

export function commerceTaxonomyBundle(): TaxonomyTerm[] {
  return [
    ...COMMERCE_SUBJECTS,
    ...COMMERCE_CHAPTERS,
    ...buildCommerceConceptTerms(),
  ];
}
