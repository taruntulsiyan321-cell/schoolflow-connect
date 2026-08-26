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

/**
 * Present/absent only — locked decision 5, enforced since Chunk 4 by a CHECK
 * constraint on public.attendance. The enum type still carries leave/late/
 * half_day labels (Postgres cannot drop enum values in place), but the
 * database refuses to store them, so offering them anywhere would produce a
 * raw constraint error in front of a teacher.
 *
 * An approved absence is owned by leave_requests, not by the register.
 */
export type AttendanceStatus = "present" | "absent";

export const ATTENDANCE_STATUSES: AttendanceStatus[] = ["present", "absent"];

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
    .from("attendance_current")
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
    .from("attendance_current")
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
  if (!dateCheck.ok) throw new ValidationFailedError((dateCheck as { ok: false; issues: unknown[] }).issues as never);

  if (!ATTENDANCE_STATUSES.includes(input.status)) {
    throw new ValidationFailedError([
      {
        field: "status",
        code: "invalid",
        message: "Attendance status must be present or absent",
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

  // Chunk 4.7: there is no lock and no edit window. Whether this write is an
  // edit, and whether the caller may make it, is decided in exactly one place
  // -- rpc_ensure_attendance_submission, called just below. A teacher whose
  // section already has a submission for this date is rejected there; an admin
  // is not, on any date, forever.

  // Chunk 4: attendance_submissions is the authority for whether a section was
  // marked, and its ABSENCE is what "not marked" means. So the register is
  // marked explicitly first, and the per-student row is written under it.
  // Deliberately not a DB trigger: auto-creating the submission from a record
  // insert would restore the very inference ("a student row implies the
  // section was marked") that produced 0.0% on unmarked classes.
  const { data: submissionId, error: subErr } = await getClient(ctx).rpc(
    "rpc_ensure_attendance_submission",
    { _section_id: input.classId, _date: input.date } as never,
  );
  throwIfError(subErr, "Failed to mark the register for this section and date");

  const { data, error } = await getClient(ctx)
    .from("attendance")
    .upsert(
      {
        // Chunk 4.6: the record no longer carries its own section or date —
        // the submission holds them, and it is the authority.
        student_id: input.studentId,
        status: input.status,
        school_id: schoolId,
        marked_by: ctx.userId ?? null,
        submission_id: submissionId as unknown as string,
      },
      { onConflict: "student_id,submission_id" },
    )
    .select("*")
    .single();

  throwIfError(error, "Failed to save attendance");
  // The upsert returns table columns, and since Chunk 4.6 the table no longer
  // carries section or date — the submission does. Both are supplied from the
  // submission this call just ensured, so they are the authority, not a guess.
  return mapRow({
    ...(data as Omit<AttendanceRow, "class_id" | "date">),
    class_id: input.classId,
    date: input.date,
  });
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
        { field: "status", code: "invalid", message: "Attendance status must be present or absent" },
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
