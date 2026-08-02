import { describe, expect, it } from "vitest";
import { identityToServiceContext, type StudentAcademicIdentity } from "./resolveStudentContext";
import { MissingSchoolContextError } from "../tenant";

const identity: StudentAcademicIdentity = {
  userId: "user-1",
  role: "student",
  hasStudentRole: true,
  studentId: "stu-1",
  schoolId: "school-1",
  classId: "class-1",
  className: "10",
  classSection: "A",
  classDisplayName: null,
  classCategory: null,
  classLabel: "10-A",
};

describe("identityToServiceContext", () => {
  it("maps identity into ServiceContext with class fields", () => {
    const ctx = identityToServiceContext(identity);
    expect(ctx.role).toBe("student");
    expect(ctx.studentId).toBe("stu-1");
    expect(ctx.classId).toBe("class-1");
    expect(ctx.classLabel).toBe("10-A");
    expect(ctx.schoolId).toBe("school-1");
  });

  it("rejects a global non-student role without student portal capability", () => {
    expect(() => identityToServiceContext({ ...identity, role: "teacher", hasStudentRole: false })).toThrow(
      /Student role required/,
    );
  });

  it("accepts a teacher identity with an explicit linked student portal role", () => {
    // Global role priority may select teacher; student portal access additionally
    // requires both the linked student row and user_roles.student capability.
    const ctx = identityToServiceContext({ ...identity, role: "teacher", hasStudentRole: true });
    expect(ctx.role).toBe("student");
  });

  it("rejects missing school", () => {
    expect(() => identityToServiceContext({ ...identity, schoolId: null })).toThrow(
      MissingSchoolContextError,
    );
  });
});
