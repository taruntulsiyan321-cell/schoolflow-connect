import { describe, expect, it } from "vitest";
// plannedTargets was a one-line re-export of syncTargetsFor — a second name
// for one function. The wrapper is gone; this tests the real thing.
import { syncTargetsFor } from "@/academic/sync";

describe("academic sync engine", () => {
  it("plans profile + notifications for attendance.marked", () => {
    const targets = syncTargetsFor("attendance.marked");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("notifications");
    expect(targets).toContain("analytics");
  });

  it("plans profile + AI for marks.published", () => {
    const targets = syncTargetsFor("marks.published");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("ai_insights");
  });

  it("plans profile + notifications for test.attempt.completed", () => {
    const targets = syncTargetsFor("test.attempt.completed");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("notifications");
    expect(targets).toContain("analytics");
  });

  it("plans notifications for homework.submitted", () => {
    const targets = syncTargetsFor("homework.submitted");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("notifications");
  });

  it("plans notifications for marks.results_published", () => {
    const targets = syncTargetsFor("marks.results_published");
    expect(targets).toContain("notifications");
    expect(targets).toContain("student_academic_profile");
  });
});
