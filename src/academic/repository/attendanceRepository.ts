import { validateAttendanceDate } from "../validation/rules";
import { AcademicRepositoryError, ValidationFailedError, TenantViolationError } from "./errors";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

export type AttendanceStatus = "present" | "absent" | "leave" | "late" | "half_day";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = [
  "present",
  "absent",
  "leave",
  "late",
  "half_day",
];

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
  if (!dateCheck.ok) throw new ValidationFailedError((dateCheck as { ok: false; issues: unknown[] }).issues as never);

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
 * Locks apply uniformly, including to admins -- the only way to write a
 * locked day is to explicitly delete the lock first (already a real,
 * separate admin-only action via RLS), never silently through a write path.
 * Enforced here (single-row path) and again inside rpc_bulk_upsert_attendance
 * (bulk path) so neither can be used to bypass the other.
 */
async function assertClassDateNotLocked(
  ctx: RepoContext,
  classId: string,
  date: string,
): Promise<void> {
  const schoolId = schoolIdOf(ctx);
  const { data: lock, error } = await getClient(ctx)
    .from("attendance_locks")
    .select("class_id")
    .eq("class_id", classId)
    .eq("date", date)
    .eq("school_id", schoolId)
    .maybeSingle();
  throwIfError(error, "Failed to check attendance lock");
  if (lock) {
    throw new ValidationFailedError([
      {
        field: "date",
        code: "locked",
        message: "Attendance for this class and date is locked and cannot be edited",
      },
    ]);
  }
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
  if (!dateCheck.ok) throw new ValidationFailedError((dateCheck as { ok: false; issues: unknown[] }).issues as never);

  if (!ATTENDANCE_STATUSES.includes(input.status)) {
    throw new ValidationFailedError([
      {
        field: "status",
        code: "invalid",
        message: "Attendance status must be present, absent, leave, late, or half_day",
      },
    ]);
  }

  const { data: student, error: sErr } = await getClient(ctx)
    .from("students")
    .select("id, school_id, class_id")
    .eq("id", input.studentId)
    .maybeSingle();

  throwIfError(sErr, "Failed to verify student");
  if (!student || (student as { school_id?: string }).school_id !== schoolId) {
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

  await assertClassDateNotLocked(ctx, input.classId, input.date);

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

/**
 * Bulk attendance upsert — one atomic server-side write for the whole batch
 * via rpc_bulk_upsert_attendance (see the migration that adds it for the full
 * rationale). A client-side validate-then-write approach was deliberately
 * rejected here: it still leaves a race window between validating and
 * writing, which does not satisfy this app's atomicity requirement for
 * attendance. This function does not fall back to the old sequential
 * single-row loop if the RPC is missing — that old behavior does not have
 * the atomicity property either, so silently degrading to it would misrepresent
 * this as fixed when the migration simply hasn't been applied to this
 * environment yet.
 */
export async function bulkUpsertAttendance(
  ctx: RepoContext,
  rows: UpsertAttendanceInput[],
): Promise<AttendanceRecord[]> {
  const schoolId = schoolIdOf(ctx);

  for (const row of rows) {
    const dateCheck = validateAttendanceDate(row.date);
    if (!dateCheck.ok) throw new ValidationFailedError((dateCheck as { ok: false; issues: unknown[] }).issues as never);
    if (!ATTENDANCE_STATUSES.includes(row.status)) {
      throw new ValidationFailedError([
        { field: "status", code: "invalid", message: "Attendance status must be present, absent, leave, late, or half_day" },
      ]);
    }
  }

  const { data, error } = await getClient(ctx).rpc("rpc_bulk_upsert_attendance" as never, {
    _rows: rows.map((r) => ({
      student_id: r.studentId,
      class_id: r.classId,
      date: r.date,
      status: r.status,
    })),
  } as never);

  if (error) {
    const msg = error.message || "";
    if (/rpc_bulk_upsert_attendance|schema cache|function .* does not exist/i.test(msg)) {
      throw new AcademicRepositoryError(
        "db_error",
        "Bulk attendance save requires a database migration that hasn't been applied to this environment yet " +
          "(rpc_bulk_upsert_attendance — see supabase/migrations/20260808110000_atomic_bulk_attendance_upsert.sql).",
      );
    }
    throwIfError(error, "Failed to save attendance");
  }

  // rpc_bulk_upsert_attendance re-validates and writes atomically but only
  // returns a count, not the written rows (the fixed set of fields the caller
  // already knows) — re-fetch is unnecessary since callers already have this
  // shape locally; return it as confirmation of what was written.
  return rows.map((r) => ({
    id: "",
    schoolId,
    studentId: r.studentId,
    classId: r.classId,
    date: r.date,
    status: r.status,
    markedBy: ctx.userId ?? null,
  }));
}
