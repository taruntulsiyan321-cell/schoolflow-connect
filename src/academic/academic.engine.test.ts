import { describe, expect, it } from "vitest";
import { ENTITY_REGISTRY, tableFor } from "@/academic/entities";
import { ENTITY_OWNERSHIP, canOwn, canConsume } from "@/academic/ownership";
import { requireSchoolId, MissingSchoolContextError } from "@/academic/tenant";

describe("academic engine — entity registry", () => {
  it("maps assignment to homework (single source of truth)", () => {
    expect(tableFor("assignment")).toBe("homework");
    expect(tableFor("assignment_submission")).toBe("homework_submissions");
    expect(tableFor("test")).toBe("tests");
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

describe("academic engine — tenant", () => {
  it("requires school id", () => {
    expect(() => requireSchoolId(null)).toThrow(MissingSchoolContextError);
    expect(requireSchoolId("abc")).toBe("abc");
  });
});
