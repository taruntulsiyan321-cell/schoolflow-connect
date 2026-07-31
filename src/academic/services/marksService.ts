import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import {
  getExam,
  listExamsForClass,
  listPublishedResultsForClass,
  listMarksForExam,
  listMarksForStudent,
  publishMarks,
  type ExamRecord,
  type MarksRecord,
  type PublishMarksInput,
} from "../repository/marksRepository";
import { teacherAssignedToClassSubject } from "../repository/teacherAssignmentRepository";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import type { PageParams } from "../repository/base";
import { ForbiddenError, isSchoolOperator } from "./context";
import { assertMayAccessStudent } from "./parentAccess";
import { emitEvent } from "../repository/eventsRepository";
import { assertTeacherMayManageAcademicWork } from "./workLifecycle";
import { ValidationFailedError } from "../repository/errors";

/**
 * MarksService — Teacher publishes marks for assigned subjects only.
 * Examination + examination_marks share this service (single source: exams/marks).
 * Finalize ≠ Publish Results.
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
    // Teachers/operators see all schedules; students/parents see schedules too
    // (results visibility is gated separately via listForStudent / listPublishedResultsForClass).
    return listExamsForClass(toRepoContext(ctx), classId, page);
  },

  /** Exams with results_published_at set — for result consumers. */
  async listPublishedResultsForClass(
    ctx: ServiceContext,
    classId: string,
    page?: PageParams,
  ): Promise<ExamRecord[]> {
    assertCanConsume(ctx, "examination");
    return listPublishedResultsForClass(toRepoContext(ctx), classId, page);
  },

  async listForExam(ctx: ServiceContext, examId: string): Promise<MarksRecord[]> {
    assertCanConsume(ctx, "marks");
    const exam = await getExam(toRepoContext(ctx), examId);
    if (
      (ctx.role === "student" || ctx.role === "parent") &&
      !exam.resultsPublishedAt
    ) {
      throw new ForbiddenError("Exam results have not been published yet");
    }
    return listMarksForExam(toRepoContext(ctx), examId);
  },

  async listForStudent(
    ctx: ServiceContext,
    studentId: string,
    page?: PageParams,
  ): Promise<MarksRecord[]> {
    assertCanConsume(ctx, "marks");
    await assertMayAccessStudent(ctx, studentId);
    const repo = toRepoContext(ctx);
    const marks = await listMarksForStudent(repo, studentId, page);
    if (marks.length === 0) return [];

    const examIds = [...new Set(marks.map((m) => m.examId))];
    const { data: exams, error } = await getClient(repo)
      .from("exams")
      .select("id, results_published_at")
      .eq("school_id", schoolIdOf(repo))
      .in("id", examIds);
    throwIfError(error, "Failed to load exams for marks filter");

    const published = new Set(
      (exams ?? [])
        .filter((e) => e.results_published_at != null)
        .map((e) => String(e.id)),
    );
    return marks.filter((m) => published.has(m.examId));
  },

  /**
   * Enter / update marks. Verifies teacher–class–subject assignment unless school operator.
   * Rejected when marks are locked (finalizeMarks).
   */
  async publish(
    ctx: ServiceContext,
    input: Omit<PublishMarksInput, "teacherAssignedToSubject">,
  ): Promise<MarksRecord> {
    assertCanOwn(ctx, "marks");

    const exam = await getExam(toRepoContext(ctx), input.examId);
    await assertTeacherMayManageAcademicWork(ctx, exam.classId, exam.subject);
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

  async upsertExam(
    ctx: ServiceContext,
    input: import("../repository/examRepository").UpsertExamInput,
  ): Promise<ExamRecord> {
    assertCanOwn(ctx, "examination");
    await assertTeacherMayManageAcademicWork(ctx, input.classId, input.subject);
    const { upsertExam } = await import("../repository/examRepository");
    const repo = toRepoContext(ctx);
    const exam = await upsertExam(repo, input);
    if (!input.id) {
      await emitEvent(repo, {
        eventType: "examination.scheduled",
        entityType: "examination",
        entityId: exam.id,
        classId: exam.classId,
        payload: {
          name: exam.name,
          subject: exam.subject,
          examType: exam.examType,
          title: exam.name,
        },
      }).catch(() => undefined);
    } else {
      await emitEvent(repo, {
        eventType: "examination.updated",
        entityType: "examination",
        entityId: exam.id,
        classId: exam.classId,
        payload: { name: exam.name, subject: exam.subject, examType: exam.examType },
      }).catch(() => undefined);
    }
    return exam;
  },

  async removeExam(ctx: ServiceContext, examId: string): Promise<void> {
    assertCanOwn(ctx, "examination");
    const exam = await getExam(toRepoContext(ctx), examId);
    await assertTeacherMayManageAcademicWork(ctx, exam.classId, exam.subject);
    const { deleteExam } = await import("../repository/examRepository");
    await deleteExam(toRepoContext(ctx), examId);
  },

  async publishBatch(
    ctx: ServiceContext,
    examId: string,
    rows: { studentId: string; marksObtained: number; remarks?: string | null }[],
  ): Promise<number> {
    assertCanOwn(ctx, "marks");
    const exam = await getExam(toRepoContext(ctx), examId);
    await assertTeacherMayManageAcademicWork(ctx, exam.classId, exam.subject);
    let assigned = isSchoolOperator(ctx.role);
    if (!assigned) {
      assigned = await teacherAssignedToClassSubject(toRepoContext(ctx), {
        teacherUserId: ctx.userId,
        classId: exam.classId,
        subject: exam.subject,
        subjectId: exam.subjectId,
      });
    }
    const { publishMarksBatch } = await import("../repository/examRepository");
    return publishMarksBatch(toRepoContext(ctx), examId, rows, assigned);
  },

  /** Lock marks — no further edits. Does not notify students. */
  async finalizeMarks(ctx: ServiceContext, examId: string): Promise<ExamRecord> {
    assertCanOwn(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exam = await getExam(repo, examId);
    await assertTeacherMayManageAcademicWork(ctx, exam.classId, exam.subject);

    const { error } = await getClient(repo)
      .from("exams")
      .update({
        marks_locked: true,
        updated_at: new Date().toISOString(),
      } as never)
      .eq("id", examId)
      .eq("school_id", schoolIdOf(repo));
    throwIfError(error, "Failed to finalize marks");

    await emitEvent(repo, {
      eventType: "examination.finalized",
      entityType: "examination",
      entityId: examId,
      classId: exam.classId,
      payload: { name: exam.name, subject: exam.subject, examType: exam.examType },
    }).catch(() => undefined);

    return getExam(repo, examId);
  },

  /**
   * Publish results to students/parents. Requires marks_locked.
   * Emits marks.results_published (student notify path).
   */
  async publishResults(ctx: ServiceContext, examId: string): Promise<ExamRecord> {
    assertCanOwn(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exam = await getExam(repo, examId);
    await assertTeacherMayManageAcademicWork(ctx, exam.classId, exam.subject);

    if (!exam.marksLocked) {
      throw new ValidationFailedError([
        {
          field: "examId",
          code: "not_finalized",
          message: "Finalize marks before publishing results",
        },
      ]);
    }

    const now = new Date().toISOString();
    const { error } = await getClient(repo)
      .from("exams")
      .update({
        results_published_at: now,
        updated_at: now,
      } as never)
      .eq("id", examId)
      .eq("school_id", schoolIdOf(repo));
    throwIfError(error, "Failed to publish exam results");

    await emitEvent(repo, {
      eventType: "marks.results_published",
      entityType: "examination",
      entityId: examId,
      classId: exam.classId,
      payload: { classId: exam.classId, name: exam.name },
    }).catch(() => undefined);

    return getExam(repo, examId);
  },
};
