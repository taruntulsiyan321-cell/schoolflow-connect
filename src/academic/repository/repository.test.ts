import { describe, expect, it } from "vitest";
import { normalizePage, DEFAULT_PAGE_LIMIT, MAX_PAGE_LIMIT } from "@/academic/repository/base";
import {
  AcademicRepositoryError,
  ValidationFailedError,
  TenantViolationError,
  NotFoundError,
} from "@/academic/repository/errors";
import { validateMarks, validateAttendanceDate } from "@/academic";

describe("academic repository — pagination", () => {
  it("applies defaults and clamps to max", () => {
    expect(normalizePage()).toEqual({ limit: DEFAULT_PAGE_LIMIT, offset: 0 });
    expect(normalizePage({ limit: 9999, offset: -5 })).toEqual({
      limit: MAX_PAGE_LIMIT,
      offset: 0,
    });
  });
});

describe("academic repository — errors", () => {
  it("exposes typed error hierarchy", () => {
    const v = new ValidationFailedError([
      { field: "marks", code: "exceeds_max", message: "too high" },
    ]);
    expect(v).toBeInstanceOf(AcademicRepositoryError);
    expect(v.code).toBe("validation_failed");
    expect(new TenantViolationError()).toBeInstanceOf(AcademicRepositoryError);
    expect(new NotFoundError("exam", "1").message).toContain("exam");
  });
});

describe("academic repository — validation gate", () => {
  it("blocks invalid attendance dates before write", () => {
    expect(validateAttendanceDate("30-07-2026").ok).toBe(false);
    expect(validateAttendanceDate("2026-07-30").ok).toBe(true);
  });

  it("blocks marks above max before write", () => {
    expect(validateMarks(120, 100).ok).toBe(false);
  });
});
