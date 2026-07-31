import {
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "../services/context";
import { AnalyticsFoundation } from "../analytics";
import { AiDataLayer } from "../ai";
import { AuditService } from "../audit";
import { assertMayAccessStudent } from "./parentAccess";

/**
 * Read-side services for analytics, AI summaries, and audit.
 * Enforce consumer roles + centralized student ownership; never expose raw multi-table dumps to AI.
 */
export const AnalyticsService = {
  async forStudent(ctx: ServiceContext, studentId: string) {
    assertCanConsume(ctx, "analytics");
    await assertMayAccessStudent(ctx, studentId);
    return AnalyticsFoundation.getStudentAnalytics(toRepoContext(ctx), studentId);
  },

  async forClass(ctx: ServiceContext, classId: string) {
    assertCanConsume(ctx, "analytics");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Class analytics are staff-only");
    }
    if (ctx.role === "teacher") {
      const { assertTeacherOwnsClass } = await import("../repository/teacherClassesRepository");
      await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
    }
    return AnalyticsFoundation.getClassPerformance(toRepoContext(ctx), classId);
  },

  async forSchool(ctx: ServiceContext) {
    assertCanConsume(ctx, "analytics");
    if (ctx.role === "student" || ctx.role === "parent" || ctx.role === "teacher") {
      throw new ForbiddenError("School analytics are admin/principal-only");
    }
    return AnalyticsFoundation.getSchoolPerformance(toRepoContext(ctx));
  },

  /** Per-class academic rollups — attendance/homework/marks averages from profiles. */
  async classRollups(ctx: ServiceContext) {
    assertCanConsume(ctx, "analytics");
    if (ctx.role === "student" || ctx.role === "parent" || ctx.role === "teacher") {
      throw new ForbiddenError("Class rollups are admin/principal-only");
    }
    return AnalyticsFoundation.getSchoolClassRollups(toRepoContext(ctx));
  },

  /** Teacher rollup from assigned class profiles — principal/admin (or self). */
  async forTeacher(ctx: ServiceContext, teacherId: string) {
    assertCanConsume(ctx, "analytics");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Teacher analytics are staff-only");
    }
    if (ctx.role === "teacher") {
      const { getTeacherIdForUser } = await import("../repository/teacherAssignmentRepository");
      const selfId = await getTeacherIdForUser(toRepoContext(ctx), ctx.userId);
      if (!selfId || selfId !== teacherId) {
        throw new ForbiddenError("Teachers may only view their own analytics");
      }
    }
    return AnalyticsFoundation.getTeacherPerformance(toRepoContext(ctx), teacherId);
  },
};

export const AiSummaryService = {
  async student(ctx: ServiceContext, studentId: string) {
    assertCanConsume(ctx, "ai_insights");
    await assertMayAccessStudent(ctx, studentId);
    return AiDataLayer.buildStudentAiSummary(toRepoContext(ctx), studentId);
  },

  async class(ctx: ServiceContext, classId: string) {
    assertCanConsume(ctx, "ai_insights");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Class AI summaries are staff-only");
    }
    if (ctx.role === "teacher") {
      const { assertTeacherOwnsClass } = await import("../repository/teacherClassesRepository");
      await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
    }
    return AiDataLayer.buildClassAiSummary(toRepoContext(ctx), classId);
  },

  async school(ctx: ServiceContext) {
    assertCanConsume(ctx, "ai_insights");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("School AI summaries are admin/principal-only");
    }
    return AiDataLayer.buildSchoolAiSummary(toRepoContext(ctx));
  },

  async teacher(ctx: ServiceContext, teacherId: string) {
    assertCanConsume(ctx, "ai_insights");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Teacher AI summaries are staff-only");
    }
    return AiDataLayer.buildTeacherAiSummary(toRepoContext(ctx), teacherId);
  },
};

export const AuditReadService = {
  async forEntity(ctx: ServiceContext, entityType: string, entityId: string) {
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Audit trail is admin/principal-only");
    }
    return AuditService.listAuditForEntity(toRepoContext(ctx), entityType, entityId);
  },

  async recent(ctx: ServiceContext) {
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Audit trail is admin/principal-only");
    }
    return AuditService.listRecentAudit(toRepoContext(ctx));
  },
};
