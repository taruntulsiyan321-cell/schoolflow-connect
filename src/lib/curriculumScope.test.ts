import { describe, expect, it } from "vitest";
import {
  COMMERCE_SUBJECT_ALLOWLIST,
  appliesCommerceSubjectAllowlist,
  filterSubjectsForStream,
  inferStreamFromText,
  isCommerceAllowedSubject,
  isCommerceBlockedSubject,
  isSubjectAllowedForScope,
  normalizeStream,
  normalizeSubjectName,
  parseClassLevel,
  subjectsForStreamPicker,
} from "./curriculumScope";

describe("curriculumScope — class level", () => {
  it("parses class level from common labels", () => {
    expect(parseClassLevel("11-A")).toBe(11);
    expect(parseClassLevel("Class 12 Commerce")).toBe(12);
    expect(parseClassLevel("IX-B")).toBe(null);
    expect(parseClassLevel("10")).toBe(10);
    expect(parseClassLevel(null)).toBe(null);
  });
});

describe("curriculumScope — stream", () => {
  it("normalizes stream tags", () => {
    expect(normalizeStream("commerce")).toBe("commerce");
    expect(normalizeStream("Commerce Stream")).toBe("commerce");
    expect(normalizeStream("PCM")).toBe("science");
    expect(normalizeStream("Arts / Humanities")).toBe("arts");
    expect(normalizeStream("")).toBe(null);
  });

  it("infers stream from class category / label", () => {
    expect(inferStreamFromText("Secondary", "Class 11 Commerce")).toBe("commerce");
    expect(inferStreamFromText("Science")).toBe("science");
  });
});

describe("curriculumScope — commerce allowlist", () => {
  it("normalizes subject aliases to canonical names", () => {
    expect(normalizeSubjectName("Accounts")).toBe("Accountancy");
    expect(normalizeSubjectName("BST")).toBe("Business Studies");
    expect(normalizeSubjectName("Maths")).toBe("Mathematics");
    expect(normalizeSubjectName("English Core")).toBe("English");
  });

  it("allows only commerce subjects", () => {
    for (const s of COMMERCE_SUBJECT_ALLOWLIST) {
      expect(isCommerceAllowedSubject(s)).toBe(true);
    }
    expect(isCommerceAllowedSubject("Accountancy")).toBe(true);
    expect(isCommerceAllowedSubject("Accounts")).toBe(true);
    expect(isCommerceAllowedSubject("Physics")).toBe(false);
    expect(isCommerceAllowedSubject("Biology")).toBe(false);
    expect(isCommerceAllowedSubject("Computer Science")).toBe(false);
    expect(isCommerceAllowedSubject("Science")).toBe(false);
  });

  it("blocks science subjects for commerce", () => {
    expect(isCommerceBlockedSubject("Physics")).toBe(true);
    expect(isCommerceBlockedSubject("Chemistry")).toBe(true);
    expect(isCommerceBlockedSubject("Biology")).toBe(true);
    expect(isCommerceBlockedSubject("Science")).toBe(true);
    expect(isCommerceBlockedSubject("Computer Science")).toBe(true);
    expect(isCommerceBlockedSubject("Accountancy")).toBe(false);
  });

  it("applies allowlist only for commerce class 11+", () => {
    expect(appliesCommerceSubjectAllowlist("commerce", 11)).toBe(true);
    expect(appliesCommerceSubjectAllowlist("commerce", 12)).toBe(true);
    expect(appliesCommerceSubjectAllowlist("commerce", 10)).toBe(false);
    expect(appliesCommerceSubjectAllowlist("science", 11)).toBe(false);
    expect(appliesCommerceSubjectAllowlist(null, 11)).toBe(false);
  });

  it("filters mixed bank subjects down to commerce allowlist", () => {
    const bank = [
      "Physics",
      "Accountancy",
      "Chemistry",
      "Business Studies",
      "Biology",
      "Economics",
      "Mathematics",
      "English",
      "Hindi",
      "Computer Science",
      "Science",
    ];
    expect(filterSubjectsForStream(bank, "commerce", 11)).toEqual([
      "Accountancy",
      "Business Studies",
      "Economics",
      "Mathematics",
      "English",
      "Hindi",
    ]);
    // Class 10 commerce-tagged school: do not strip science
    expect(filterSubjectsForStream(bank, "commerce", 10)).toEqual(bank);
  });

  it("rejects science subjects for commerce scope checks", () => {
    expect(isSubjectAllowedForScope("Physics", "commerce", 11)).toBe(false);
    expect(isSubjectAllowedForScope("Accountancy", "commerce", 11)).toBe(true);
    expect(isSubjectAllowedForScope("Physics", "commerce", 10)).toBe(true);
    expect(isSubjectAllowedForScope("Mixed", "commerce", 11)).toBe(true);
  });

  it("returns commerce picker subjects for class 11 commerce", () => {
    expect(subjectsForStreamPicker("commerce", 11)).toEqual([...COMMERCE_SUBJECT_ALLOWLIST]);
    expect(subjectsForStreamPicker("commerce", 11)).not.toContain("Physics");
    expect(subjectsForStreamPicker("science", 11)).toContain("Physics");
  });
});
