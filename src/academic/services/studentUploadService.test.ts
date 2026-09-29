import { describe, expect, it } from "vitest";
import {
  EMPTY_UPLOAD_CONTENT,
  isPractisableQuestion,
  modesForUpload,
  normalizeUploadFiles,
  type UploadContent,
} from "@/academic/services/studentUploadService";

describe("normalizeUploadFiles (multi-file intake)", () => {
  it("accepts a single File", () => {
    const f = new File(["a"], "p1.png", { type: "image/png" });
    expect(normalizeUploadFiles(f)).toEqual([f]);
  });

  it("preserves File[] order for multi-image pages", () => {
    const a = new File(["1"], "page1.jpg", { type: "image/jpeg" });
    const b = new File(["2"], "page2.jpg", { type: "image/jpeg" });
    expect(normalizeUploadFiles([a, b])).toEqual([a, b]);
  });

  it("rejects an empty pick", () => {
    expect(() => normalizeUploadFiles([])).toThrow(/at least one/i);
  });
});

/**
 * §8 — "A mode is never shown for material the upload does not contain."
 * The modes used to follow the verdict alone, so a question paper with no
 * hard question offered "Practise hard only" and one with no questions
 * written from notes offered "Practise from notes" — each an empty session —
 * and "Practise by chapter" was offered for a file of one chapter.
 */
describe("modesForUpload (§8)", () => {
  const ready = { status: "ready" as const };
  const content = (over: Partial<UploadContent>): UploadContent => ({ ...EMPTY_UPLOAD_CONTENT, chapters: [], ...over });
  const two = [{ id: "c1", name: "Ratios", count: 4 }, { id: "c2", name: "Profit", count: 2 }];

  it("offers only what the file holds: no hard question, no hard mode", () => {
    expect(modesForUpload(ready, content({ practisable: 6, chapters: [two[0]] }))).toEqual(["practise_all"]);
  });

  it("offers hard, by chapter, notes and notes practice when each is there", () => {
    expect(modesForUpload(ready, content({ practisable: 6, hard: 2, fromNotes: 3, notes: 2, chapters: two })))
      .toEqual(["practise_all", "practise_by_chapter", "practise_hard", "read_notes", "practise_from_notes"]);
  });

  it("offers by chapter only with two or more chapters to choose between", () => {
    expect(modesForUpload(ready, content({ practisable: 6, chapters: [two[0]] }))).not.toContain("practise_by_chapter");
    expect(modesForUpload(ready, content({ practisable: 6, chapters: two }))).toContain("practise_by_chapter");
  });

  it("notes with nothing written from them can be read, not practised", () => {
    expect(modesForUpload(ready, content({ notes: 3 }))).toEqual(["read_notes"]);
  });

  it("offers nothing for a file that is not ready — unusable, pending or failed (§4.3)", () => {
    const full = content({ practisable: 6, hard: 2, fromNotes: 1, notes: 1, chapters: two });
    for (const status of ["unusable", "pending", "processing", "failed"] as const) {
      expect(modesForUpload({ status }, full)).toEqual([]);
    }
  });
});

describe("isPractisableQuestion — the rule Practice applies", () => {
  it("needs two options and an option index", () => {
    expect(isPractisableQuestion({ options: ["a", "b"], correct_index: 0 })).toBe(true);
    expect(isPractisableQuestion({ options: null, correct_index: null })).toBe(false);
    expect(isPractisableQuestion({ options: ["a"], correct_index: 0 })).toBe(false);
    expect(isPractisableQuestion({ options: ["a", "b"], correct_index: null })).toBe(false);
  });
});
