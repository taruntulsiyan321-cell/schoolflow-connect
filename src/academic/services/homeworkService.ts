import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./context";
import {
  getHomework,
  listHomeworkForClass,
  listHomeworkForSchool,
  createHomework,
  updateHomework,
  publishHomework,
  unpublishHomework,
  archiveHomework,
  duplicateHomework,
  deleteHomework,
  listSubmissionsForHomework,
  listSubmissionsForHomeworkIds,
  upsertHomeworkSubmission,
  reviewHomeworkSubmission,
  gradeHomeworkSubmission,
  type HomeworkRecord,
  type HomeworkSubmissionRecord,
  type CreateHomeworkInput,
  type UpdateHomeworkInput,
  type HomeworkListFilters,
  type SubmitHomeworkInput,
  type ReviewHomeworkInput,
} from "../repository/homeworkRepository";
import { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";
import { teacherAssignedToClassSubject } from "../repository/teacherAssignmentRepository";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import type { PageParams } from "../repository/base";
import { assertMayAccessStudent } from "./parentAccess";

export interface StudentHomeworkRow {
  homework: HomeworkRecord;
  submission: HomeworkSubmissionRecord | null;
  /** Derived display status for panels — computed in service, not React. */
  displayStatus: string;
}

export interface HomeworkClassStatsRow extends HomeworkRecord {
  submitted: number;
  graded: number;
  pending: number;
  awaitingReview: number;
  returned: number;
  late: number;
  totalStudents: number;
  completionPct: number;
}

export interface SchoolHomeworkSummary {
  totalAssigned: number;
  totalPublished: number;
  totalDrafts: number;
  totalArchived: number;
  submissionCount: number;
  lateSubmissionCount: number;
  gradedCount: number;
  schoolCompletionPct: number;
  latePct: number;
  classes: {
    classId: string;
    className: string;
    section: string;
    homeworkCount: number;
    completionPct: number;
    latePct: number;
  }[];
  teacherActivity: {
    teacherUserId: string;
    homeworkCount: number;
  }[];
}

async function assertTeacherMayManageClass(
  ctx: ServiceContext,
  classId: string,
  subject?: string | null,
): Promise<void> {
  if (isSchoolOperator(ctx.role)) return;
  if (ctx.role !== "teacher") {
    throw new ForbiddenError("Only teachers may manage homework for a class");
  }
  await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
  const subj = subject?.trim();
  if (subj && subj.toLowerCase() !== "general") {
    const ok = await teacherAssignedToClassSubject(toRepoContext(ctx), {
      teacherUserId: ctx.userId,
      classId,
      subject: subj,
    });
    if (!ok) {
      throw new ForbiddenError(
        "Teachers may only manage homework for subjects assigned to their class",
      );
    }
  }
}

/** Resolve submission → homework → assert teacher owns that class/subject. */
async function assertTeacherMayManageSubmission(
  ctx: ServiceContext,
  submissionId: string,
): Promise<{ homeworkId: string; studentId: string }> {
  const repo = toRepoContext(ctx);
  const { data, error } = await getClient(repo)
    .from("homework_submissions")
    .select("id, homework_id, student_id, school_id")
    .eq("id", submissionId)
    .eq("school_id", schoolIdOf(repo))
    .maybeSingle();
  throwIfError(error, "Failed to load submission for authorization");
  if (!data) throw new ForbiddenError("Submission not found");
  const hw = await getHomework(repo, data.homework_id);
  await assertTeacherMayManageClass(ctx, hw.classId, hw.subject);
  const { data: student, error: sErr } = await getClient(repo)
    .from("students")
    .select("id, class_id")
    .eq("id", data.student_id)
    .eq("school_id", schoolIdOf(repo))
    .maybeSingle();
  throwIfError(sErr, "Failed to verify student for submission");
  if (!student || student.class_id !== hw.classId) {
    throw new ForbiddenError("Submission student is not in the homework class");
  }
  return { homeworkId: data.homework_id, studentId: data.student_id };
}

async function assertStudentInHomeworkClass(
  ctx: ServiceContext,
  homeworkId: string,
  studentId: string,
): Promise<HomeworkRecord> {
  const repo = toRepoContext(ctx);
  const hw = await getHomework(repo, homeworkId);
  const { data: student, error } = await getClient(repo)
    .from("students")
    .select("id, class_id, school_id")
    .eq("id", studentId)
    .eq("school_id", schoolIdOf(repo))
    .maybeSingle();
  throwIfError(error, "Failed to verify student class");
  if (!student || student.class_id !== hw.classId) {
    throw new ForbiddenError("Student does not belong to this homework class");
  }
  return hw;
}

function isPastDue(hw: HomeworkRecord, now = new Date()): boolean {
  if (!hw.dueDate) return false;
  return now.getTime() > new Date(`${hw.dueDate}T${hw.dueTime ?? "23:59:59"}`).getTime();
}

/** Statuses that count toward completion (returned still needs resubmit). */
const COMPLETE_SUBMISSION_STATUSES = [
  "submitted",
  "late",
  "reviewed",
  "graded",
  "completed",
] as const;

function studentDisplayStatus(
  hw: HomeworkRecord,
  sub: HomeworkSubmissionRecord | null,
): string {
  if (!sub) {
    if (isPastDue(hw)) return "Late";
    return "Assigned";
  }
  switch (sub.status) {
    case "submitted":
      return sub.isLate ? "Late" : "Submitted";
    case "late":
      return "Late";
    case "reviewed":
      return "Reviewed";
    case "returned":
      return "Returned";
    case "graded":
    case "completed":
      return "Completed";
    default:
      return "Assigned";
  }
}

/**
 * HomeworkService — Homework + Assignment product language.
 * Teacher owns writes (class-scoped); Student submits; Parent/Principal/Admin consume.
 * All panel mutations must go through here (never direct Supabase from UI).
 */
export const HomeworkService = {
  async get(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    assertCanConsume(ctx, "homework");
    const hw = await getHomework(toRepoContext(ctx), homeworkId);
    if (ctx.role === "teacher") {
      await assertTeacherMayManageClass(ctx, hw.classId, hw.subject);
    }
    return hw;
  },

  async listForClass(
    ctx: ServiceContext,
    classId: string,
    page?: PageParams,
    filters?: HomeworkListFilters,
  ): Promise<HomeworkRecord[]> {
    assertCanConsume(ctx, "homework");
    if (ctx.role === "teacher") {
      await assertTeacherMayManageClass(ctx, classId);
    }
    return listHomeworkForClass(toRepoContext(ctx), classId, page, filters);
  },

  /** School-wide list — principal/admin monitoring. */
  async listForSchool(
    ctx: ServiceContext,
    page?: PageParams,
    filters?: HomeworkListFilters,
  ): Promise<HomeworkRecord[]> {
    assertCanConsume(ctx, "homework");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("School homework list is admin/principal-only");
    }
    return listHomeworkForSchool(toRepoContext(ctx), page, filters);
  },

  /** Class homework + submission counts (batched — no N+1). */
  async listForClassWithStats(
    ctx: ServiceContext,
    classId: string,
    page?: PageParams,
    filters?: HomeworkListFilters,
  ): Promise<HomeworkClassStatsRow[]> {
    assertCanConsume(ctx, "homework");
    if (ctx.role === "teacher") {
      await assertTeacherMayManageClass(ctx, classId);
    }
    const repo = toRepoContext(ctx);
    const items = await listHomeworkForClass(repo, classId, page, filters);
    const { count, error } = await getClient(repo)
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolIdOf(repo))
      .eq("class_id", classId);
    throwIfError(error, "Failed to count students");
    const totalStudents = count ?? 0;

    const subs = await listSubmissionsForHomeworkIds(
      repo,
      items.map((h) => h.id),
    );
    const byHw = new Map<string, typeof subs>();
    for (const s of subs) {
      const arr = byHw.get(s.homeworkId) ?? [];
      arr.push(s);
      byHw.set(s.homeworkId, arr);
    }

    return items.map((hw) => {
      const list = byHw.get(hw.id) ?? [];
      const submitted = list.filter((s) =>
        (COMPLETE_SUBMISSION_STATUSES as readonly string[]).includes(s.status),
      ).length;
      const graded = list.filter((s) =>
        ["graded", "reviewed", "completed"].includes(s.status),
      ).length;
      const late = list.filter((s) => s.isLate || s.status === "late").length;
      const awaitingReview = list.filter((s) =>
        ["submitted", "late"].includes(s.status),
      ).length;
      const returned = list.filter((s) => s.status === "returned").length;
      const turnedIn = list.filter(
        (s) => s.status && s.status !== "pending",
      ).length;
      const completionPct = totalStudents
        ? Math.round((Math.min(submitted, totalStudents) / totalStudents) * 1000) / 10
        : 0;
      return {
        ...hw,
        submitted,
        graded,
        late,
        awaitingReview,
        returned,
        pending: Math.max(0, totalStudents - turnedIn),
        totalStudents,
        completionPct,
      };
    });
  },

  async listForStudent(
    ctx: ServiceContext,
    studentId: string,
  ): Promise<StudentHomeworkRow[]> {
    assertCanConsume(ctx, "homework");
    await assertMayAccessStudent(ctx, studentId);
    const repo = toRepoContext(ctx);
    const { data: student, error } = await getClient(repo)
      .from("students")
      .select("id, class_id")
      .eq("id", studentId)
      .eq("school_id", schoolIdOf(repo))
      .maybeSingle();
    throwIfError(error, "Failed to load student");
    if (!student?.class_id) return [];

    const homework = await listHomeworkForClass(repo, student.class_id, { limit: 100 }, {
      status: "active",
    });
    const subs = await listSubmissionsForHomeworkIds(
      repo,
      homework.map((h) => h.id),
    );
    return homework.map((hw) => {
      const submission = subs.find((s) => s.studentId === studentId && s.homeworkId === hw.id) ?? null;
      return {
        homework: hw,
        submission,
        displayStatus: studentDisplayStatus(hw, submission),
      };
    });
  },

  async assign(ctx: ServiceContext, input: CreateHomeworkInput): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    await assertTeacherMayManageClass(ctx, input.classId, input.subject);
    return createHomework(toRepoContext(ctx), {
      ...input,
      status: input.status ?? "published",
    });
  },

  async createDraft(ctx: ServiceContext, input: CreateHomeworkInput): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    await assertTeacherMayManageClass(ctx, input.classId, input.subject);
    return createHomework(toRepoContext(ctx), { ...input, status: "draft" });
  },

  async update(
    ctx: ServiceContext,
    homeworkId: string,
    input: UpdateHomeworkInput,
  ): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageClass(ctx, existing.classId, existing.subject);
    if (input.classId && input.classId !== existing.classId) {
      await assertTeacherMayManageClass(ctx, input.classId, input.subject ?? existing.subject);
    }
    return updateHomework(toRepoContext(ctx), homeworkId, input);
  },

  async publish(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageClass(ctx, existing.classId, existing.subject);
    return publishHomework(toRepoContext(ctx), homeworkId);
  },

  async unpublish(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageClass(ctx, existing.classId, existing.subject);
    return unpublishHomework(toRepoContext(ctx), homeworkId);
  },

  async archive(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageClass(ctx, existing.classId, existing.subject);
    return archiveHomework(toRepoContext(ctx), homeworkId);
  },

  async duplicate(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageClass(ctx, existing.classId, existing.subject);
    return duplicateHomework(toRepoContext(ctx), homeworkId);
  },

  async listSubmissions(
    ctx: ServiceContext,
    homeworkId: string,
  ): Promise<HomeworkSubmissionRecord[]> {
    assertCanConsume(ctx, "homework_submission");
    const hw = await getHomework(toRepoContext(ctx), homeworkId);
    if (ctx.role === "teacher") {
      await assertTeacherMayManageClass(ctx, hw.classId, hw.subject);
    } else if (ctx.role === "student" || ctx.role === "parent") {
      throw new ForbiddenError("Students and parents may not list all class submissions");
    }
    return listSubmissionsForHomework(toRepoContext(ctx), homeworkId);
  },

  async submit(
    ctx: ServiceContext,
    input: SubmitHomeworkInput,
  ): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework_submission");
    if (ctx.role === "student") {
      if (ctx.studentId && ctx.studentId !== input.studentId) {
        throw new ForbiddenError("Students may only submit their own homework");
      }
      if (!ctx.studentId) {
        await assertMayAccessStudent(ctx, input.studentId);
      }
    } else if (ctx.role === "teacher") {
      // Teachers may not forge submissions for arbitrary students
      throw new ForbiddenError("Teachers cannot submit homework on behalf of students");
    } else if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Not authorized to submit homework");
    }
    await assertStudentInHomeworkClass(ctx, input.homeworkId, input.studentId);
    return upsertHomeworkSubmission(toRepoContext(ctx), input);
  },

  async remove(ctx: ServiceContext, homeworkId: string): Promise<void> {
    assertCanOwn(ctx, "homework");
    const existing = await getHomework(toRepoContext(ctx), homeworkId);
    await assertTeacherMayManageClass(ctx, existing.classId, existing.subject);
    await deleteHomework(toRepoContext(ctx), homeworkId);
  },

  async grade(
    ctx: ServiceContext,
    input: { submissionId: string; grade: string; remarks?: string | null },
  ): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework");
    await assertTeacherMayManageSubmission(ctx, input.submissionId);
    return gradeHomeworkSubmission(toRepoContext(ctx), input);
  },

  async review(
    ctx: ServiceContext,
    input: ReviewHomeworkInput,
  ): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework");
    await assertTeacherMayManageSubmission(ctx, input.submissionId);
    return reviewHomeworkSubmission(toRepoContext(ctx), input);
  },

  /**
   * School homework analytics for Principal/Admin — computed in engine.
   * UI must display these values, never recalculate.
   */
  async summarizeSchool(ctx: ServiceContext): Promise<SchoolHomeworkSummary> {
    assertCanConsume(ctx, "homework");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("School homework summary is admin/principal-only");
    }
    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);

    const [{ data: classes, error: cErr }, { data: hw, error: hErr }, { data: subs, error: sErr }] =
      await Promise.all([
        client.from("classes").select("id, name, section").eq("school_id", schoolId),
        client
          .from("homework")
          .select("id, class_id, status, created_by")
          .eq("school_id", schoolId),
        client
          .from("homework_submissions")
          .select("id, homework_id, status, is_late")
          .eq("school_id", schoolId),
      ]);
    throwIfError(cErr, "Failed to list classes");
    throwIfError(hErr, "Failed to list homework");
    throwIfError(sErr, "Failed to list submissions");

    const homework = hw ?? [];
    const submissions = subs ?? [];
    const published = homework.filter((h) =>
      ["published", "active"].includes(String(h.status ?? "")),
    );
    const drafts = homework.filter((h) => h.status === "draft");
    const archived = homework.filter((h) => h.status === "archived");
    const gradedCount = submissions.filter((s) =>
      ["graded", "reviewed", "completed"].includes(String(s.status)),
    ).length;

    const hwByClass = new Map<string, typeof homework>();
    for (const h of homework) {
      const arr = hwByClass.get(h.class_id) ?? [];
      arr.push(h);
      hwByClass.set(h.class_id, arr);
    }
    const subByHw = new Map<string, typeof submissions>();
    for (const s of submissions) {
      const arr = subByHw.get(s.homework_id) ?? [];
      arr.push(s);
      subByHw.set(s.homework_id, arr);
    }

    const { data: classStudentCounts } = await client
      .from("students")
      .select("class_id")
      .eq("school_id", schoolId);
    const countByClass = new Map<string, number>();
    for (const s of classStudentCounts ?? []) {
      if (!s.class_id) continue;
      countByClass.set(s.class_id, (countByClass.get(s.class_id) ?? 0) + 1);
    }

    let expectedTotal = 0;
    let submittedTotal = 0;
    let lateTotal = 0;

    const classRows = (classes ?? []).map((c) => {
      const list = hwByClass.get(c.id) ?? [];
      const pub = list.filter((h) => ["published", "active"].includes(String(h.status)));
      let submitted = 0;
      let late = 0;
      for (const h of pub) {
        const ss = subByHw.get(h.id) ?? [];
        submitted += ss.filter((x) =>
          (COMPLETE_SUBMISSION_STATUSES as readonly string[]).includes(String(x.status)),
        ).length;
        late += ss.filter((x) => x.is_late || x.status === "late").length;
      }
      const students = countByClass.get(c.id) ?? 0;
      const expectedClass = students * pub.length;
      expectedTotal += expectedClass;
      submittedTotal += submitted;
      lateTotal += late;
      return {
        classId: c.id,
        className: c.name,
        section: c.section ?? "",
        homeworkCount: pub.length,
        completionPct: expectedClass
          ? Math.round((Math.min(submitted, expectedClass) / expectedClass) * 1000) / 10
          : 0,
        latePct: submitted ? Math.round((late / submitted) * 1000) / 10 : 0,
      };
    });

    const schoolCompletionPct = expectedTotal
      ? Math.round((Math.min(submittedTotal, expectedTotal) / expectedTotal) * 1000) / 10
      : 0;
    const latePct = submittedTotal
      ? Math.round((lateTotal / submittedTotal) * 1000) / 10
      : 0;

    const teacherMap = new Map<string, number>();
    for (const h of homework) {
      if (!h.created_by) continue;
      teacherMap.set(h.created_by, (teacherMap.get(h.created_by) ?? 0) + 1);
    }

    return {
      totalAssigned: published.length,
      totalPublished: published.length,
      totalDrafts: drafts.length,
      totalArchived: archived.length,
      submissionCount: submittedTotal,
      lateSubmissionCount: lateTotal,
      gradedCount,
      schoolCompletionPct,
      latePct,
      classes: classRows.sort((a, b) => b.completionPct - a.completionPct),
      teacherActivity: [...teacherMap.entries()].map(([teacherUserId, homeworkCount]) => ({
        teacherUserId,
        homeworkCount,
      })),
    };
  },
};

/** Product alias — Assignment is Homework. */
export const AssignmentService = HomeworkService;
