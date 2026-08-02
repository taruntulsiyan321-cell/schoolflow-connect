import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";

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

/**
 * LeaveService — teacher/student leave requests via `leave_requests`.
 */
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
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("leave_requests")
      .insert({
        applicant_user_id: ctx.userId,
        applicant_kind: kind,
        leave_type: input.leaveType,
        from_date: input.fromDate,
        to_date: input.toDate,
        reason: input.reason,
        student_id: kind === "student" ? (input.studentId ?? ctx.studentId ?? null) : null,
        class_id: kind === "student" ? (input.classId ?? null) : null,
        status: "pending",
      })
      .select("*")
      .single();
    throwIfError(error, "Failed to submit leave request");
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      source: "LeaveService.submit",
    });
    return mapRow(data as DbLeave);
  },
};
