import {
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import {
  getStudentAcademicProfile,
  requireStudentAcademicProfile,
  listClassAcademicProfiles,
  ensureAcademicProfile,
} from "../repository/academicProfileRepository";
import type { StudentAcademicProfile } from "../types";
import type { PageParams } from "../repository/base";

/**
 * AcademicProfileService — read-only for panels.
 * Writes are owned by the sync engine (Phase 4), not UI.
 */
export const AcademicProfileService = {
  async get(
    ctx: ServiceContext,
    studentId: string,
  ): Promise<StudentAcademicProfile | null> {
    assertCanConsume(ctx, "student_academic_profile");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own academic profile");
    }
    return getStudentAcademicProfile(toRepoContext(ctx), studentId);
  },

  async require(ctx: ServiceContext, studentId: string): Promise<StudentAcademicProfile> {
    assertCanConsume(ctx, "student_academic_profile");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own academic profile");
    }
    return requireStudentAcademicProfile(toRepoContext(ctx), studentId);
  },

  async listForClass(
    ctx: ServiceContext,
    classId: string,
    page?: PageParams,
  ): Promise<StudentAcademicProfile[]> {
    assertCanConsume(ctx, "student_academic_profile");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Class academic profiles are staff-only");
    }
    return listClassAcademicProfiles(toRepoContext(ctx), classId, page);
  },

  /** Bootstrap shell only — does not recompute metrics (Phase 4 sync does). */
  async ensure(ctx: ServiceContext, studentId: string): Promise<string> {
    if (ctx.role !== "admin" && ctx.role !== "principal" && ctx.role !== "super_admin") {
      throw new ForbiddenError("Only school operators may ensure academic profiles");
    }
    return ensureAcademicProfile(toRepoContext(ctx), studentId);
  },
};
