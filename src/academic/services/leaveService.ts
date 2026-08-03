import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { ValidationFailedError } from "../repository/errors";
import { validateLeaveDateRange } from "../validation/rules";

export type LeaveApplicantKind = "student" | "teacher";
export type LeaveStatus = "pending" | "approved" | "rejected";

export type LeaveRequestRow = {
  id: string;
  applicantUserId: string;
  applicantKind: LeaveApplicantKind;
  leaveType: string;
  fromDate: string;
  toDate: string;
  reason: string | null;
  status: LeaveStatus;
  createdAt: string;
  reviewedAt: string | null;
  reviewedBy: string | null;
  studentId: string | null;
  classId: string | null;
};

/** School-scoped leave row with resolved applicant display fields. */
export type SchoolLeaveRequestRow = LeaveRequestRow & {
  applicantName: string;
  department: string | null;
  days: number;
};

type DbLeave = {
  id: string;
  applicant_user_id: string;
  applicant_kind: LeaveApplicantKind;
  leave_type: string;
  from_date: string;
  to_date: string;
  reason: string | null;
  status: LeaveStatus;
  created_at: string;
  reviewed_at: string | null;
  reviewed_by: string | null;
  student_id: string | null;
  class_id: string | null;
};

function mapRow(row: DbLeave): LeaveRequestRow {
  return {
    id: row.id,
    applicantUserId: row.applicant_user_id,
    applicantKind: row.applicant_kind,
    leaveType: row.leave_type,
    fromDate: row.from_date,
    toDate: row.to_date,
    reason: row.reason,
    status: row.status,
    createdAt: row.created_at,
    reviewedAt: row.reviewed_at,
    reviewedBy: row.reviewed_by,
    studentId: row.student_id,
    classId: row.class_id,
  };
}

function daysBetween(from: string, to: string): number {
  const a = new Date(`${from}T00:00:00`);
  const b = new Date(`${to}T00:00:00`);
  if (Number.isNaN(a.getTime()) || Number.isNaN(b.getTime())) return 1;
  const diff = Math.round((b.getTime() - a.getTime()) / 86_400_000);
  return Math.max(1, diff + 1);
}

export const LeaveService = {
  async listMine(ctx: ServiceContext): Promise<LeaveRequestRow[]> {
    assertCanConsume(ctx, "leave_request");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("leave_requests")
      .select("*")
      .eq("applicant_user_id", ctx.userId)
      .order("created_at", { ascending: false });
    throwIfError(error, "Failed to list leave requests");
    return ((data ?? []) as DbLeave[]).map(mapRow);
  },

  async listPending(ctx: ServiceContext): Promise<LeaveRequestRow[]> {
    const rows = await LeaveService.listForSchool(ctx, { status: "pending" });
    return rows;
  },

  /**
   * School-scoped leave inbox for admin/principal.
   * leave_requests has no school_id — filter via students / teachers / classes of this tenant.
   */
  async listForSchool(
    ctx: ServiceContext,
    opts?: { status?: LeaveStatus | "all"; limit?: number },
  ): Promise<SchoolLeaveRequestRow[]> {
    assertCanConsume(ctx, "leave_request");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only school operators may list school leave requests");
    }
    const client = getClient(toRepoContext(ctx));
    const limit = opts?.limit ?? 300;
    const status = opts?.status ?? "all";

    const [studentsRes, teachersRes, classesRes] = await Promise.all([
      client.from("students").select("id, full_name").eq("school_id", ctx.schoolId),
      client
        .from("teachers")
        .select("id, full_name, user_id, department")
        .eq("school_id", ctx.schoolId),
      client.from("classes").select("id").eq("school_id", ctx.schoolId),
    ]);
    throwIfError(studentsRes.error, "Failed to list students for leave filter");
    throwIfError(teachersRes.error, "Failed to list teachers for leave filter");
    throwIfError(classesRes.error, "Failed to list classes for leave filter");

    const students = (studentsRes.data ?? []) as { id: string; full_name: string }[];
    const teachers = (teachersRes.data ?? []) as {
      id: string;
      full_name: string;
      user_id: string | null;
      department: string | null;
    }[];
    const classIds = new Set(((classesRes.data ?? []) as { id: string }[]).map((c) => c.id));
    const studentById = new Map(students.map((s) => [s.id, s]));
    const teacherByUserId = new Map(
      teachers.filter((t) => t.user_id).map((t) => [t.user_id as string, t]),
    );
    const studentIds = [...studentById.keys()];
    const teacherUserIds = [...teacherByUserId.keys()];

    if (studentIds.length === 0 && teacherUserIds.length === 0 && classIds.size === 0) {
      return [];
    }

    let query = client
      .from("leave_requests")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(Math.min(800, Math.max(limit * 3, 200)));
    if (status !== "all") {
      query = query.eq("status", status);
    }
    const { data, error } = await query;
    throwIfError(error, "Failed to list leave requests");

    const scoped = ((data ?? []) as DbLeave[]).filter((row) => {
      if (row.student_id && studentById.has(row.student_id)) return true;
      if (row.class_id && classIds.has(row.class_id)) return true;
      if (row.applicant_kind === "teacher" && teacherByUserId.has(row.applicant_user_id)) {
        return true;
      }
      return false;
    });

    return scoped.slice(0, limit).map((row) => {
      const base = mapRow(row);
      const teacher = teacherByUserId.get(row.applicant_user_id);
      const student = row.student_id ? studentById.get(row.student_id) : undefined;
      const applicantName =
        row.applicant_kind === "teacher"
          ? teacher?.full_name ?? "Teacher"
          : student?.full_name ?? "Student";
      return {
        ...base,
        applicantName,
        department:
          row.applicant_kind === "teacher"
            ? teacher?.department ?? null
            : row.applicant_kind === "student"
              ? "Student"
              : null,
        days: daysBetween(row.from_date, row.to_date),
      };
    });
  },

  async submit(
    ctx: ServiceContext,
    input: {
      leaveType: string;
      fromDate: string;
      toDate: string;
      reason: string;
      applicantKind?: LeaveApplicantKind;
      studentId?: string | null;
      classId?: string | null;
    },
  ): Promise<LeaveRequestRow> {
    assertCanOwn(ctx, "leave_request");
    const kind: LeaveApplicantKind =
      input.applicantKind ??
      (ctx.role === "teacher" ? "teacher" : ctx.role === "student" ? "student" : "teacher");
    if (ctx.role !== "teacher" && ctx.role !== "student" && ctx.role !== "parent") {
      throw new ForbiddenError("Only applicants may submit leave requests");
    }
    const dateCheck = validateLeaveDateRange(input.fromDate, input.toDate);
    if (!dateCheck.ok) {
      throw new ValidationFailedError((dateCheck as { ok: false; issues: never[] }).issues);
    }
    const reason = input.reason.trim();
    if (reason.length < 3) {
      throw new ValidationFailedError([
        { field: "reason", code: "too_short", message: "Leave reason must be at least 3 characters" },
      ]);
    }
    const leaveType = input.leaveType.trim();
    if (!leaveType) {
      throw new ValidationFailedError([
        { field: "leaveType", code: "required", message: "Leave type is required" },
      ]);
    }

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("leave_requests")
      .insert({
        applicant_user_id: ctx.userId,
        applicant_kind: kind,
        leave_type: leaveType,
        from_date: input.fromDate,
        to_date: input.toDate,
        reason,
        student_id: kind === "student" ? (input.studentId ?? ctx.studentId ?? null) : null,
        class_id: kind === "student" ? (input.classId ?? null) : null,
        status: "pending",
      })
      .select("*")
      .single();
    throwIfError(error, "Failed to submit leave request");
    const row = mapRow(data as DbLeave);

    await emitEvent(toRepoContext(ctx), {
      eventType: "leave.requested",
      entityType: "leave_request",
      entityId: row.id,
      studentId: row.studentId,
      classId: row.classId,
      payload: {
        leave_type: row.leaveType,
        from_date: row.fromDate,
        to_date: row.toDate,
        applicant_kind: row.applicantKind,
      },
    }).catch(() => undefined);

    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "LeaveService.submit",
    });
    return row;
  },

  async review(
    ctx: ServiceContext,
    leaveId: string,
    decision: Exclude<LeaveStatus, "pending">,
    adminRemarks?: string,
  ): Promise<LeaveRequestRow> {
    assertCanConsume(ctx, "leave_request");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only school operators may review leave requests");
    }
    if (decision !== "approved" && decision !== "rejected") {
      throw new ValidationFailedError([
        { field: "decision", code: "invalid", message: "Decision must be approved or rejected" },
      ]);
    }

    // Schema has no review_note column — persist decision only; remarks go on the event.
    const patch: Record<string, unknown> = {
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: ctx.userId,
    };

    const { data, error } = await getClient(toRepoContext(ctx))
      .from("leave_requests")
      .update(patch as never)
      .eq("id", leaveId)
      .eq("status", "pending")
      .select("*")
      .maybeSingle();
    throwIfError(error, "Failed to review leave request");
    if (!data) {
      throw new ValidationFailedError([
        { field: "leaveId", code: "not_found", message: "Pending leave request not found" },
      ]);
    }
    const row = mapRow(data as DbLeave);

    await emitEvent(toRepoContext(ctx), {
      eventType: "leave.reviewed",
      entityType: "leave_request",
      entityId: row.id,
      studentId: row.studentId,
      classId: row.classId,
      payload: {
        status: decision,
        review_note: adminRemarks?.trim() || null,
      },
    }).catch(() => undefined);

    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "LeaveService.review",
    });
    return row;
  },
};
