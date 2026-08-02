import { describe, expect, it } from "vitest";
import {
  dedupeSubjectChartPoints,
  buildSubjectRadarPoints,
  hasXpInventFingerprint,
  isGenericAcademicLabel,
  preferRealAcademicLabel,
} from "@/lib/qualityGuards";
import { PRESENTATION_MODE } from "@/lib/presentationMode";
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

describe("qualityGuards — duplicate subjects", () => {
  it("merges Maths / Math / Mathematics into one row", () => {
    const rows = dedupeSubjectChartPoints([
      { name: "Maths", accuracy: 80, attempts: 10 },
      { name: "Mathematics", accuracy: 60, attempts: 10 },
      { name: "Math", accuracy: 70, attempts: 5 },
      { name: "Subject", accuracy: 99, attempts: 99 },
    ]);
    expect(rows).toHaveLength(1);
    expect(rows[0].name).toBe("Mathematics");
    expect(rows[0].attempts).toBe(25);
    expect(rows[0].accuracy).toBe(Math.round((80 * 10 + 60 * 10 + 70 * 5) / 25));
  });

  it("radar ticks stay unique after alias merge", () => {
    const subjects = dedupeSubjectChartPoints([
      { name: "Maths", accuracy: 80, attempts: 10 },
      { name: "Mathematics", accuracy: 60, attempts: 10 },
      { name: "Accountancy", accuracy: 70, attempts: 8 },
      { name: "Daily", accuracy: 50, attempts: 4 },
    ]);
    const radar = buildSubjectRadarPoints(subjects.map((s) => ({ name: s.name, score: s.accuracy })));
    expect(radar).toHaveLength(2);
    const ticks = radar.map((r) => r.subject.toLowerCase());
    expect(new Set(ticks).size).toBe(ticks.length);
    expect(radar.every((r) => !isGenericAcademicLabel(r.fullName))).toBe(true);
  });
});

describe("qualityGuards — XP invent + presentation", () => {
  it("detects demo XP fingerprints", () => {
    expect(hasXpInventFingerprint('const s = { xp: 1382, level: 14 }')).toBe(true);
    expect(hasXpInventFingerprint('const s = { xp: 0, level: 1 }')).toBe(false);
  });

  it("PRESENTATION_MODE stays false", () => {
    expect(PRESENTATION_MODE).toBe(false);
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
