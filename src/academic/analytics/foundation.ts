import type { StudentAcademicProfile } from "../types";
import {
  getStudentAcademicProfile,
  listClassAcademicProfiles,
} from "../repository/academicProfileRepository";
import { getClient, schoolIdOf, throwIfError, type RepoContext } from "../repository/base";

/**
 * AnalyticsFoundation — compute metrics from academic facts / profiles.
 * Never stores duplicate academic rows; reads profiles + aggregates.
 */

export interface AttendanceAnalytics {
  present: number;
  total: number;
  pct: number;
}

export interface CompletionAnalytics {
  assigned: number;
  completed: number;
  pct: number;
}

export interface MarksAnalytics {
  count: number;
  averagePct: number;
  highestPct: number | null;
  lowestPct: number | null;
}

export type StudentAnalyticsBundle = {
  attendance: AttendanceAnalytics;
  homework: CompletionAnalytics;
  tests: MarksAnalytics;
  exams: MarksAnalytics;
  practice: CompletionAnalytics;
  profile: StudentAcademicProfile;
  /** True when no profile row exists yet — zeros, not an error. */
  isEmpty: boolean;
};

/** Zeroed profile shell so panels can render before sync creates a row. */
export function emptyStudentProfile(studentId: string, schoolId: string): StudentAcademicProfile {
  return {
    id: "",
    schoolId,
    studentId,
    academicYearId: null,
    attendancePresent: 0,
    attendanceTotal: 0,
    attendancePct: 0,
    homeworkAssigned: 0,
    homeworkSubmitted: 0,
    homeworkCompletionPct: 0,
    testsAttempted: 0,
    testsAvgPct: 0,
    examsRecorded: 0,
    examsAvgPct: 0,
    practiceSessions: 0,
    practiceAccuracyPct: 0,
    doubtsAsked: 0,
    doubtsResolved: 0,
    remarksCount: 0,
    metrics: {},
    lastEventType: null,
    lastEventAt: null,
    refreshedAt: new Date().toISOString(),
  };
}

export function attendanceFromProfile(profile: StudentAcademicProfile): AttendanceAnalytics {
  return {
    present: profile.attendancePresent,
    total: profile.attendanceTotal,
    pct: profile.attendancePct,
  };
}

export function homeworkCompletionFromProfile(profile: StudentAcademicProfile): CompletionAnalytics {
  return {
    assigned: profile.homeworkAssigned,
    completed: profile.homeworkSubmitted,
    pct: profile.homeworkCompletionPct,
  };
}

export function averageMarksFromProfile(profile: StudentAcademicProfile): MarksAnalytics {
  return {
    count: profile.examsRecorded,
    averagePct: profile.examsAvgPct,
    highestPct: null,
    lowestPct: null,
  };
}

function bundleFromProfile(profile: StudentAcademicProfile, isEmpty: boolean): StudentAnalyticsBundle {
  return {
    profile,
    isEmpty,
    attendance: attendanceFromProfile(profile),
    homework: homeworkCompletionFromProfile(profile),
    tests: {
      count: profile.testsAttempted,
      averagePct: profile.testsAvgPct,
      highestPct: null,
      lowestPct: null,
    },
    exams: averageMarksFromProfile(profile),
    practice: {
      assigned: profile.practiceSessions,
      completed: profile.practiceSessions,
      pct: profile.practiceAccuracyPct,
    },
  };
}

/**
 * Student analytics. Missing profile → empty zeros (isEmpty: true), never NotFound.
 * Callers must authorize before invoking.
 */
export async function getStudentAnalytics(
  ctx: RepoContext,
  studentId: string,
): Promise<StudentAnalyticsBundle> {
  const profile = await getStudentAcademicProfile(ctx, studentId);
  if (!profile) {
    return bundleFromProfile(emptyStudentProfile(studentId, schoolIdOf(ctx)), true);
  }
  return bundleFromProfile(profile, false);
}

export async function getClassPerformance(
  ctx: RepoContext,
  classId: string,
): Promise<{
  studentCount: number;
  avgAttendancePct: number;
  avgHomeworkCompletionPct: number;
  avgExamsPct: number;
  avgTestsPct: number;
}> {
  const profiles = await listClassAcademicProfiles(ctx, classId, { limit: 200 });
  const n = profiles.length || 1;
  const sum = (fn: (p: StudentAcademicProfile) => number) =>
    profiles.reduce((a, p) => a + fn(p), 0);

  return {
    studentCount: profiles.length,
    avgAttendancePct: round(sum((p) => p.attendancePct) / n),
    avgHomeworkCompletionPct: round(sum((p) => p.homeworkCompletionPct) / n),
    avgExamsPct: round(sum((p) => p.examsAvgPct) / n),
    avgTestsPct: round(sum((p) => p.testsAvgPct) / n),
  };
}

export async function getSchoolPerformance(ctx: RepoContext): Promise<{
  classCount: number;
  studentCount: number;
  teacherCount: number;
  avgAttendancePct: number;
  avgExamsPct: number;
  avgHomeworkCompletionPct: number;
  avgTestsPct: number;
}> {
  const schoolId = schoolIdOf(ctx);
  const client = getClient(ctx);

  const [classes, students, teachers, profiles] = await Promise.all([
    client.from("classes").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client.from("teachers").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client
      .from("student_academic_profiles")
      .select("attendance_pct, exams_avg_pct, homework_completion_pct, tests_avg_pct")
      .eq("school_id", schoolId)
      .limit(5000),
  ]);

  throwIfError(classes.error, "Failed to count classes");
  throwIfError(students.error, "Failed to count students");
  throwIfError(teachers.error, "Failed to count teachers");
  throwIfError(profiles.error, "Failed to load profiles");

  const rows = profiles.data ?? [];
  const n = rows.length || 1;
  const avg = (key: string) =>
    rows.reduce((a, r) => a + Number((r as Record<string, unknown>)[key] ?? 0), 0) / n;

  return {
    classCount: classes.count ?? 0,
    studentCount: students.count ?? 0,
    teacherCount: teachers.count ?? 0,
    avgAttendancePct: round(avg("attendance_pct")),
    avgExamsPct: round(avg("exams_avg_pct")),
    avgHomeworkCompletionPct: round(avg("homework_completion_pct")),
    avgTestsPct: round(avg("tests_avg_pct")),
  };
}

/** Per-class rollups for admin/principal reports — computed in engine, not React. */
export async function getSchoolClassRollups(ctx: RepoContext): Promise<
  {
    classId: string;
    className: string;
    section: string;
    studentCount: number;
    avgAttendancePct: number;
    avgHomeworkCompletionPct: number;
    avgExamsPct: number;
    avgTestsPct: number;
  }[]
> {
  const schoolId = schoolIdOf(ctx);
  const { data: classes, error } = await getClient(ctx)
    .from("classes")
    .select("id, name, section")
    .eq("school_id", schoolId)
    .order("name");
  throwIfError(error, "Failed to list classes for rollups");

  const out = [];
  for (const cls of classes ?? []) {
    const perf = await getClassPerformance(ctx, cls.id);
    out.push({
      classId: cls.id,
      className: cls.name,
      section: cls.section ?? "",
      ...perf,
    });
  }
  return out;
}

/**
 * Teacher academic rollup — averages of assigned classes' profile metrics.
 * No fake KPIs; empty when teacher has no assignments.
 */
export async function getTeacherPerformance(
  ctx: RepoContext,
  teacherId: string,
): Promise<{
  teacherId: string;
  classCount: number;
  classIds: string[];
  assignedSubjects: string[];
  avgAttendancePct: number;
  avgHomeworkCompletionPct: number;
  avgExamsPct: number;
  avgTestsPct: number;
  studentCount: number;
}> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("teacher_classes")
    .select("class_id, subject")
    .eq("school_id", schoolId)
    .eq("teacher_id", teacherId);
  throwIfError(error, "Failed to load teacher assignments");

  const rows = data ?? [];
  const classIds = [...new Set(rows.map((r) => r.class_id).filter(Boolean))] as string[];
  const subjects = [...new Set(rows.map((r) => r.subject).filter(Boolean))] as string[];

  if (classIds.length === 0) {
    return {
      teacherId,
      classCount: 0,
      classIds: [],
      assignedSubjects: subjects,
      avgAttendancePct: 0,
      avgHomeworkCompletionPct: 0,
      avgExamsPct: 0,
      avgTestsPct: 0,
      studentCount: 0,
    };
  }

  let studentCount = 0;
  let att = 0;
  let hw = 0;
  let exams = 0;
  let tests = 0;
  for (const classId of classIds) {
    const perf = await getClassPerformance(ctx, classId);
    studentCount += perf.studentCount;
    att += perf.avgAttendancePct;
    hw += perf.avgHomeworkCompletionPct;
    exams += perf.avgExamsPct;
    tests += perf.avgTestsPct;
  }
  const n = classIds.length;

  return {
    teacherId,
    classCount: classIds.length,
    classIds,
    assignedSubjects: subjects,
    avgAttendancePct: round(att / n),
    avgHomeworkCompletionPct: round(hw / n),
    avgExamsPct: round(exams / n),
    avgTestsPct: round(tests / n),
    studentCount,
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export const AnalyticsFoundation = {
  getStudentAnalytics,
  getClassPerformance,
  getSchoolPerformance,
  getSchoolClassRollups,
  getTeacherPerformance,
  emptyStudentProfile,
  attendanceFromProfile,
  homeworkCompletionFromProfile,
  averageMarksFromProfile,
};
