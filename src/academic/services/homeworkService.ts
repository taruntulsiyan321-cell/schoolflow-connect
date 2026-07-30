import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import {
  getHomework,
  listHomeworkForClass,
  createHomework,
  listSubmissionsForHomework,
  upsertHomeworkSubmission,
  type HomeworkRecord,
  type HomeworkSubmissionRecord,
  type CreateHomeworkInput,
} from "../repository/homeworkRepository";
import { emitEvent } from "../repository/eventsRepository";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import type { PageParams } from "../repository/base";
import { assertMayAccessStudent } from "./parentAccess";

export interface StudentHomeworkRow {
  homework: HomeworkRecord;
  submission: HomeworkSubmissionRecord | null;
}

/**
 * HomeworkService — covers Homework and Assignment product language.
 * Teacher creates; Student submits. Single store: homework / homework_submissions.
 */
export const HomeworkService = {
  async get(ctx: ServiceContext, homeworkId: string): Promise<HomeworkRecord> {
    assertCanConsume(ctx, "homework");
    return getHomework(toRepoContext(ctx), homeworkId);
  },

  async listForClass(
    ctx: ServiceContext,
    classId: string,
    page?: PageParams,
  ): Promise<HomeworkRecord[]> {
    assertCanConsume(ctx, "homework");
    return listHomeworkForClass(toRepoContext(ctx), classId, page);
  },

  /** Class homework + submission counts (computed in service). */
  async listForClassWithStats(
    ctx: ServiceContext,
    classId: string,
    page?: PageParams,
  ): Promise<
    (HomeworkRecord & {
      submitted: number;
      graded: number;
      pending: number;
      totalStudents: number;
    })[]
  > {
    assertCanConsume(ctx, "homework");
    const repo = toRepoContext(ctx);
    const items = await listHomeworkForClass(repo, classId, page);
    const { count, error } = await getClient(repo)
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolIdOf(repo))
      .eq("class_id", classId);
    throwIfError(error, "Failed to count students");
    const totalStudents = count ?? 0;

    const out = [];
    for (const hw of items) {
      const subs = await listSubmissionsForHomework(repo, hw.id);
      const submitted = subs.filter((s) => s.status === "submitted" || s.status === "graded").length;
      const graded = subs.filter((s) => s.status === "graded").length;
      out.push({
        ...hw,
        submitted,
        graded,
        pending: Math.max(0, totalStudents - submitted),
        totalStudents,
      });
    }
    return out;
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

    const homework = await listHomeworkForClass(repo, student.class_id, { limit: 100 });
    const rows: StudentHomeworkRow[] = [];
    for (const hw of homework) {
      const subs = await listSubmissionsForHomework(repo, hw.id);
      rows.push({
        homework: hw,
        submission: subs.find((s) => s.studentId === studentId) ?? null,
      });
    }
    return rows;
  },

  async assign(ctx: ServiceContext, input: CreateHomeworkInput): Promise<HomeworkRecord> {
    assertCanOwn(ctx, "homework");
    return createHomework(toRepoContext(ctx), input);
  },

  async listSubmissions(
    ctx: ServiceContext,
    homeworkId: string,
  ): Promise<HomeworkSubmissionRecord[]> {
    assertCanConsume(ctx, "homework_submission");
    return listSubmissionsForHomework(toRepoContext(ctx), homeworkId);
  },

  async submit(
    ctx: ServiceContext,
    input: { homeworkId: string; studentId: string; content: string },
  ): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework_submission");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== input.studentId) {
      throw new ForbiddenError("Students may only submit their own homework");
    }
    const submission = await upsertHomeworkSubmission(toRepoContext(ctx), input);
    await emitEvent(toRepoContext(ctx), {
      eventType: "homework.submission.created",
      entityType: "homework_submission",
      entityId: submission.id,
      studentId: submission.studentId,
      payload: { homeworkId: submission.homeworkId },
    }).catch(() => undefined);
    return submission;
  },

  async remove(ctx: ServiceContext, homeworkId: string): Promise<void> {
    assertCanOwn(ctx, "homework");
    const { deleteHomework } = await import("../repository/homeworkRepository");
    await deleteHomework(toRepoContext(ctx), homeworkId);
  },

  async grade(
    ctx: ServiceContext,
    input: { submissionId: string; grade: string; remarks?: string | null },
  ): Promise<HomeworkSubmissionRecord> {
    assertCanOwn(ctx, "homework");
    const { gradeHomeworkSubmission } = await import("../repository/homeworkRepository");
    return gradeHomeworkSubmission(toRepoContext(ctx), input);
  },
};

/** Product alias — Assignment is Homework. */
export const AssignmentService = HomeworkService;
