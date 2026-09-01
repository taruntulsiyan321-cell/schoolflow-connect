import type { StudentAcademicProfile } from "../types";
import {
  getStudentAcademicProfile,
  listClassAcademicProfiles,
} from "../repository/academicProfileRepository";
import { getClient, schoolIdOf, throwIfError, type RepoContext } from "../repository/base";
import {
  rollupFromProfiles,
  profileCountsFromRow,
  type ProfileCounts,
  type GroupRollup,
} from "../metrics/rollup";
import { valueOr } from "../metrics/types";

/**
 * CHUNK 10. The arithmetic in this file has moved to ../metrics.
 *
 * What was here computed group figures as the unweighted mean of per-student
 * percentages, in four places, and was 6.5 points wrong on the demo school's
 * headline attendance — 85.94% against a true 92.41%. See ../metrics/rollup.ts
 * for what that mean does and why summing the counts fixes three faults at once.
 *
 * The `avg*Pct` fields are now `number | null`: null where the metric is
 * `no_data` or `not_marked`. That is deliberately a breaking type change rather
 * than a silent 0, because a 0 is how "nobody marked the register" became "nobody
 * was present" in the first place. Read `.metrics` and its `state` where the
 * difference matters; the nullable numbers are the migration path, not the
 * destination.
 */
type ProfileCountRow = Record<string, unknown>;

function rollupFromProfileCounts(rows: ProfileCountRow[]): {
  avgAttendancePct: number | null;
  avgExamsPct: number | null;
  avgHomeworkCompletionPct: number | null;
  avgTestsPct: number | null;
  metrics: GroupRollup;
} {
  const metrics = rollupFromProfiles(rows.map(profileCountsFromRow));
  return {
    avgAttendancePct: valueOr(metrics.attendance, null),
    avgExamsPct: valueOr(metrics.exams, null),
    avgHomeworkCompletionPct: valueOr(metrics.homework, null),
    avgTestsPct: valueOr(metrics.tests, null),
    metrics,
  };
}

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
    attendanceRiskBand: "unknown",
    homeworkConsistencyBand: "unknown",
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

/** The already-camelCased profile entity, onto the counts the rollup takes. */
function profileCounts(p: StudentAcademicProfile): ProfileCounts {
  return {
    attendancePresent: p.attendancePresent ?? 0,
    attendanceTotal: p.attendanceTotal ?? 0,
    homeworkSubmitted: p.homeworkSubmitted ?? 0,
    homeworkAssigned: p.homeworkAssigned ?? 0,
    testsAttempted: p.testsAttempted ?? 0,
    testsAvgPct: p.testsAvgPct ?? 0,
    examsRecorded: p.examsRecorded ?? 0,
    examsAvgPct: p.examsAvgPct ?? 0,
  };
}

export async function getClassPerformance(
  ctx: RepoContext,
  classId: string,
): Promise<{
  studentCount: number;
  avgAttendancePct: number | null;
  avgHomeworkCompletionPct: number | null;
  avgExamsPct: number | null;
  avgTestsPct: number | null;
  metrics: GroupRollup;
}> {
  const profiles = await listClassAcademicProfiles(ctx, classId, { limit: 200 });
  const metrics = rollupFromProfiles(profiles.map(profileCounts));

  return {
    studentCount: profiles.length,
    avgAttendancePct: valueOr(metrics.attendance, null),
    avgHomeworkCompletionPct: valueOr(metrics.homework, null),
    avgExamsPct: valueOr(metrics.exams, null),
    avgTestsPct: valueOr(metrics.tests, null),
    metrics,
  };
}

export async function getSchoolPerformance(ctx: RepoContext): Promise<{
  classCount: number;
  studentCount: number;
  teacherCount: number;
  avgAttendancePct: number | null;
  avgExamsPct: number | null;
  avgHomeworkCompletionPct: number | null;
  avgTestsPct: number | null;
  metrics: GroupRollup;
}> {
  const schoolId = schoolIdOf(ctx);
  const client = getClient(ctx);

  const [classes, students, teachers, profiles] = await Promise.all([
    client.from("classes").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client.from("students").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client.from("teachers").select("id", { count: "exact", head: true }).eq("school_id", schoolId),
    client
      .from("student_academic_profiles")
      // The COUNTS, not the percentages. Averaging the percentages is the
      // defect this replaces; see rollupFromProfileCounts.
      //
      // One string literal, not a concatenation: supabase-js parses the select
      // at the TYPE level, and a concatenated string is not a literal it can
      // read, so the result degrades to GenericStringError[] and every use of
      // it needs a cast. Written as a literal, the rows type themselves and the
      // cast disappears — removing beats widening (Sweep 5).
      .select("attendance_present, attendance_total, homework_assigned, homework_submitted, tests_attempted, tests_avg_pct, exams_recorded, exams_avg_pct")
      .eq("school_id", schoolId)
      .limit(5000),
  ]);

  throwIfError(classes.error, "Failed to count classes");
  throwIfError(students.error, "Failed to count students");
  throwIfError(teachers.error, "Failed to count teachers");
  throwIfError(profiles.error, "Failed to load profiles");

  const rows = profiles.data ?? [];

  return {
    classCount: classes.count ?? 0,
    studentCount: students.count ?? 0,
    teacherCount: teachers.count ?? 0,
    ...rollupFromProfileCounts(rows),
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
  avgAttendancePct: number | null;
  avgHomeworkCompletionPct: number | null;
  avgExamsPct: number | null;
  avgTestsPct: number | null;
  studentCount: number;
  metrics: GroupRollup;
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
    const empty = rollupFromProfiles([]);
    return {
      teacherId,
      classCount: 0,
      classIds: [],
      assignedSubjects: subjects,
      avgAttendancePct: null,
      avgHomeworkCompletionPct: null,
      avgExamsPct: null,
      avgTestsPct: null,
      studentCount: 0,
      metrics: empty,
    };
  }

  // Every student across the teacher's classes, rolled up ONCE.
  //
  // This used to average the per-class averages, which is the same fault as
  // averaging the per-student percentages one level up: a class of 4 counted as
  // much as a class of 40, and a class where nobody had been marked contributed
  // a 0 it had not earned. Concatenating the profiles and dividing once removes
  // both, and it is the same function the class and school figures use — so
  // there is one definition of "attendance for a group of students", not three.
  const profiles: StudentAcademicProfile[] = [];
  for (const classId of classIds) {
    profiles.push(...(await listClassAcademicProfiles(ctx, classId, { limit: 200 })));
  }
  const metrics = rollupFromProfiles(profiles.map(profileCounts));
  const studentCount = profiles.length;

  return {
    teacherId,
    classCount: classIds.length,
    classIds,
    assignedSubjects: subjects,
    metrics,
    avgAttendancePct: valueOr(metrics.attendance, null),
    avgHomeworkCompletionPct: valueOr(metrics.homework, null),
    avgExamsPct: valueOr(metrics.exams, null),
    avgTestsPct: valueOr(metrics.tests, null),
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
