import type { StudentAcademicProfile } from "../types";
import {
  getStudentAcademicProfile,
  listClassAcademicProfiles,
} from "../repository/academicProfileRepository";
import { getClient, schoolIdOf, throwIfError, type RepoContext } from "../repository/base";
import { NotFoundError } from "../repository/errors";

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

export async function getStudentAnalytics(
  ctx: RepoContext,
  studentId: string,
): Promise<{
  attendance: AttendanceAnalytics;
  homework: CompletionAnalytics;
  tests: MarksAnalytics;
  exams: MarksAnalytics;
  practice: CompletionAnalytics;
  profile: StudentAcademicProfile;
}> {
  const profile = await getStudentAcademicProfile(ctx, studentId);
  if (!profile) throw new NotFoundError("student_academic_profile", studentId);

  return {
    profile,
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
}> {
  const schoolId = schoolIdOf(ctx);
  const client = getClient(ctx);

  const [classes, students, teachers, profiles] = await Promise.all([
    client.from("classes").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client.from("teachers").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client
      .from("student_academic_profiles")
      .select("attendance_pct, exams_avg_pct")
      .eq("school_id", schoolId)
      .limit(5000),
  ]);

  throwIfError(classes.error, "Failed to count classes");
  throwIfError(students.error, "Failed to count students");
  throwIfError(teachers.error, "Failed to count teachers");
  throwIfError(profiles.error, "Failed to load profiles");

  const rows = profiles.data ?? [];
  const n = rows.length || 1;
  const avgAtt =
    rows.reduce((a, r) => a + Number((r as { attendance_pct: number }).attendance_pct ?? 0), 0) / n;
  const avgExam =
    rows.reduce((a, r) => a + Number((r as { exams_avg_pct: number }).exams_avg_pct ?? 0), 0) / n;

  return {
    classCount: classes.count ?? 0,
    studentCount: students.count ?? 0,
    teacherCount: teachers.count ?? 0,
    avgAttendancePct: round(avgAtt),
    avgExamsPct: round(avgExam),
  };
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

export const AnalyticsFoundation = {
  getStudentAnalytics,
  getClassPerformance,
  getSchoolPerformance,
  attendanceFromProfile,
  homeworkCompletionFromProfile,
  averageMarksFromProfile,
};
