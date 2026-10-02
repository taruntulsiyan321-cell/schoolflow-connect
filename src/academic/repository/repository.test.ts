import { describe, expect, it } from "vitest";
import { AcademicRepositoryError } from "@/academic/repository/errors";
import { ForbiddenError } from "@/academic/services/context";

// The paging helpers and the not-found / tenant / validation errors served the
// school repositories only; they went with the organisation side (2026-10-01).

describe("academic repository — errors", () => {
  it("a refused academic action is a typed repository error with a code", () => {
    const e = new ForbiddenError("Role 'student' cannot modify marks");
    expect(e).toBeInstanceOf(AcademicRepositoryError);
    expect(e.code).toBe("forbidden");
    expect(e.name).toBe("ForbiddenError");
    expect(e.message).toBe("Role 'student' cannot modify marks");
  });
});
