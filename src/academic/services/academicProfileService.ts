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
  listSchoolAcademicProfileExtremes,
  ensureAcademicProfile,
} from "../repository/academicProfileRepository";
import { getPublishedExamsAverage } from "../repository/marksRepository";
import type { StudentAcademicProfile } from "../types";
import type { PageParams } from "../repository/base";
import { isSchoolOperator } from "./context";
import { assertMayAccessStudent } from "./parentAccess";

/**
 * exams_avg_pct/exams_recorded on the profile are computed across ALL marks
 * (teacher/principal early-intervention signal, pre-publish included). A
 * student or parent viewing their own/child's profile must only ever see the
 * published-results average — same gate MarksService.listForStudent already
 * applies to the marks list itself.
 */
async function withPublishedExamsAverage(
  ctx: ServiceContext,
  studentId: string,
  profile: StudentAcademicProfile | null,
): Promise<StudentAcademicProfile | null> {
  if (!profile || !(ctx.role === "student" || ctx.role === "parent")) return profile;
  const pub = await getPublishedExamsAverage(toRepoContext(ctx), studentId);
  return { ...profile, examsAvgPct: pub.averagePct, examsRecorded: pub.count };
}

/**
 * AcademicProfileService — read-only for panels.
 * Writes are owned by the sync engine (Phase 4), not UI.
 * All student-scoped reads use assertMayAccessStudent.
 */
export const AcademicProfileService = {
  async get(
    ctx: ServiceContext,
    studentId: string,
  ): Promise<StudentAcademicProfile | null> {
    assertCanConsume(ctx, "student_academic_profile");
    await assertMayAccessStudent(ctx, studentId);
    const profile = await getStudentAcademicProfile(toRepoContext(ctx), studentId);
    return withPublishedExamsAverage(ctx, studentId, profile);
  },

  async require(ctx: ServiceContext, studentId: string): Promise<StudentAcademicProfile> {
    assertCanConsume(ctx, "student_academic_profile");
    await assertMayAccessStudent(ctx, studentId);
    const profile = await requireStudentAcademicProfile(toRepoContext(ctx), studentId);
    return (await withPublishedExamsAverage(ctx, studentId, profile)) as StudentAcademicProfile;
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
    if (ctx.role === "teacher") {
      const { assertTeacherOwnsClass } = await import("../repository/teacherClassesRepository");
      await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
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

  /** True school-wide top/bottom-N by one metric — see listSchoolAcademicProfileExtremes
   *  for why this exists instead of paging listForSchool and re-sorting client-side. */
  async listSchoolExtremes(
    ctx: ServiceContext,
    metric: "exams" | "attendance",
    n = 5,
  ): Promise<{ top: StudentAcademicProfile[]; bottom: StudentAcademicProfile[] }> {
    assertCanConsume(ctx, "student_academic_profile");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("School-wide academic profiles are admin/principal-only");
    }
    return listSchoolAcademicProfileExtremes(
      toRepoContext(ctx),
      metric === "exams" ? "exams_avg_pct" : "attendance_pct",
      n,
    );
  },

  /** Bootstrap shell only — does not recompute metrics (Phase 4 sync does). */
  async ensure(ctx: ServiceContext, studentId: string): Promise<string> {
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only school operators may ensure academic profiles");
    }
    return ensureAcademicProfile(toRepoContext(ctx), studentId);
  },
};
