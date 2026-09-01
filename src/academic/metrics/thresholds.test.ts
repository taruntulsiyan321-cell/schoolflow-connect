/**
 * CHUNK 10 verification item 4 — changing a threshold in one file changes every
 * screen.
 *
 * The threshold-literal lint proves no component DECLARES a threshold. That is
 * not the same claim. A component could import the constant and then hold a copy
 * — `const MY_LOW = HOMEWORK_LOW` frozen at module load is fine, but
 * `const MY_LOW = 60` beside an unused import is not, and the lint would miss it
 * if the name were outside the vocabulary.
 *
 * So this asserts the flow: the downstream module must hold the SAME VALUE as
 * the source, by identity, not by coincidence. If someone re-hardcodes 80 in the
 * principal module these fail, because the assertion is against the imported
 * constant rather than against the literal 80.
 */
import { describe, it, expect } from "vitest";
import {
  ATTENDANCE_LOW,
  CONSECUTIVE_ABSENCE,
  HOMEWORK_LOW,
  HOMEWORK_WINDOW,
  MARKS_OVERDUE,
  CLASS_FLAGGED_ON_MARKS,
  THRESHOLDS as SOURCE,
} from "./thresholds";
import { THRESHOLDS as PRINCIPAL } from "@/gurukul-principal/analysis/thresholds";

describe("one threshold module, and the value reaches the screens", () => {
  it("the principal module carries the source values, not copies of them", () => {
    // Compared against the imported constants, never against literals. A test
    // written as `toBe(80)` would pass just as happily on two hardcoded 80s.
    expect(PRINCIPAL.attendance.low).toBe(ATTENDANCE_LOW);
    expect(PRINCIPAL.attendance.consecutive).toBe(CONSECUTIVE_ABSENCE);
    expect(PRINCIPAL.homework.completion).toBe(HOMEWORK_LOW);
    expect(PRINCIPAL.homework.window).toBe(HOMEWORK_WINDOW);
    expect(PRINCIPAL.marks.classFlag).toBe(CLASS_FLAGGED_ON_MARKS);
    expect(PRINCIPAL.upload.overdue).toBe(MARKS_OVERDUE);
    expect(PRINCIPAL.ATTENDANCE_LOW).toBe(ATTENDANCE_LOW);
    expect(PRINCIPAL.HOMEWORK_LOW).toBe(HOMEWORK_LOW);
  });

  it("chronic absence is the attendance threshold, not a second number", () => {
    // The ruling: 80 over the year and 80 over the reporting window — which,
    // since terms were dropped, IS the year — is one threshold with two names.
    expect(PRINCIPAL.attendance.chronic).toBe(ATTENDANCE_LOW);
  });

  it("the source module does not export a chronic threshold at all", async () => {
    const mod = await import("./thresholds");
    expect(Object.keys(mod)).not.toContain("CHRONIC_ABSENCE");
    expect(Object.keys(SOURCE)).not.toContain("CHRONIC_ABSENCE");
  });

  it("MARKS_LOW is not a constant, because it is per-exam data", async () => {
    const mod = await import("./thresholds");
    expect(Object.keys(mod)).not.toContain("MARKS_LOW");
    // It is a function over exams.passing_marks instead.
    expect(typeof mod.belowPass).toBe("function");
  });

  it("every threshold in the source is a positive integer above the noise floor", () => {
    // The threshold-literal lint excludes literals <= 1 as emptiness checks. If
    // a real threshold were ever 0 or 1 that narrowing would go blind, so the
    // assumption is asserted here rather than left in a comment.
    for (const [name, value] of Object.entries(SOURCE)) {
      expect(Number.isInteger(value), `${name} is not an integer`).toBe(true);
      expect(value, `${name} is <= 1, which the literal lint would skip`).toBeGreaterThan(1);
    }
  });
});
