import { describe, expect, it } from "vitest";
import {
  modesForVerdict,
  normalizeUploadFiles,
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

describe("modesForVerdict (§8)", () => {
  it("offers question modes only for questions", () => {
    expect(modesForVerdict("questions")).toEqual([
      "practise_all",
      "practise_by_chapter",
      "practise_hard",
    ]);
  });

  it("offers note modes only for notes", () => {
    expect(modesForVerdict("notes")).toEqual(["read_notes", "practise_from_notes"]);
  });

  it("offers both for mixed", () => {
    expect(modesForVerdict("mixed")).toEqual([
      "practise_all",
      "practise_by_chapter",
      "practise_hard",
      "read_notes",
      "practise_from_notes",
    ]);
  });

  it("offers nothing for unusable — §4.3 / §8", () => {
    expect(modesForVerdict("unusable")).toEqual([]);
  });

  it("offers nothing before classification", () => {
    expect(modesForVerdict(null)).toEqual([]);
    expect(modesForVerdict(undefined)).toEqual([]);
  });
});
