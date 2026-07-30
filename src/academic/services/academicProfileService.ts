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
  listSchoolAcademicProfiles,
  ensureAcademicProfile,
} from "../repository/academicProfileRepository";
import type { StudentAcademicProfile } from "../types";
import type { PageParams } from "../repository/base";
import { isSchoolOperator } from "./context";

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
    if (ctx.role === "parent") {
      throw new ForbiddenError("Class academic profiles are staff-only");
    }
    if (ctx.role === "student") {
      // Students may only read their own class roster profiles (for rankings).
      const { getClient, schoolIdOf } = await import("../repository/base");
      const repo = toRepoContext(ctx);
      const { data: me, error } = await getClient(repo)
        .from("students")
        .select("id, class_id")
        .eq("user_id", ctx.userId)
        .eq("school_id", schoolIdOf(repo))
        .maybeSingle();
      if (error || !me?.class_id || me.class_id !== classId) {
        throw new ForbiddenError("Students may only view rankings for their own class");
      }
    }
    return listClassAcademicProfiles(toRepoContext(ctx), classId, page);
  },

  /** Admin/principal school-wide profiles — rankings & reports must use this, not raw SQL. */
  async listForSchool(
    ctx: ServiceContext,
    page?: PageParams,
  ): Promise<StudentAcademicProfile[]> {
    assertCanConsume(ctx, "student_academic_profile");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("School-wide academic profiles are admin/principal-only");
    }
    return listSchoolAcademicProfiles(toRepoContext(ctx), page);
  },

  /** Bootstrap shell only — does not recompute metrics (Phase 4 sync does). */
  async ensure(ctx: ServiceContext, studentId: string): Promise<string> {
    if (ctx.role !== "admin" && ctx.role !== "principal" && ctx.role !== "super_admin") {
      throw new ForbiddenError("Only school operators may ensure academic profiles");
    }
    return ensureAcademicProfile(toRepoContext(ctx), studentId);
  },
};
