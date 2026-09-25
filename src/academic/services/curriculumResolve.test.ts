/**
 * Binding: docs/custom-practice-upload-spec.md §5 / §7
 * Pure resolve — no inventing chapters.
 */
import { describe, expect, it } from "vitest";
import {
  formatCatalogHint,
  readAllPages,
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
    expect(hint).toMatch(/questions and notes/i);
    expect(hint).toMatch(/do not invent/i);
  });

  it("resolves question free-text labels the same way as notes (§5.2 miss path)", () => {
    // Bank miss → AI chapter/topic strings → live ids only when catalog matches.
    expect(
      resolveCurriculumLabels(CATALOG, "Accounting for Partnership", "Capital Accounts", "Accountancy"),
    ).toEqual({ chapter_id: "ch-partnership", topic_id: "t-cap" });
    expect(
      resolveCurriculumLabels(CATALOG, "Not A Real Chapter", "Capital Accounts", "Accountancy"),
    ).toEqual({ chapter_id: null, topic_id: null });
  });
});

describe("readAllPages — the exam catalog sees the whole bank", () => {
  // 4,292 rows, as the CUET bank held on 2026-09-25; the last chapter's rows
  // sit past the first 1,000, where one capped request never reached.
  const bank = Array.from({ length: 4292 }, (_, i) => ({ chapter_id: i < 4000 ? `ch-${i % 30}` : "ch-late" }));
  const capped = (from: number, to: number) =>
    Promise.resolve({ data: bank.slice(from, Math.min(to, from + 999) + 1), error: null });

  it("reads past the API's 1,000-row cap", async () => {
    const rows = await readAllPages(capped);
    expect(rows).toHaveLength(4292);
    expect(new Set(rows.map((r) => r.chapter_id))).toContain("ch-late");
  });

  it("CONTROL: one capped request misses the late chapter", async () => {
    const { data } = await capped(0, 1999);
    expect(new Set(data.map((r) => r.chapter_id))).not.toContain("ch-late");
  });

  it("stops on a short page, and passes an error on", async () => {
    let calls = 0;
    await readAllPages((from, to) => { calls += 1; return Promise.resolve({ data: bank.slice(from, Math.min(to + 1, 1500)), error: null }); });
    expect(calls).toBe(2);
    await expect(readAllPages(() => Promise.resolve({ data: null, error: new Error("boom") }))).rejects.toThrow("boom");
  });
});
