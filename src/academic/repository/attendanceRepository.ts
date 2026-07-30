import { validateAttendanceDate } from "../validation/rules";
import { ValidationFailedError, TenantViolationError } from "./errors";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

export type AttendanceStatus = "present" | "absent" | "leave";

export interface AttendanceRecord {
  id: string;
  schoolId: string;
  studentId: string;
  classId: string;
  date: string;
  status: AttendanceStatus;
  markedBy: string | null;
}

type AttendanceRow = {
  id: string;
  school_id: string | null;
  student_id: string;
  class_id: string;
  date: string;
  status: AttendanceStatus;
  marked_by: string | null;
};

function mapRow(row: AttendanceRow): AttendanceRecord {
  return {
    id: row.id,
    schoolId: row.school_id ?? "",
    studentId: row.student_id,
    classId: row.class_id,
    date: row.date,
    status: row.status,
    markedBy: row.marked_by,
  };
}

export async function listAttendanceForClassDate(
  ctx: RepoContext,
  classId: string,
  date: string,
): Promise<AttendanceRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const dateCheck = validateAttendanceDate(date);
  if (!dateCheck.ok) throw new ValidationFailedError(dateCheck.issues);

  const { data, error } = await getClient(ctx)
    .from("attendance")
    .select("*")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .eq("date", date);

  throwIfError(error, "Failed to load attendance");
  return (data ?? []).map((r) => mapRow(r as AttendanceRow));
}

export async function listStudentAttendance(
  ctx: RepoContext,
  studentId: string,
  page?: PageParams,
): Promise<AttendanceRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("attendance")
    .select("*")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .order("date", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to load student attendance");
  return (data ?? []).map((r) => mapRow(r as AttendanceRow));
}

export interface UpsertAttendanceInput {
  studentId: string;
  classId: string;
  date: string;
  status: AttendanceStatus;
}

/**
 * Upsert one attendance row. Unique (student_id, date) enforced by DB.
 * Triggers emit academic_events + audit automatically.
 */
export async function upsertAttendance(
  ctx: RepoContext,
  input: UpsertAttendanceInput,
): Promise<AttendanceRecord> {
  const schoolId = schoolIdOf(ctx);
  const dateCheck = validateAttendanceDate(input.date);
  if (!dateCheck.ok) throw new ValidationFailedError(dateCheck.issues);

  if (!["present", "absent", "leave"].includes(input.status)) {
    throw new ValidationFailedError([
      {
        field: "status",
        code: "invalid",
        message: "Attendance status must be present, absent, or leave",
      },
    ]);
  }

  const { data: student, error: sErr } = await getClient(ctx)
    .from("students")
    .select("id, school_id, class_id")
    .eq("id", input.studentId)
    .maybeSingle();

  throwIfError(sErr, "Failed to verify student");
  if (!student || student.school_id !== schoolId) {
    throw new TenantViolationError("Student is outside the current school");
  }
  if (student.class_id !== input.classId) {
    throw new ValidationFailedError([
      {
        field: "classId",
        code: "mismatch",
        message: "Student does not belong to the given class",
      },
    ]);
  }

  const { data, error } = await getClient(ctx)
    .from("attendance")
    .upsert(
      {
        student_id: input.studentId,
        class_id: input.classId,
        date: input.date,
        status: input.status,
        school_id: schoolId,
        marked_by: ctx.userId ?? null,
      },
      { onConflict: "student_id,date" },
    )
    .select("*")
    .single();

  throwIfError(error, "Failed to save attendance");
  return mapRow(data as AttendanceRow);
}

export async function bulkUpsertAttendance(
  ctx: RepoContext,
  rows: UpsertAttendanceInput[],
): Promise<AttendanceRecord[]> {
  const out: AttendanceRecord[] = [];
  for (const row of rows) {
    out.push(await upsertAttendance(ctx, row));
  }
  return out;
}
