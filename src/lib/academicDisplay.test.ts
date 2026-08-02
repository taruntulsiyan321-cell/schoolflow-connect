import { describe, expect, it } from "vitest";
import {
  academicLabelMatches,
  academicMatchKey,
  displayChapter,
  displayConcept,
  displaySubject,
  displayTopic,
  fixMojibake,
  humanizeAcademicLabel,
  looksLikeAcademicSlug,
  presentAcademicLabel,
} from "./academicPresentation";
import {
  canonicalizeConceptId,
  mergeDuplicateLabels,
  searchTaxonomyByAlias,
} from "@/academic/taxonomy";

describe("fixMojibake", () => {
  it("decodes en-dash mojibake from Financial Statements example", () => {
    expect(fixMojibake("Financial Statements â€“ I")).toBe("Financial Statements - I");
    expect(fixMojibake("Financial Statements â€” II")).toBe("Financial Statements - II");
  });

  it("normalizes real Unicode en/em dashes to ASCII hyphen", () => {
    expect(fixMojibake("Financial Statements \u2013 I")).toBe("Financial Statements - I");
    expect(fixMojibake("Doubt \u2014 Quadratic")).toBe("Doubt - Quadratic");
  });

  it("decodes curly quotes and ellipsis mojibake", () => {
    expect(fixMojibake("Studentâ€™s book")).toBe("Student's book");
    expect(fixMojibake("â€œHelloâ€")).toBe('"Hello"');
    expect(fixMojibake("Waitâ€¦")).toBe("Wait...");
  });

  it("strips Â artifacts from middot / nbsp-style corruption", () => {
    expect(fixMojibake("Math Â· Science")).toBe("Math · Science");
    expect(fixMojibake("Loadingâ€¦")).toBe("Loading...");
  });

  it("handles nullish", () => {
    expect(fixMojibake(null)).toBe("");
    expect(fixMojibake(undefined)).toBe("");
  });
});

describe("looksLikeAcademicSlug", () => {
  it("detects snake_case concept ids", () => {
    expect(looksLikeAcademicSlug("accounting_equation")).toBe(true);
    expect(looksLikeAcademicSlug("bookkeeping_vs_accounting")).toBe(true);
    expect(looksLikeAcademicSlug("adjustments_bs")).toBe(true);
  });

  it("rejects human titles", () => {
    expect(looksLikeAcademicSlug("Financial Statements - I")).toBe(false);
    expect(looksLikeAcademicSlug("Introduction to Accounting")).toBe(false);
    expect(looksLikeAcademicSlug("Accountancy")).toBe(false);
  });
});

describe("presentAcademicLabel / dictionary", () => {
  it("uses educational terminology dictionary (not naive Title Case)", () => {
    expect(presentAcademicLabel("cash_book", "concept")).toBe("Cash Book");
    expect(presentAcademicLabel("brs_purpose", "concept")).toBe(
      "Purpose of Bank Reconciliation Statement",
    );
    expect(presentAcademicLabel("double_entry", "concept")).toBe("Double Entry System");
    expect(presentAcademicLabel("journal_proper", "concept")).toBe("Journal Proper");
    expect(presentAcademicLabel("journal_proper")).toBe("Journal Proper");
  });

  it("title-cases unknown snake_case with vs handling", () => {
    expect(humanizeAcademicLabel("accounting_equation")).toBe("Accounting Equation");
    expect(humanizeAcademicLabel("bookkeeping_vs_accounting")).toBe("Bookkeeping vs Accounting");
    expect(presentAcademicLabel("adjustments_bs", "concept")).toBe(
      "Adjustments in the Balance Sheet",
    );
  });

  it("fixes mojibake on non-slug chapter titles without re-casing", () => {
    expect(presentAcademicLabel("Financial Statements â€“ I", "chapter")).toBe(
      "Financial Statements - I",
    );
    expect(displayChapter("Financial Statements \u2013 I")).toBe("Financial Statements - I");
  });

  it("wrappers never leak snake_case", () => {
    expect(displayConcept("trading_account")).toBe("Trading Account");
    expect(displayTopic("trial_balance")).toBe("Trial Balance");
    expect(displaySubject("Business Studies")).toBe("Business Studies");
    expect(displaySubject("bst")).toBe("Business Studies");
    expect(displayConcept("cash_book")).not.toMatch(/_/);
  });
});

describe("alias registry", () => {
  it("canonicalizes BRS aliases to bank reconciliation concept", () => {
    expect(canonicalizeConceptId("BRS")).toBe("bank_reconciliation_statement");
    expect(canonicalizeConceptId("Bank Reconciliation")).toBe("bank_reconciliation_statement");
    expect(presentAcademicLabel("BRS", "concept")).toBe("Bank Reconciliation Statement");
  });

  it("searchTaxonomyByAlias finds BRS display name", () => {
    const hits = searchTaxonomyByAlias("BRS");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.some((h) => /bank reconciliation/i.test(h.displayName))).toBe(true);
  });

  it("mergeDuplicateLabels collapses slug + display variants", () => {
    const merged = mergeDuplicateLabels([
      "cash_book",
      "Cash Book",
      "Cashbook",
      "brs_purpose",
      "Purpose of Bank Reconciliation Statement",
    ]);
    const cash = merged.find((m) => m.canonicalId === "cash_book");
    expect(cash?.displayName).toMatch(/cash book/i);
    expect(cash?.merged.length).toBeGreaterThanOrEqual(2);
  });
});

describe("academicLabelMatches", () => {
  it("matches slug to humanized query and vice versa", () => {
    expect(academicLabelMatches("accounting_equation", "Accounting Equation")).toBe(true);
    expect(academicLabelMatches("Accounting Equation", "accounting_equation")).toBe(true);
    expect(academicMatchKey("bookkeeping_vs_accounting")).toContain("bookkeeping");
  });

  it("matches mojibake chapter to clean query", () => {
    expect(
      academicLabelMatches("Financial Statements â€“ I", "Financial Statements - I"),
    ).toBe(true);
  });
});
