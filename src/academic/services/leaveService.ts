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
  /**
   * EVERY decision on this request. A student's leave goes to both the class
   * teacher and the principal and either may act, so two rows are legal —
   * leave_decisions is UNIQUE on (leave_request_id, decided_by_role), not on
   * leave_request_id alone.
   *
   * An array, not a scalar, because the spec forbids computing a single
   * combined verdict: "Approved by class teacher · Rejected by principal" is
   * displayed as it stands. A Map keyed by request id used to collapse the
   * pair to whichever row Postgres happened to return last — and the query
   * carries no ORDER BY, so which one survived could flip between two loads.
   */
  decisions: LeaveDecisionRow[];
  /** No one has decided. The only scalar that stays well-defined at two. */
  isPending: boolean;
  createdAt: string;
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
  created_at: string;
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
function groupDecisions(rows: DbLeaveDecision[]): Map<string, LeaveDecisionRow[]> {
  const byRequest = new Map<string, LeaveDecisionRow[]>();
  for (const d of rows) {
    const list = byRequest.get(d.leave_request_id);
    if (list) list.push(mapDecision(d));
    else byRequest.set(d.leave_request_id, [mapDecision(d)]);
  }
  return byRequest;
}

/**
 * Does this request belong under a status tab? Membership, not a verdict — a
 * request the class teacher approved and the principal rejected appears under
 * both, which is what "no single combined verdict is computed" has to mean at
 * the filter as well as at the badge.
 */
export function matchesStatus(
  decisions: LeaveDecisionRow[],
  status: LeaveStatus | "all",
): boolean {
  if (status === "all") return true;
  if (status === "pending") return decisions.length === 0;
  return decisions.some((d) => d.decision === status);
}

export function decisionAttribution(d: LeaveDecisionRow | undefined): string | null {
  if (!d) return null;
  if (!d.decidedBy) return "decider not recorded";
  return d.decidedByRole ? `decided by ${d.decidedByRole}` : "decided";
}

function mapRow(row: DbLeave, decisions: LeaveDecisionRow[] = []): LeaveRequestRow {
  return {
    id: row.id,
    applicantUserId: row.applicant_user_id,
    applicantKind: row.applicant_kind,
    leaveType: row.leave_type,
    fromDate: row.from_date,
    toDate: row.to_date,
    reason: row.reason,
    // DERIVED, not read. Pending is the absence of any decision — the one
    // question that stays well-defined when two deciders disagree.
    decisions,
    isPending: decisions.length === 0,
    createdAt: row.created_at,
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

    const byRequest = groupDecisions((decisions ?? []) as unknown as DbLeaveDecision[]);
    return rows.map((r) => mapRow(r, byRequest.get(r.id) ?? []));
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

    const decisionByRequest = groupDecisions((decisionsRes.data ?? []) as DbLeaveDecision[]);

    // Filter on the DERIVED membership before the limit. Limiting first would
    // return fewer rows than asked for and silently drop the rest.
    const scoped = ((requestsRes.data ?? []) as DbLeave[]).filter((r) =>
      matchesStatus(decisionByRequest.get(r.id) ?? [], status),
    );

    return scoped.slice(0, limit).map((row) => {
      const base = mapRow(row, decisionByRequest.get(row.id) ?? []);
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

    // CHUNK 8 BATCH 1c. The dual write is gone: leave_decisions is the only
    // record of a verdict, and status / reviewed_at / reviewed_by are dropped.
    //
    // The UPDATE this replaces was doing two jobs. Keeping the column in sync
    // was one; the other was `.eq("status", "pending")`, which proved the
    // request existed AND was undecided, and was what stopped a second decide()
    // inserting a duplicate. Deleting the UPDATE without replacing that check
    // is the one way this batch could silently regress correctness.
    //
    // Existence is now proved by reading the row — RLS scopes it, so a request
    // in another school reads as absent, exactly as before. Uniqueness is no
    // longer the client's job at all: leave_decisions is UNIQUE per
    // (leave_request_id, decided_by_role), with a partial unique index covering
    // the role-less case, so a duplicate is rejected by Postgres rather than by
    // a predicate the client hopes it remembered to write.
    //
    // Deliberately NOT re-added: a guard rejecting a decision because someone
    // else already decided. A student's leave goes to both the class teacher
    // and the principal and either may act — the old guard made the second
    // decision impossible, which is why no live request has two.
    const { data, error } = await client
      .from("leave_requests")
      .select("*")
      .eq("id", leaveId)
      .maybeSingle();
    throwIfError(error, "Failed to load leave request");
    if (!data) {
      throw new ValidationFailedError([
        { field: "leaveId", code: "not_found", message: "Leave request not found" },
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

    // Re-read every decision on this request. Mapping only the row just written
    // would hand the caller a request that hides the other decider's verdict.
    const { data: allDecisions, error: reReadErr } = await client
      .from("leave_decisions")
      .select("leave_request_id, decision, decided_by, decided_by_role, decided_at, reason")
      .eq("leave_request_id", leaveId);
    throwIfError(reReadErr, "Failed to re-read leave decisions");
    const row = mapRow(
      data as DbLeave,
      groupDecisions((allDecisions ?? []) as unknown as DbLeaveDecision[]).get(leaveId) ?? [],
    );

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
