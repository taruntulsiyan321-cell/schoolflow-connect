import type { StudentAcademicProfile } from "../types";
import { NotFoundError } from "./errors";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

type ProfileRow = {
  id: string;
  school_id: string;
  student_id: string;
  academic_year_id: string | null;
  attendance_present: number;
  attendance_total: number;
  attendance_pct: number;
  homework_assigned: number;
  homework_submitted: number;
  homework_completion_pct: number;
  tests_attempted: number;
  tests_avg_pct: number;
  exams_recorded: number;
  exams_avg_pct: number;
  practice_sessions: number;
  practice_accuracy_pct: number;
  doubts_asked: number;
  doubts_resolved: number;
  remarks_count: number;
  metrics: Record<string, unknown> | null;
  last_event_type: string | null;
  last_event_at: string | null;
  refreshed_at: string;
};

function mapProfile(row: ProfileRow): StudentAcademicProfile {
  return {
    id: row.id,
    schoolId: row.school_id,
    studentId: row.student_id,
    academicYearId: row.academic_year_id,
    attendancePresent: row.attendance_present,
    attendanceTotal: row.attendance_total,
    attendancePct: Number(row.attendance_pct),
    homeworkAssigned: row.homework_assigned,
    homeworkSubmitted: row.homework_submitted,
    homeworkCompletionPct: Number(row.homework_completion_pct),
    testsAttempted: row.tests_attempted,
    testsAvgPct: Number(row.tests_avg_pct),
    examsRecorded: row.exams_recorded,
    examsAvgPct: Number(row.exams_avg_pct),
    practiceSessions: row.practice_sessions,
    practiceAccuracyPct: Number(row.practice_accuracy_pct),
    doubtsAsked: row.doubts_asked,
    doubtsResolved: row.doubts_resolved,
    remarksCount: row.remarks_count,
    metrics: (row.metrics ?? {}) as Record<string, unknown>,
    lastEventType: row.last_event_type,
    lastEventAt: row.last_event_at,
    refreshedAt: row.refreshed_at,
  };
}

/** Read-only access to auto-maintained academic profiles. */
export async function getStudentAcademicProfile(
  ctx: RepoContext,
  studentId: string,
): Promise<StudentAcademicProfile | null> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("student_academic_profiles")
    .select("*")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .maybeSingle();

  throwIfError(error, "Failed to load academic profile");
  return data ? mapProfile(data as ProfileRow) : null;
}

export async function requireStudentAcademicProfile(
  ctx: RepoContext,
  studentId: string,
): Promise<StudentAcademicProfile> {
  const profile = await getStudentAcademicProfile(ctx, studentId);
  if (!profile) throw new NotFoundError("student_academic_profile", studentId);
  return profile;
}

export async function listClassAcademicProfiles(
  ctx: RepoContext,
  classId: string,
  page?: PageParams,
): Promise<StudentAcademicProfile[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data: students, error: sErr } = await getClient(ctx)
    .from("students")
    .select("id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .range(offset, offset + limit - 1);

  throwIfError(sErr, "Failed to list class students");
  const ids = (students ?? []).map((s) => s.id);
  if (ids.length === 0) return [];

  const { data, error } = await getClient(ctx)
    .from("student_academic_profiles")
    .select("*")
    .eq("school_id", schoolId)
    .in("student_id", ids);

  throwIfError(error, "Failed to list academic profiles");
  return (data ?? []).map((row) => mapProfile(row as ProfileRow));
}

/** School-wide profiles for admin/principal rankings & reports (engine-owned). */
export async function listSchoolAcademicProfiles(
  ctx: RepoContext,
  page?: PageParams,
): Promise<StudentAcademicProfile[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);
  const { data, error } = await getClient(ctx)
    .from("student_academic_profiles")
    .select("*")
    .eq("school_id", schoolId)
    .order("exams_avg_pct", { ascending: false })
    .range(offset, offset + limit - 1);
  throwIfError(error, "Failed to list school academic profiles");
  return (data ?? []).map((row) => mapProfile(row as ProfileRow));
}

/** Ensure profile shell exists (SECURITY DEFINER RPC). */
export async function ensureAcademicProfile(ctx: RepoContext, studentId: string): Promise<string> {
  const { data, error } = await getClient(ctx).rpc("ensure_student_academic_profile", {
    _student_id: studentId,
  });
  throwIfError(error, "Failed to ensure academic profile");
  return data as string;
}
