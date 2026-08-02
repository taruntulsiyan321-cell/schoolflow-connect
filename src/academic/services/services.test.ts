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

  it("never elevates super_admin into school academic ownership", () => {
    expect(() => assertCanOwn(ctx("super_admin"), "student")).toThrow(ForbiddenError);
    expect(() => assertCanConsume(ctx("super_admin"), "marks")).toThrow(ForbiddenError);
  });
});
