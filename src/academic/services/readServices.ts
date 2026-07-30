import {
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "../services/context";
import { AnalyticsFoundation } from "../analytics";
import { AiDataLayer } from "../ai";
import { AuditService } from "../audit";

/**
 * Read-side services for analytics, AI summaries, and audit.
 * Enforce consumer roles; never expose raw multi-table dumps to AI.
 */
export const AnalyticsService = {
  async forStudent(ctx: ServiceContext, studentId: string) {
    assertCanConsume(ctx, "analytics");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own analytics");
    }
    return AnalyticsFoundation.getStudentAnalytics(toRepoContext(ctx), studentId);
  },

  async forClass(ctx: ServiceContext, classId: string) {
    assertCanConsume(ctx, "analytics");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Class analytics are staff-only");
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
};

export const AiSummaryService = {
  async student(ctx: ServiceContext, studentId: string) {
    assertCanConsume(ctx, "ai_insights");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own AI summary");
    }
    return AiDataLayer.buildStudentAiSummary(toRepoContext(ctx), studentId);
  },

  async class(ctx: ServiceContext, classId: string) {
    assertCanConsume(ctx, "ai_insights");
    if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Class AI summaries are staff-only");
    }
    return AiDataLayer.buildClassAiSummary(toRepoContext(ctx), classId);
  },

  async school(ctx: ServiceContext) {
    assertCanConsume(ctx, "ai_insights");
    if (ctx.role !== "admin" && ctx.role !== "principal" && ctx.role !== "super_admin") {
      throw new ForbiddenError("School AI summaries are admin/principal-only");
    }
    return AiDataLayer.buildSchoolAiSummary(toRepoContext(ctx));
  },

  async teacher(ctx: ServiceContext, teacherId: string) {
    assertCanConsume(ctx, "ai_insights");
    return AiDataLayer.buildTeacherAiSummary(toRepoContext(ctx), teacherId);
  },
};

export const AuditReadService = {
  async forEntity(ctx: ServiceContext, entityType: string, entityId: string) {
    if (ctx.role !== "admin" && ctx.role !== "principal" && ctx.role !== "super_admin") {
      throw new ForbiddenError("Audit trail is admin/principal-only");
    }
    return AuditService.listAuditForEntity(toRepoContext(ctx), entityType, entityId);
  },

  async recent(ctx: ServiceContext) {
    if (ctx.role !== "admin" && ctx.role !== "principal" && ctx.role !== "super_admin") {
      throw new ForbiddenError("Audit trail is admin/principal-only");
    }
    return AuditService.listRecentAudit(toRepoContext(ctx));
  },
};
