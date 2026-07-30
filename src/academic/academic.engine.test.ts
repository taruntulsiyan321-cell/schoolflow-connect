import { describe, expect, it } from "vitest";
import {
  ENTITY_REGISTRY,
  tableFor,
  ENTITY_OWNERSHIP,
  canOwn,
  canConsume,
  ACADEMIC_EVENT_TYPES,
  syncTargetsFor,
  validateMarks,
  validateAcademicYearRange,
  requireSchoolId,
  MissingSchoolContextError,
} from "@/academic";

describe("academic engine — entity registry", () => {
  it("maps assignment to homework (single source of truth)", () => {
    expect(tableFor("assignment")).toBe("homework");
    expect(tableFor("assignment_submission")).toBe("homework_submissions");
    expect(tableFor("test")).toBe("dpps");
    expect(tableFor("examination_marks")).toBe("marks");
    expect(tableFor("section")).toBe("classes");
  });

  it("marks every operational entity as tenant-scoped except school", () => {
    expect(ENTITY_REGISTRY.school.tenantScoped).toBe(false);
    expect(ENTITY_REGISTRY.attendance.tenantScoped).toBe(true);
    expect(ENTITY_REGISTRY.student_academic_profile.tenantScoped).toBe(true);
  });
});

describe("academic engine — ownership", () => {
  it("gives attendance write ownership to teacher only", () => {
    expect(canOwn("teacher", "attendance")).toBe(true);
    expect(canOwn("student", "attendance")).toBe(false);
    expect(canConsume("parent", "attendance")).toBe(true);
    expect(canConsume("principal", "attendance")).toBe(true);
  });

  it("forbids UI ownership of academic profile (sync-owned)", () => {
    expect(ENTITY_OWNERSHIP.student_academic_profile.owners).toEqual(["admin"]);
    expect(canConsume("student", "student_academic_profile")).toBe(true);
  });
});

describe("academic engine — events", () => {
  it("has sync targets for marks.published including profile + notifications", () => {
    const targets = syncTargetsFor("marks.published");
    expect(targets).toContain("student_academic_profile");
    expect(targets).toContain("notifications");
    expect(targets).toContain("ai_insights");
  });

  it("lists a stable event catalog", () => {
    expect(ACADEMIC_EVENT_TYPES.length).toBeGreaterThan(10);
    expect(ACADEMIC_EVENT_TYPES).toContain("attendance.marked");
  });
});

describe("academic engine — validation", () => {
  it("rejects marks above max", () => {
    const r = validateMarks(105, 100);
    expect(r.ok).toBe(false);
  });

  it("accepts valid marks", () => {
    expect(validateMarks(88, 100).ok).toBe(true);
  });

  it("rejects inverted academic year range", () => {
    expect(validateAcademicYearRange("2026-04-01", "2025-03-31").ok).toBe(false);
  });
});

describe("academic engine — tenant", () => {
  it("requires school id", () => {
    expect(() => requireSchoolId(null)).toThrow(MissingSchoolContextError);
    expect(requireSchoolId("abc")).toBe("abc");
  });
});
