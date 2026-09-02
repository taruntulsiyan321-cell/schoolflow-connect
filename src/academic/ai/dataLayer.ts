import type { ClassAiSummary, SchoolAiSummary, StudentAiSummary } from "../types";
import { getStudentAcademicProfile, listClassAcademicProfiles } from "../repository/academicProfileRepository";
import type { RepoContext } from "../repository/base";
import { getClassPerformance, getSchoolPerformance } from "../analytics/foundation";

/**
 * AiDataLayer — structured summaries for AI modules.
 * AI must not query raw academic tables; use these summaries only.
 */

function topicsFromMetrics(metrics: Record<string, unknown>, key: string): string[] {
  const raw = metrics[key];
  if (Array.isArray(raw)) return raw.map(String).slice(0, 20);
  return [];
}

export async function buildStudentAiSummary(
  ctx: RepoContext,
  studentId: string,
): Promise<StudentAiSummary> {
  const profile = await getStudentAcademicProfile(ctx, studentId);
  if (!profile) {
    const { schoolIdOf } = await import("../repository/base");
    return {
      studentId,
      schoolId: schoolIdOf(ctx),
      attendancePct: 0,
      homeworkCompletionPct: 0,
      testsAvgPct: 0,
      examsAvgPct: 0,
      practiceAccuracyPct: 0,
      doubtsAsked: 0,
      doubtsResolved: 0,
      weakTopics: [],
      trends: { isEmpty: true },
    };
  }

  return {
    studentId: profile.studentId,
    schoolId: profile.schoolId,
    attendancePct: profile.attendancePct,
    homeworkCompletionPct: profile.homeworkCompletionPct,
    testsAvgPct: profile.testsAvgPct,
    examsAvgPct: profile.examsAvgPct,
    practiceAccuracyPct: profile.practiceAccuracyPct,
    doubtsAsked: profile.doubtsAsked,
    doubtsResolved: profile.doubtsResolved,
    weakTopics: topicsFromMetrics(profile.metrics, "weakTopics"),
    trends: {
      lastEventType: profile.lastEventType,
      lastEventAt: profile.lastEventAt,
      refreshedAt: profile.refreshedAt,
      remarksCount: profile.remarksCount,
      homeworkAssigned: profile.homeworkAssigned,
      homeworkSubmitted: profile.homeworkSubmitted,
      homeworkPending: Number(profile.metrics.homeworkPending ?? 0),
      homeworkLate: Number(profile.metrics.homeworkLate ?? 0),
      homeworkReturned: Number(profile.metrics.homeworkReturned ?? 0),
      homeworkReviewed: Number(profile.metrics.homeworkReviewed ?? 0),
      homeworkGraded: Number(profile.metrics.homeworkGraded ?? 0),
      homeworkConsistencyPct: Number(profile.metrics.homeworkConsistencyPct ?? 0),
    },
  };
}

export async function buildClassAiSummary(
  ctx: RepoContext,
  classId: string,
): Promise<ClassAiSummary> {
  const perf = await getClassPerformance(ctx, classId);
  return {
    classId,
    schoolId: ctx.schoolId,
    studentCount: perf.studentCount,
    avgAttendancePct: perf.avgAttendancePct,
    avgHomeworkCompletionPct: perf.avgHomeworkCompletionPct,
    avgMarksPct: perf.avgExamsPct,
  };
}

export async function buildSchoolAiSummary(ctx: RepoContext): Promise<SchoolAiSummary> {
  const perf = await getSchoolPerformance(ctx);
  return {
    schoolId: ctx.schoolId,
    classCount: perf.classCount,
    studentCount: perf.studentCount,
    teacherCount: perf.teacherCount,
    avgAttendancePct: perf.avgAttendancePct,
    avgHomeworkCompletionPct: perf.avgHomeworkCompletionPct,
    avgMarksPct: perf.avgExamsPct,
  };
}

export async function buildTeacherAiSummary(
  ctx: RepoContext,
  teacherId: string,
): Promise<{
  teacherId: string;
  schoolId: string;
  classCount: number;
  assignedSubjects: string[];
}> {
  const { getClient, schoolIdOf, throwIfError } = await import("../repository/base");
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("teacher_classes")
    .select("class_id, subject")
    .eq("school_id", schoolId)
    .eq("teacher_id", teacherId);

  throwIfError(error, "Failed to load teacher assignments");
  const rows = data ?? [];
  const classes = new Set(rows.map((r) => r.class_id));
  const subjects = [...new Set(rows.map((r) => r.subject).filter(Boolean))] as string[];

  return {
    teacherId,
    schoolId,
    classCount: classes.size,
    assignedSubjects: subjects,
  };
}

/** Convenience: class profiles for AI batch prompts (structured, not raw rows). */
export async function listClassStudentSummaries(
  ctx: RepoContext,
  classId: string,
): Promise<StudentAiSummary[]> {
  const profiles = await listClassAcademicProfiles(ctx, classId, { limit: 200 });
  return profiles.map((profile) => ({
    studentId: profile.studentId,
    schoolId: profile.schoolId,
    attendancePct: profile.attendancePct,
    homeworkCompletionPct: profile.homeworkCompletionPct,
    testsAvgPct: profile.testsAvgPct,
    examsAvgPct: profile.examsAvgPct,
    practiceAccuracyPct: profile.practiceAccuracyPct,
    doubtsAsked: profile.doubtsAsked,
    doubtsResolved: profile.doubtsResolved,
    weakTopics: topicsFromMetrics(profile.metrics, "weakTopics"),
    trends: {
      lastEventType: profile.lastEventType,
      lastEventAt: profile.lastEventAt,
      refreshedAt: profile.refreshedAt,
    },
  }));
}

export const AiDataLayer = {
  buildStudentAiSummary,
  buildClassAiSummary,
  buildSchoolAiSummary,
  buildTeacherAiSummary,
  listClassStudentSummaries,
};
