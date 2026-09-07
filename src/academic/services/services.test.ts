import { describe, expect, it } from "vitest";
import {
  assertCanOwn,
  assertCanConsume,
  ForbiddenError,
  type ServiceContext,
} from "@/academic/services/context";
import { canOwn, canConsume } from "@/academic";

function ctx(role: ServiceContext["role"]): ServiceContext {
  return {
    schoolId: "00000000-0000-4000-8000-000000000001",
    userId: "user-1",
    role,
  };
}

describe("academic services — ownership gates", () => {
  it("allows teacher to own attendance writes", () => {
    expect(() => assertCanOwn(ctx("teacher"), "attendance")).not.toThrow();
    expect(canOwn("teacher", "attendance")).toBe(true);
  });

  it("allows admin to correct attendance", () => {
    expect(() => assertCanOwn(ctx("admin"), "attendance")).not.toThrow();
  });

  it("blocks student from owning attendance writes", () => {
    expect(() => assertCanOwn(ctx("student"), "attendance")).toThrow(ForbiddenError);
  });

  it("allows parent to consume marks but not publish them", () => {
    expect(() => assertCanConsume(ctx("parent"), "marks")).not.toThrow();
    expect(() => assertCanOwn(ctx("parent"), "marks")).toThrow(ForbiddenError);
    expect(canConsume("parent", "marks")).toBe(true);
  });

  it("allows student to own homework submissions", () => {
    expect(() => assertCanOwn(ctx("student"), "homework_submission")).not.toThrow();
  });

  it("blocks teacher from owning practice attempts", () => {
    expect(() => assertCanOwn(ctx("teacher"), "practice_attempt")).toThrow(ForbiddenError);
  });

  // CHANGED DELIBERATELY 2026-09-07, because it encoded the opposite ruling.
  //
  // This used to assert that assertCanConsume(super_admin, "marks") THROWS. The
  // spec says otherwise: §10.20 (docs/locked-decisions.md:611-624) gives the
  // super admin "unrestricted access to academic data, for support". Refusing
  // the read in the service layer is what made the /admin index render an error
  // banner for them while its sub-pages — which query PostgREST directly —
  // rendered fine (KNOWN_ISSUES 17).
  //
  // The half that must NOT change is ownership: support is a read, and §10.20's
  // "Can do" list is platform-level, not authoring a school's records.
  //
  // Reading is not the same as reading SOMETHING. Which school they can see is
  // decided in the database by `my_accessible_school_ids()`, which since
  // 20260911000000 returns only schools with a live, logged, expiring grant. So
  // a super admin with no grant passes this assertion and still reads zero
  // rows. probe22 asserts that end, as the caller.
  it("lets super_admin READ school academic data (§10.20) but never own it", () => {
    expect(() => assertCanOwn(ctx("super_admin"), "student")).toThrow(ForbiddenError);
    expect(() => assertCanOwn(ctx("super_admin"), "marks")).toThrow(ForbiddenError);
    expect(() => assertCanConsume(ctx("super_admin"), "marks")).not.toThrow();
    expect(() => assertCanConsume(ctx("super_admin"), "student")).not.toThrow();
  });
});
