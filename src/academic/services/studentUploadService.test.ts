import { describe, expect, it } from "vitest";
import { modesForVerdict } from "@/academic/services/studentUploadService";

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
