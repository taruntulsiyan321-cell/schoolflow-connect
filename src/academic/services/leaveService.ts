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
  /** DERIVED from whether a decision row exists — never read from the column. */
  status: LeaveStatus;
  createdAt: string;
  /** From the decision row. Null where the decider was not recorded. */
  reviewedAt: string | null;
  reviewedBy: string | null;
  /** The decision itself, so a screen can say "decider not recorded". */
  decision: LeaveDecisionRow | null;
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

/**
 * CHUNK 8 BATCH 1b — the decision row, which is the authority.
 *
 * `leave_requests.status` is still on the table and still written (batch 1c
 * drops it and the dual write together). Nothing READS it from here any more:
 * resolution is derived from whether a decision row exists, per G5, so the two
 * cannot drift into disagreement without one of them being unread.
 *
 * Measured before repointing — the two agree exactly today:
 *   status=pending   no decision row   8
 *   status=approved  decision row      6
 *   status=rejected  decision row      5
 * and no policy, function or trigger in the database reads the column.
 */
export type LeaveDecisionRow = {
  leaveRequestId: string;
  decision: Exclude<LeaveStatus, "pending">;
  /** NULL where the decider was genuinely not recorded. Never invented. */
  decidedBy: string | null;
  decidedByRole: string | null;
  decidedAt: string | null;
  reason: string | null;
};

type DbLeaveDecision = {
  leave_request_id: string;
  decision: string;
  decided_by: string | null;
  decided_by_role: string | null;
  decided_at: string | null;
  reason: string | null;
};

const mapDecision = (d: DbLeaveDecision): LeaveDecisionRow => ({
  leaveRequestId: d.leave_request_id,
  decision: d.decision as Exclude<LeaveStatus, "pending">,
  decidedBy: d.decided_by,
  decidedByRole: d.decided_by_role,
  decidedAt: d.decided_at,
  reason: d.reason,
});

/**
 * What a screen should say about who decided.
 *
 * Eight of the eleven decided rows name nobody. The ruling: verdict plus
 * "decider not recorded" — the same principle as the never-marked attendance
 * line. Say what the data supports, and do not attribute an outcome to someone
 * who never acted.
 */
export function decisionAttribution(d: LeaveDecisionRow | undefined): string | null {
  if (!d) return null;
  if (!d.decidedBy) return "decider not recorded";
  return d.decidedByRole ? `decided by ${d.decidedByRole}` : "decided";
}

function mapRow(row: DbLeave, decision?: LeaveDecisionRow): LeaveRequestRow {
  return {
    id: row.id,
    applicantUserId: row.applicant_user_id,
    applicantKind: row.applicant_kind,
    leaveType: row.leave_type,
    fromDate: row.from_date,
    toDate: row.to_date,
    reason: row.reason,
    // DERIVED, not read. A request with no decision row is pending, whatever
    // the column happens to hold.
    status: decision ? decision.decision : "pending",
    createdAt: row.created_at,
    reviewedAt: decision?.decidedAt ?? null,
    reviewedBy: decision?.decidedBy ?? null,
    decision: decision ?? null,
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
    const client = getClient(toRepoContext(ctx));
    const { data, error } = await client
      .from("leave_requests")
      .select("*")
      .eq("applicant_user_id", ctx.userId)
      .order("created_at", { ascending: false });
    throwIfError(error, "Failed to list leave requests");

    const rows = (data ?? []) as DbLeave[];
    if (rows.length === 0) return [];

    // The decisions have to be fetched here too. `.map(mapRow)` would pass the
    // array index as the second argument and every request the applicant owns
    // would derive as pending — their own approved leave would read as still
    // waiting. Deriving from row existence means the rows have to be present.
    const { data: decisions, error: decisionsErr } = await client
      .from("leave_decisions")
      .select("leave_request_id, decision, decided_by, decided_by_role, decided_at, reason")
      .in("leave_request_id", rows.map((r) => r.id));
    throwIfError(decisionsErr, "Failed to load leave decisions");

    const byRequest = new Map(
      ((decisions ?? []) as unknown as DbLeaveDecision[]).map((d) => [
        d.leave_request_id,
        mapDecision(d),
      ]),
    );
    return rows.map((r) => mapRow(r, byRequest.get(r.id)));
  },

  async listPending(ctx: ServiceContext): Promise<LeaveRequestRow[]> {
    const rows = await LeaveService.listForSchool(ctx, { status: "pending" });
    return rows;
  },

  /**
   * School-scoped leave inbox for admin/principal.
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

    const [studentsRes, teachersRes] = await Promise.all([
      client.from("students").select("id, full_name").eq("school_id", ctx.schoolId),
      client
        .from("teachers")
        .select("id, full_name, user_id, department")
        .eq("school_id", ctx.schoolId),
    ]);
    throwIfError(studentsRes.error, "Failed to list students for leave display");
    throwIfError(teachersRes.error, "Failed to list teachers for leave display");

    const students = (studentsRes.data ?? []) as { id: string; full_name: string }[];
    const teachers = (teachersRes.data ?? []) as {
      id: string;
      full_name: string;
      user_id: string | null;
      department: string | null;
    }[];
    const studentById = new Map(students.map((s) => [s.id, s]));
    const teacherByUserId = new Map(
      teachers.filter((t) => t.user_id).map((t) => [t.user_id as string, t]),
    );

    // CHUNK 8 BATCH 1b. The filter used to be `.eq("status", status)` against
    // the stored column. It now derives from the decision rows.
    //
    // The order matters: the status filter is applied BEFORE the limit, not
    // after. Fetching a limited page and then filtering would return fewer rows
    // than asked for and silently drop the rest — a pending inbox that looks
    // short rather than paged. So the decisions are fetched first (one row per
    // decided request, school-scoped) and the filter runs on the derived value.
    const [requestsRes, decisionsRes] = await Promise.all([
      client
        .from("leave_requests")
        .select("*")
        .eq("school_id", ctx.schoolId)
        .order("created_at", { ascending: false }),
      client
        .from("leave_decisions")
        .select("leave_request_id, decision, decided_by, decided_by_role, decided_at, reason")
        .eq("school_id", ctx.schoolId),
    ]);
    throwIfError(requestsRes.error, "Failed to list leave requests");
    throwIfError(decisionsRes.error, "Failed to list leave decisions");

    const decisionByRequest = new Map(
      ((decisionsRes.data ?? []) as DbLeaveDecision[]).map((d) => [
        d.leave_request_id,
        mapDecision(d),
      ]),
    );

    const scoped = ((requestsRes.data ?? []) as DbLeave[]).filter((r) => {
      if (status === "all") return true;
      const d = decisionByRequest.get(r.id);
      return (d ? d.decision : "pending") === status;
    });

    return scoped.slice(0, limit).map((row) => {
      const base = mapRow(row, decisionByRequest.get(row.id));
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
        school_id: ctx.schoolId,
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

    const client = getClient(toRepoContext(ctx));
    const decidedAt = new Date().toISOString();

    // CHUNK 8 BATCH 1b. The decision row is written FIRST and is the authority.
    //
    // The column is still updated below, and that is deliberate for one batch:
    // batch 1c drops the column and this dual write together. Nothing reads the
    // column any more, so it cannot disagree with the authority in a way anyone
    // can see — but leaving it stale while it still exists would be a second
    // home that only looks harmless because 1c is coming.
    //
    // `.eq("status", "pending")` on the UPDATE is what makes this idempotent:
    // a second decide() on an already-decided request matches no row and is
    // rejected below, so the insert cannot produce a duplicate decision.
    const { data, error } = await client
      .from("leave_requests")
      .update({
        status: decision,
        reviewed_at: decidedAt,
        reviewed_by: ctx.userId,
      } as never)
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

    const decisionRow: DbLeaveDecision = {
      leave_request_id: leaveId,
      decision,
      decided_by: ctx.userId,
      // The CAPACITY acted in, not the app_role — the distinction batch 1a made
      // for the backfill, kept for new rows so the two are one vocabulary.
      decided_by_role: ctx.role ?? null,
      decided_at: decidedAt,
      reason: adminRemarks?.trim() || null,
    };
    const { error: decisionErr } = await client
      .from("leave_decisions")
      .insert({ ...decisionRow, school_id: ctx.schoolId } as never);
    throwIfError(decisionErr, "Failed to record leave decision");

    const row = mapRow(data as DbLeave, mapDecision(decisionRow));

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
