import { describe, expect, it } from "vitest";
import {
  canonicalizeConceptId,
  formatTaxonomyBreadcrumb,
  mergeDuplicateLabels,
  normalizeIncomingAcademicTerm,
  presentAcademicLabel,
  resolveTaxonomyDisplayPath,
  searchTaxonomyByAlias,
  COMMERCE_SUBJECTS,
  SCIENCE_SUBJECTS,
} from "./index";

describe("taxonomy seeds", () => {
  it("seeds commerce RBSE subjects", () => {
    expect(COMMERCE_SUBJECTS.map((s) => s.displayName)).toEqual(
      expect.arrayContaining([
        "Accountancy",
        "Business Studies",
        "Economics",
        "Mathematics",
        "English",
        "Hindi",
      ]),
    );
  });

  it("seeds science placeholders", () => {
    expect(SCIENCE_SUBJECTS.map((s) => s.id)).toEqual(
      expect.arrayContaining(["physics", "chemistry", "biology", "computer_science"]),
    );
  });

  it("registers Economics/Math/English/Hindi chapters from bank", async () => {
    const { COMMERCE_CHAPTERS } = await import("./seeds/commerceRbse");
    const subjects = new Set(COMMERCE_CHAPTERS.map((c) => c.subjectId));
    expect([...subjects].sort()).toEqual(
      expect.arrayContaining([
        "accountancy",
        "business_studies",
        "economics",
        "mathematics",
        "english",
        "hindi",
      ]),
    );
  });
});

describe("canonicalize + normalize", () => {
  it("maps synonyms to concept ids", () => {
    expect(canonicalizeConceptId("double entry")).toBe("double_entry");
    expect(canonicalizeConceptId("Proper Journal")).toBe("journal_proper");
  });

  it("normalizes incoming concept to slug and chapter to title", () => {
    expect(normalizeIncomingAcademicTerm("Cash Book", "concept")).toBe("cash_book");
    expect(normalizeIncomingAcademicTerm("  Introduction to Accounting  ", "chapter")).toBe(
      "Introduction to Accounting",
    );
  });
});

describe("hierarchy resolve", () => {
  it("resolves board → subject → chapter → concept display path", () => {
    const path = resolveTaxonomyDisplayPath({
      board: "rbse",
      classLevel: 11,
      subject: "accounts",
      chapter: "Bank Reconciliation Statement",
      concept: "brs_purpose",
    });
    expect(path.board).toBe("RBSE");
    expect(path.classLevel).toBe("Class 11");
    expect(path.subject).toBe("Accountancy");
    expect(path.chapter).toMatch(/Bank Reconciliation/i);
    expect(path.concept).toBe("Purpose of Bank Reconciliation Statement");
  });

  it("formats breadcrumb without snake_case", () => {
    const crumb = formatTaxonomyBreadcrumb({
      subject: "Accountancy",
      chapter: "Recording of Transactions-I",
      concept: "cash_book",
    });
    expect(crumb).toContain("Cash Book");
    expect(crumb).not.toMatch(/cash_book/);
  });
});

describe("alias search", () => {
  it("BRS resolves to Bank Reconciliation display", () => {
    const hits = searchTaxonomyByAlias("brs", "concept");
    expect(hits.some((h) => h.displayName === "Bank Reconciliation Statement")).toBe(true);
    expect(presentAcademicLabel("BRS")).toBe("Bank Reconciliation Statement");
  });

  it("mergeDuplicateLabels prefers human display", () => {
    const [row] = mergeDuplicateLabels(["double_entry", "Double Entry System"]);
    expect(row.canonicalId).toBe("double_entry");
    expect(row.displayName).toBe("Double Entry System");
  });
});
