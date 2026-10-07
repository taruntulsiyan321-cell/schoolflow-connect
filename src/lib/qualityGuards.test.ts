import { describe, expect, it } from "vitest";
import {
  buildSubjectRadarPoints,
  isGenericAcademicLabel,
  preferRealAcademicLabel,
} from "@/lib/qualityGuards";
import {
  assertStudentContext,
  evaluateStudentContext,
  studentShellReady,
} from "@/academic/services/assertStudentContext";

describe("qualityGuards — generic labels", () => {
  it("flags Subject|Topic|Daily|General", () => {
    for (const label of ["Subject", "Topic", "Daily", "General", "subject", ""]) {
      expect(isGenericAcademicLabel(label)).toBe(true);
    }
    expect(isGenericAcademicLabel("Mathematics")).toBe(false);
    expect(isGenericAcademicLabel("Integration")).toBe(false);
  });

  it("preferRealAcademicLabel never invents placeholders", () => {
    expect(preferRealAcademicLabel(null, "Topic", "Limits")).toBe("Limits");
    expect(preferRealAcademicLabel("Daily", "General")).toBe("");
    expect(preferRealAcademicLabel("Accountancy")).toBe("Accountancy");
  });
});

describe("qualityGuards — radar axes", () => {
  it("gives every subject its own tick and drops placeholders", () => {
    // "Business Studies" and "Business Economics" shorten to the same initials,
    // and "Biology"/"Biotechnology" to the same four letters.
    const radar = buildSubjectRadarPoints([
      { name: "Business Studies", score: 80 },
      { name: "Business Economics", score: 60 },
      { name: "Biology", score: 70 },
      { name: "Biotechnology", score: 65 },
      { name: "Daily", score: 50 },
    ]);
    expect(radar).toHaveLength(4);
    const ticks = radar.map((r) => r.subject.toLowerCase());
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(radar.every((r) => !isGenericAcademicLabel(r.fullName))).toBe(true);
  });
});

describe("qualityGuards — student context readiness", () => {
  it("evaluateStudentContext rejects missing school / student row", () => {
    expect(evaluateStudentContext(null).ready).toBe(false);
    expect(
      evaluateStudentContext(
        { userId: "u1", role: "student", schoolId: null as unknown as string, studentId: null },
        { requireStudentRow: true },
      ).ready,
    ).toBe(false);
    expect(
      evaluateStudentContext({
        userId: "u1",
        role: "student",
        schoolId: "sch",
        studentId: "stu",
      }).ready,
    ).toBe(true);
  });

  it("assertStudentContext throws without school", () => {
    expect(() =>
      assertStudentContext({
        userId: "u1",
        role: "student",
        schoolId: "" as unknown as string,
        studentId: "stu",
      }),
    ).toThrow(/school/i);
  });

  it("studentShellReady requires academic + progression", () => {
    expect(studentShellReady({ academicReady: false, progressionLoaded: true })).toBe(false);
    expect(studentShellReady({ academicReady: true, progressionLoaded: true })).toBe(true);
  });
});
