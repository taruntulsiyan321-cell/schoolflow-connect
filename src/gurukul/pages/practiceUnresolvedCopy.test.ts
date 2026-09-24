import { describe, expect, it } from "vitest";
import {
  CLASS_LEVEL_UNRESOLVED_MSG,
  CLASS_UNRESOLVED_MSG,
  EXAM_UNRESOLVED_MSG,
  resolvePracticeUnresolved,
} from "@/gurukul/pages/practiceUnresolvedCopy";

describe("resolvePracticeUnresolved", () => {
  it("never surfaces school-admin copy when examScoped (individual with exam)", () => {
    const result = resolvePracticeUnresolved({
      examScoped: true,
      examUnresolved: false,
      classIdMissing: true,
      classLevelUnresolved: true,
    });
    expect(result.classUnresolved).toBe(false);
    expect(result.classUnresolvedMessage).toBeUndefined();
    expect(CLASS_UNRESOLVED_MSG).toMatch(/school admin/);
    expect(CLASS_LEVEL_UNRESOLVED_MSG).toMatch(/school admin/);
  });

  it("blocks an individual whose exam id never resolved", () => {
    const result = resolvePracticeUnresolved({
      examScoped: false,
      examUnresolved: true,
      classIdMissing: true,
      classLevelUnresolved: false,
    });
    expect(result).toEqual({
      classUnresolved: true,
      classUnresolvedMessage: EXAM_UNRESOLVED_MSG,
    });
    expect(result.classUnresolvedMessage).not.toMatch(/school admin/);
  });

  it("asks school students without a class to see their admin", () => {
    const result = resolvePracticeUnresolved({
      examScoped: false,
      examUnresolved: false,
      classIdMissing: true,
      classLevelUnresolved: false,
    });
    expect(result).toEqual({
      classUnresolved: true,
      classUnresolvedMessage: CLASS_UNRESOLVED_MSG,
    });
  });

  it("asks school students with an unreadable class level to see their admin", () => {
    const result = resolvePracticeUnresolved({
      examScoped: false,
      examUnresolved: false,
      classIdMissing: false,
      classLevelUnresolved: true,
    });
    expect(result).toEqual({
      classUnresolved: true,
      classUnresolvedMessage: CLASS_LEVEL_UNRESOLVED_MSG,
    });
  });

  it("does not block when scope is fully resolved for a school student", () => {
    expect(
      resolvePracticeUnresolved({
        examScoped: false,
        examUnresolved: false,
        classIdMissing: false,
        classLevelUnresolved: false,
      }),
    ).toEqual({ classUnresolved: false, classUnresolvedMessage: undefined });
  });
});
