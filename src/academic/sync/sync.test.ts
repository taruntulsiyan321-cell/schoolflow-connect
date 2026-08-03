import { describe, expect, it } from "vitest";
import { plannedTargets } from "@/academic/sync";

describe("academic sync engine", () => {
  it("plans profile + notifications for attendance.marked", () => {
    const targets = plannedTargets("attendance.marked");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("notifications");
    expect(targets).toContain("analytics");
  });

  it("plans profile + AI for marks.published", () => {
    const targets = plannedTargets("marks.published");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("ai_insights");
  });

  it("plans profile + notifications for test.attempt.completed", () => {
    const targets = plannedTargets("test.attempt.completed");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("notifications");
    expect(targets).toContain("analytics");
  });

  it("plans notifications for homework.submitted", () => {
    const targets = plannedTargets("homework.submitted");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("notifications");
  });

  it("plans notifications for marks.results_published", () => {
    const targets = plannedTargets("marks.results_published");
    expect(targets).toContain("notifications");
    expect(targets).toContain("student_academic_profile");
  });
});
