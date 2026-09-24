/**
 * Binding: docs/custom-practice-upload-spec.md §5 / §7
 * Pure resolve — no inventing chapters.
 */
import { describe, expect, it } from "vitest";
import {
  formatCatalogHint,
  resolveCurriculumLabels,
  type CurriculumChapter,
} from "../../../supabase/functions/custom-practice-upload/curriculumResolve.ts";

const CATALOG: CurriculumChapter[] = [
  {
    chapter_id: "ch-partnership",
    chapter_name: "Accounting for Partnership",
    subject_name: "Accountancy",
    topics: [
      { topic_id: "t-cap", topic_name: "Capital Accounts" },
      { topic_id: "t-pl", topic_name: "Profit and Loss Appropriation" },
    ],
  },
  {
    chapter_id: "ch-mgmt",
    chapter_name: "Nature and Significance of Management",
    subject_name: "Business Studies",
    topics: [{ topic_id: "t-levels", topic_name: "Levels of Management" }],
  },
];

describe("resolveCurriculumLabels (§5.1 / §7)", () => {
  it("resolves exact chapter + topic", () => {
    expect(
      resolveCurriculumLabels(CATALOG, "Accounting for Partnership", "Capital Accounts"),
    ).toEqual({ chapter_id: "ch-partnership", topic_id: "t-cap" });
  });

  it("returns null topic when topic is not in the chapter", () => {
    expect(
      resolveCurriculumLabels(CATALOG, "Accounting for Partnership", "Levels of Management"),
    ).toEqual({ chapter_id: "ch-partnership", topic_id: null });
  });

  it("returns both null when chapter is unknown — never invents", () => {
    expect(resolveCurriculumLabels(CATALOG, "Made Up Chapter", "Anything")).toEqual({
      chapter_id: null,
      topic_id: null,
    });
  });

  it("narrows by subject hint", () => {
    expect(
      resolveCurriculumLabels(CATALOG, "Nature and Significance of Management", null, "Business Studies"),
    ).toEqual({ chapter_id: "ch-mgmt", topic_id: null });
  });

  it("formatCatalogHint lists subject › chapter and refuses inventing", () => {
    const hint = formatCatalogHint(CATALOG, 5);
    expect(hint).toContain("Accountancy › Accounting for Partnership");
    expect(hint).toMatch(/do not invent/i);
  });
});
