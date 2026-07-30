import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import {
  getExam,
  listExamsForClass,
  listMarksForExam,
  listMarksForStudent,
  publishMarks,
  type ExamRecord,
  type MarksRecord,
  type PublishMarksInput,
} from "../repository/marksRepository";
import { teacherAssignedToClassSubject } from "../repository/teacherAssignmentRepository";
import type { PageParams } from "../repository/base";
import { ForbiddenError, isSchoolOperator } from "./context";

/**
 * MarksService — Teacher publishes marks for assigned subjects only.
 * Examination + examination_marks share this service (single source: exams/marks).
 */
export const MarksService = {
  async getExam(ctx: ServiceContext, examId: string): Promise<ExamRecord> {
    assertCanConsume(ctx, "examination");
    return getExam(toRepoContext(ctx), examId);
  },

  async listExamsForClass(
    ctx: ServiceContext,
    classId: string,
    page?: PageParams,
  ): Promise<ExamRecord[]> {
    assertCanConsume(ctx, "examination");
    return listExamsForClass(toRepoContext(ctx), classId, page);
  },

  async listForExam(ctx: ServiceContext, examId: string): Promise<MarksRecord[]> {
    assertCanConsume(ctx, "marks");
    return listMarksForExam(toRepoContext(ctx), examId);
  },

  async listForStudent(
    ctx: ServiceContext,
    studentId: string,
    page?: PageParams,
  ): Promise<MarksRecord[]> {
    assertCanConsume(ctx, "marks");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own marks");
    }
    return listMarksForStudent(toRepoContext(ctx), studentId, page);
  },

  /**
   * Publish marks. Verifies teacher–class–subject assignment unless school operator.
   */
  async publish(
    ctx: ServiceContext,
    input: Omit<PublishMarksInput, "teacherAssignedToSubject">,
  ): Promise<MarksRecord> {
    assertCanOwn(ctx, "marks");

    const exam = await getExam(toRepoContext(ctx), input.examId);
    let assigned = isSchoolOperator(ctx.role);

    if (!assigned) {
      assigned = await teacherAssignedToClassSubject(toRepoContext(ctx), {
        teacherUserId: ctx.userId,
        classId: exam.classId,
        subject: exam.subject,
        subjectId: exam.subjectId,
      });
    }

    return publishMarks(toRepoContext(ctx), {
      ...input,
      teacherAssignedToSubject: assigned,
    });
  },
};
