import { describe, expect, it } from "vitest";
import {
  COMMERCE_SUBJECT_ALLOWLIST,
  SCIENCE_SUBJECT_ALLOWLIST,
  appliesCommerceSubjectAllowlist,
  appliesScienceSubjectAllowlist,
  filterSubjectsForStream,
  inferStreamFromText,
  isCommerceAllowedSubject,
  isCommerceBlockedSubject,
  isScienceAllowedSubject,
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
    expect(parseClassLevel("Class-10")).toBe(10);
    expect(parseClassLevel("Std 9")).toBe(9);
    expect(parseClassLevel("XI-A")).toBe(11);
    expect(parseClassLevel("Class XII Science")).toBe(12);
    expect(parseClassLevel("IX-B")).toBe(9);
    expect(parseClassLevel("10")).toBe(10);
    expect(parseClassLevel("9-C")).toBe(9);
    expect(parseClassLevel(null)).toBe(null);
  });

  it("parses the previously-unsupported Roman numerals VI-IX", () => {
    expect(parseClassLevel("Class VI")).toBe(6);
    expect(parseClassLevel("Class VII")).toBe(7);
    expect(parseClassLevel("Class VIII")).toBe(8);
    expect(parseClassLevel("Class IX")).toBe(9);
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

  it("applies allowlist for commerce class 11 and 12, not ≤10", () => {
    expect(appliesCommerceSubjectAllowlist("commerce", 11)).toBe(true);
    expect(appliesCommerceSubjectAllowlist("commerce", 12)).toBe(true);
    expect(appliesCommerceSubjectAllowlist("commerce", 10)).toBe(false);
    expect(appliesCommerceSubjectAllowlist("commerce", 9)).toBe(false);
    expect(appliesCommerceSubjectAllowlist("science", 11)).toBe(false);
    expect(appliesCommerceSubjectAllowlist(null, 11)).toBe(false);
  });

  it("filters mixed bank subjects down to commerce allowlist for class 11 and 12", () => {
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
    const expected = [
      "Accountancy",
      "Business Studies",
      "Economics",
      "Mathematics",
      "English",
      "Hindi",
    ];
    expect(filterSubjectsForStream(bank, "commerce", 11)).toEqual(expected);
    expect(filterSubjectsForStream(bank, "commerce", 12)).toEqual(expected);
    expect(filterSubjectsForStream(bank, "commerce", 12)).not.toContain("Physics");
    // Class 10 commerce-tagged school: do not strip science / force Accountancy
    expect(filterSubjectsForStream(bank, "commerce", 10)).toEqual(bank);
  });

  it("rejects science subjects for commerce scope checks on 11 and 12", () => {
    expect(isSubjectAllowedForScope("Physics", "commerce", 11)).toBe(false);
    expect(isSubjectAllowedForScope("Physics", "commerce", 12)).toBe(false);
    expect(isSubjectAllowedForScope("Accountancy", "commerce", 11)).toBe(true);
    expect(isSubjectAllowedForScope("Accountancy", "commerce", 12)).toBe(true);
    expect(isSubjectAllowedForScope("Physics", "commerce", 10)).toBe(true);
    expect(isSubjectAllowedForScope("Mixed", "commerce", 11)).toBe(true);
  });

  it("returns commerce picker subjects for class 11 and 12 commerce — never Physics", () => {
    expect(subjectsForStreamPicker("commerce", 11)).toEqual([...COMMERCE_SUBJECT_ALLOWLIST]);
    expect(subjectsForStreamPicker("commerce", 12)).toEqual([...COMMERCE_SUBJECT_ALLOWLIST]);
    expect(subjectsForStreamPicker("commerce", 11)).not.toContain("Physics");
    expect(subjectsForStreamPicker("commerce", 12)).not.toContain("Physics");
    expect(subjectsForStreamPicker("science", 11)).toContain("Physics");
    expect(subjectsForStreamPicker("science", 12)).toContain("Physics");
  });
});

describe("curriculumScope — science allowlist", () => {
  it("allows only senior science subjects", () => {
    for (const s of SCIENCE_SUBJECT_ALLOWLIST) {
      expect(isScienceAllowedSubject(s)).toBe(true);
    }
    expect(isScienceAllowedSubject("Accountancy")).toBe(false);
    expect(isScienceAllowedSubject("Business Studies")).toBe(false);
    expect(isScienceAllowedSubject("Economics")).toBe(false);
    expect(isScienceAllowedSubject("Science")).toBe(false);
  });

  it("applies allowlist for science class 11–12 only", () => {
    expect(appliesScienceSubjectAllowlist("science", 11)).toBe(true);
    expect(appliesScienceSubjectAllowlist("science", 12)).toBe(true);
    expect(appliesScienceSubjectAllowlist("science", 10)).toBe(false);
    expect(appliesScienceSubjectAllowlist("commerce", 11)).toBe(false);
  });

  it("filters bank subjects to science allowlist for class 11 and 12", () => {
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
    ];
    expect(filterSubjectsForStream(bank, "science", 12)).toEqual([
      "Physics",
      "Chemistry",
      "Biology",
      "Mathematics",
      "English",
      "Hindi",
    ]);
    expect(filterSubjectsForStream(bank, "science", 11)).not.toContain("Accountancy");
    // Class 10 science-tagged: keep bank as-is (class_level filter is elsewhere)
    expect(filterSubjectsForStream(bank, "science", 10)).toEqual(bank);
  });

  it("rejects commerce subjects for science class 12", () => {
    expect(isSubjectAllowedForScope("Accountancy", "science", 12)).toBe(false);
    expect(isSubjectAllowedForScope("Physics", "science", 12)).toBe(true);
    expect(isSubjectAllowedForScope("Accountancy", "science", 10)).toBe(true);
  });

  it("returns science picker subjects for class 11 and 12", () => {
    expect(subjectsForStreamPicker("science", 11)).toEqual([...SCIENCE_SUBJECT_ALLOWLIST]);
    expect(subjectsForStreamPicker("science", 12)).toEqual([...SCIENCE_SUBJECT_ALLOWLIST]);
    expect(subjectsForStreamPicker("science", 12)).not.toContain("Accountancy");
  });
});
