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
import type { PageParams } from "../repository/base";

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
