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
  studentId: string | null;
  classId: string | null;
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
    studentId: row.student_id,
    classId: row.class_id,
  };
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
    assertCanConsume(ctx, "leave_request");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only school operators may review leave requests");
    }
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("leave_requests")
      .select("*")
      .eq("status", "pending")
      .order("created_at", { ascending: false })
      .limit(200);
    throwIfError(error, "Failed to list pending leave requests");
    return ((data ?? []) as DbLeave[]).map(mapRow);
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

    const patch: Record<string, unknown> = {
      status: decision,
      reviewed_at: new Date().toISOString(),
      reviewed_by: ctx.userId,
    };
    if (adminRemarks?.trim()) patch.review_note = adminRemarks.trim();

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
