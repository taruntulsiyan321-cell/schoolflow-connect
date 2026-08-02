import { describe, expect, it } from "vitest";
import {
  assertStudentContext,
  evaluateStudentContext,
  studentShellReady,
} from "./assertStudentContext";
import type { ServiceContext } from "./context";

const base: ServiceContext = {
  schoolId: "school-1",
  userId: "user-1",
  role: "student",
  studentId: "stu-1",
};

describe("assertStudentContext", () => {
  it("passes for a complete student context", () => {
    expect(() => assertStudentContext(base)).not.toThrow();
  });

  it("throws when school is missing", () => {
    expect(() =>
      assertStudentContext({ ...base, schoolId: "" as unknown as string }),
    ).toThrow(/school/i);
  });

  it("evaluateStudentContext reports not ready without student row when required", () => {
    const r = evaluateStudentContext({ ...base, studentId: null }, { requireStudentRow: true });
    expect(r.ready).toBe(false);
    expect(r.reason).toMatch(/not linked/i);
  });

  it("studentShellReady requires both academic and progression", () => {
    expect(studentShellReady({ academicReady: true, progressionLoaded: false })).toBe(false);
    expect(studentShellReady({ academicReady: true, progressionLoaded: true })).toBe(true);
  });
});
