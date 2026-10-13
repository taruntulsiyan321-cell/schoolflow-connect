import { describe, expect, it } from "vitest";
import { buildParentScheduledNarrative } from "../../../supabase/functions/_shared/parentNarrative.ts";

/**
 * fetchParentSummary hands the narrative `null` for a figure that is not known
 * (pctOrNull). The narrative's input type said `number` until 2026-10-13, so
 * nothing checked what it does with one; the edge type-check (E6) found it.
 */
const base = {
  attendance_pct: 82.46,
  homework_completion_pct: 70,
  tests_avg_pct: 64,
  exams_avg_pct: 58,
  source_as_of: "2026-10-01",
  data_version: "v1",
};

describe("the parent narrative with figures that are not known", () => {
  it("says what is known, rounded to one place", () => {
    const n = buildParentScheduledNarrative(base);
    expect(n.bullets).toEqual([
      "Attendance: 82.5%.",
      "Homework completion: 70%.",
      "Tests average: 64%.",
      "Exams average: 58%.",
    ]);
    expect(n.completeness).toBe(0.8);
  });

  it("says 'not available yet' for null, leaves out unknown averages, and claims no completeness for them", () => {
    const n = buildParentScheduledNarrative({
      ...base,
      attendance_pct: null,
      homework_completion_pct: null,
      tests_avg_pct: null,
      exams_avg_pct: null,
    });
    expect(n.bullets).toEqual(["Attendance: not available yet.", "Homework completion: not available yet."]);
    expect(n.narrative).toContain("attendance not available yet, homework completion not available yet.");
    expect(n.narrative).not.toMatch(/null|NaN/);
    expect(n.completeness).toBe(0.2);
  });

  it("treats zero as nothing to report, as before", () => {
    const n = buildParentScheduledNarrative({ ...base, tests_avg_pct: 0, exams_avg_pct: 0 });
    expect(n.bullets.some((b) => b.startsWith("Tests average"))).toBe(false);
    expect(n.completeness).toBe(0.65);
    const a = buildParentScheduledNarrative({ ...base, attendance_pct: 0 });
    expect(a.bullets[0]).toBe("Attendance: not available yet.");
    expect(a.completeness).toBe(0.55);
  });

  it("reports mastery only when it is a known figure", () => {
    expect(buildParentScheduledNarrative({ ...base, avg_mastery: null }).bullets.join(" ")).not.toContain("mastery");
    expect(buildParentScheduledNarrative({ ...base, avg_mastery: 61.04 }).bullets).toContain(
      "Tracked concept mastery average: 61%.",
    );
  });
});
