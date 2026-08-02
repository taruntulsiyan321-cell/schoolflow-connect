import { describe, expect, it } from "vitest";
import {
  canonicalizeConceptId,
  formatTaxonomyBreadcrumb,
  isPlaceholderAcademicLabel,
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

  it("assigns unique chapter ids across repeated titles / subjects", async () => {
    const { COMMERCE_CHAPTERS } = await import("./seeds/commerceRbse");
    const { SCIENCE_CHAPTER_PLACEHOLDERS } = await import("./seeds/sciencePlaceholders");
    const ids = [...COMMERCE_CHAPTERS, ...SCIENCE_CHAPTER_PLACEHOLDERS].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(COMMERCE_CHAPTERS.filter((c) => c.displayName === "Introduction").map((c) => c.id).sort()).toEqual([
      "introduction_economics_c11",
      "introduction_economics_c12",
    ]);
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

describe("placeholder academic labels", () => {
  it("flags Subject/Topic/Daily/General and practice-mode keys", () => {
    for (const label of [
      "Subject",
      "Topic",
      "Daily",
      "General",
      "subject",
      "weak",
      "incorrect",
      "skipped",
      "timed",
      "",
    ]) {
      expect(isPlaceholderAcademicLabel(label)).toBe(true);
    }
    expect(isPlaceholderAcademicLabel("Mathematics")).toBe(false);
    expect(isPlaceholderAcademicLabel("Integration")).toBe(false);
  });

  it("suppresses bare placeholders in presentation", () => {
    expect(presentAcademicLabel("Subject")).toBe("");
    expect(presentAcademicLabel("Topic")).toBe("");
    expect(presentAcademicLabel("Daily")).toBe("");
    expect(presentAcademicLabel("General")).toBe("");
    expect(presentAcademicLabel("subject")).toBe("");
  });

  it("keeps real titles that contain those words", () => {
    expect(presentAcademicLabel("Subject-Verb Agreement").length).toBeGreaterThan(0);
    expect(presentAcademicLabel("General Term").length).toBeGreaterThan(0);
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
