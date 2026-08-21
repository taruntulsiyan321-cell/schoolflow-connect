import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import {
  getExam,
  listExamsForClass,
  listExamsForSchool,
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
import { emitEvent, emitEventBestEffort } from "../repository/eventsRepository";
import { assertTeacherMayManageAcademicWork } from "./workLifecycle";
import { ValidationFailedError } from "../repository/errors";
import { broadcastAcademicWrite } from "../live";

function afterMarksWrite(
  ctx: ServiceContext,
  meta?: { classId?: string | null; studentId?: string | null; source?: string },
) {
  broadcastAcademicWrite(ctx.schoolId, ["marks", "examination", "profile"], {
    classId: meta?.classId,
    studentId: meta?.studentId,
    source: meta?.source ?? "MarksService",
  });
}

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

  /** School-wide exam monitor for admin/principal. */
  async listForSchool(
    ctx: ServiceContext,
    page?: PageParams,
  ): Promise<ExamRecord[]> {
    assertCanConsume(ctx, "examination");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only school operators may list school-wide exams");
    }
    return listExamsForSchool(toRepoContext(ctx), page);
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
    const rows = await listMarksForExam(toRepoContext(ctx), examId);
    // Publish-gating above only answers "may this role see published marks
    // at all" -- it does not scope WHICH student's row. A student/parent
    // must only ever see their own (or their own linked children's) marks,
    // never a classmate's. Reuses assertMayAccessStudent (same authorization
    // this service already trusts for listForStudent) rather than a new
    // parent/student-linkage resolution -- exam rosters are small, so a
    // per-row check is cheap and avoids a 6th reimplementation of the
    // parent_user_id / parent_students dual-linkage lookup (see
    // src/lib/parentLinkedStudents.ts's own comment on that exact risk).
    if (ctx.role === "student" || ctx.role === "parent") {
      const allowed: MarksRecord[] = [];
      for (const row of rows) {
        try {
          await assertMayAccessStudent(ctx, row.studentId);
          allowed.push(row);
        } catch {
          // Not this caller's own/linked student -- excluded, not an error.
        }
      }
      return allowed;
    }
    return rows;
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

    // Teachers / school operators need entered-but-unpublished marks for review.
    // Students and parents only see results after publishResults.
    if (ctx.role === "teacher" || isSchoolOperator(ctx.role)) {
      return marks;
    }

    const examIds = [...new Set(marks.map((m) => m.examId))];
    const { data: examsRaw, error } = await getClient(repo)
      .from("exams")
      .select("id, results_published_at")
      .eq("school_id", schoolIdOf(repo))
      .in("id", examIds);
    throwIfError(error, "Failed to load exams for marks filter");
    const exams = examsRaw as unknown as { id: string; results_published_at: string | null }[] | null;

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
    let assigned = isSchoolOperator(ctx.role);
    if (!assigned) {
      assigned = await teacherAssignedToClassSubject(toRepoContext(ctx), {
        teacherUserId: ctx.userId,
        classId: exam.classId,
        subject: exam.subject,
        subjectId: exam.subjectId,
      });
    }
    if (!assigned) {
      throw new ForbiddenError("You can only enter marks for your assigned subject");
    }

    return publishMarks(toRepoContext(ctx), {
      ...input,
      teacherAssignedToSubject: true,
    }).then((row) => {
      afterMarksWrite(ctx, {
        classId: exam.classId,
        studentId: input.studentId,
        source: "MarksService.publish",
      });
      return row;
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
    afterMarksWrite(ctx, { classId: exam.classId, source: "MarksService.upsertExam" });
    return exam;
  },

  async removeExam(ctx: ServiceContext, examId: string): Promise<void> {
    assertCanOwn(ctx, "examination");
    const exam = await getExam(toRepoContext(ctx), examId);
    await assertTeacherMayManageAcademicWork(ctx, exam.classId, exam.subject);
    const { deleteExam } = await import("../repository/examRepository");
    await deleteExam(toRepoContext(ctx), examId);
    await emitEventBestEffort(toRepoContext(ctx), {
      eventType: "examination.deleted",
      entityType: "examination",
      entityId: examId,
      classId: exam.classId,
      payload: {
        name: exam.name,
        subject: exam.subject,
        examType: exam.examType,
      },
    });
    afterMarksWrite(ctx, { classId: exam.classId, source: "MarksService.removeExam" });
  },

  async publishBatch(
    ctx: ServiceContext,
    examId: string,
    rows: { studentId: string; marksObtained: number; remarks?: string | null }[],
  ): Promise<number> {
    assertCanOwn(ctx, "marks");
    const exam = await getExam(toRepoContext(ctx), examId);
    let assigned = isSchoolOperator(ctx.role);
    if (!assigned) {
      assigned = await teacherAssignedToClassSubject(toRepoContext(ctx), {
        teacherUserId: ctx.userId,
        classId: exam.classId,
        subject: exam.subject,
        subjectId: exam.subjectId,
      });
    }
    if (!assigned) {
      throw new ForbiddenError("You can only enter marks for your assigned subject");
    }
    const { publishMarksBatch } = await import("../repository/examRepository");
    const count = await publishMarksBatch(toRepoContext(ctx), examId, rows, true);
    afterMarksWrite(ctx, { classId: exam.classId, source: "MarksService.publishBatch" });
    return count;
  },

  /**
   * Class teacher creates one exam for the class — auto subjects from teacher_classes.
   */
  async createClassExam(
    ctx: ServiceContext,
    input: {
      classId: string;
      name: string;
      startDate: string;
      endDate?: string | null;
      instructions?: string | null;
      examType?: string;
      defaultMaxMarks?: number;
    },
  ): Promise<ExamRecord[]> {
    assertCanOwn(ctx, "examination");
    const repo = toRepoContext(ctx);
    const { isClassTeacherOfClass, listSubjectsForClass } = await import(
      "../repository/teacherClassesRepository"
    );
    if (!isSchoolOperator(ctx.role)) {
      const ok = await isClassTeacherOfClass(repo, ctx.userId, input.classId);
      if (!ok) {
        throw new ForbiddenError("Only the class teacher can create exams for this class");
      }
    }
    const subjects = await listSubjectsForClass(repo, input.classId);
    const { createClassExamGroup } = await import("../repository/examRepository");
    const rows = await createClassExamGroup(repo, {
      ...input,
      subjects,
    });
    const groupId = rows[0]?.examGroupId ?? rows[0]?.id;
    await emitEvent(repo, {
      eventType: "examination.scheduled",
      entityType: "examination",
      entityId: groupId ?? rows[0]?.id ?? "",
      classId: input.classId,
      payload: {
        name: input.name,
        title: input.name,
        examGroupId: groupId,
        subjectCount: rows.length,
      },
    }).catch(() => undefined);
    afterMarksWrite(ctx, { classId: input.classId, source: "MarksService.createClassExam" });
    return rows;
  },

  /** Group subject exams for a class (one card per exam name/group). */
  async listExamGroupsForClass(ctx: ServiceContext, classId: string) {
    assertCanConsume(ctx, "examination");
    const exams = await listExamsForClass(toRepoContext(ctx), classId, { limit: 200 });
    const groups = new Map<
      string,
      {
        examGroupId: string;
        name: string;
        startDate: string | null;
        endDate: string | null;
        instructions: string | null;
        marksLocked: boolean;
        resultsPublishedAt: string | null;
        subjects: ExamRecord[];
      }
    >();
    for (const e of exams) {
      const gid = e.examGroupId ?? e.id;
      const g = groups.get(gid) ?? {
        examGroupId: gid,
        name: e.name,
        startDate: e.startDate ?? e.examDate,
        endDate: e.endDate ?? e.examDate,
        instructions: e.instructions,
        marksLocked: e.marksLocked,
        resultsPublishedAt: e.resultsPublishedAt,
        subjects: [] as ExamRecord[],
      };
      g.subjects.push(e);
      g.marksLocked = g.marksLocked && e.marksLocked;
      if (!e.resultsPublishedAt) g.resultsPublishedAt = null;
      groups.set(gid, g);
    }
    return [...groups.values()].sort((a, b) =>
      String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")),
    );
  },

  /** Subject exams this teacher should enter marks for (pending unlock). */
  async listMyPendingSubjectExams(ctx: ServiceContext, classId: string): Promise<ExamRecord[]> {
    assertCanConsume(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exams = await listExamsForClass(repo, classId, { limit: 200 });
    if (isSchoolOperator(ctx.role)) {
      return exams.filter((e) => !e.marksLocked && !e.resultsPublishedAt);
    }
    const out: ExamRecord[] = [];
    for (const e of exams) {
      if (e.marksLocked || e.resultsPublishedAt) continue;
      const ok = await teacherAssignedToClassSubject(repo, {
        teacherUserId: ctx.userId,
        classId: e.classId,
        subject: e.subject,
        subjectId: e.subjectId,
      });
      if (ok) out.push(e);
    }
    return out;
  },

  /** Lock marks — class teacher; locks whole exam group when grouped. */
  async finalizeMarks(ctx: ServiceContext, examId: string): Promise<ExamRecord> {
    assertCanOwn(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exam = await getExam(repo, examId);
    const { isClassTeacherOfClass } = await import("../repository/teacherClassesRepository");
    if (!isSchoolOperator(ctx.role)) {
      const ok = await isClassTeacherOfClass(repo, ctx.userId, exam.classId);
      if (!ok) throw new ForbiddenError("Only the class teacher can finalize this exam");
    }

    if (exam.examGroupId) {
      const { setExamGroupLocked } = await import("../repository/examRepository");
      await setExamGroupLocked(repo, exam.examGroupId, true);
    } else {
      const { error } = await getClient(repo)
        .from("exams")
        .update({
          marks_locked: true,
          updated_at: new Date().toISOString(),
        } as never)
        .eq("id", examId)
        .eq("school_id", schoolIdOf(repo));
      throwIfError(error, "Failed to finalize marks");
    }

    await emitEvent(repo, {
      eventType: "examination.finalized",
      entityType: "examination",
      entityId: exam.examGroupId ?? examId,
      classId: exam.classId,
      payload: {
        name: exam.name,
        examGroupId: exam.examGroupId,
        examType: exam.examType,
      },
    }).catch(() => undefined);

    afterMarksWrite(ctx, { classId: exam.classId, source: "MarksService.finalizeMarks" });
    return getExam(repo, examId);
  },
  async publishResults(ctx: ServiceContext, examId: string): Promise<ExamRecord> {
    assertCanOwn(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exam = await getExam(repo, examId);
    const { isClassTeacherOfClass } = await import("../repository/teacherClassesRepository");
    if (!isSchoolOperator(ctx.role)) {
      const ok = await isClassTeacherOfClass(repo, ctx.userId, exam.classId);
      if (!ok) throw new ForbiddenError("Only the class teacher can publish results");
    }

    // Reload group lock status
    let locked = exam.marksLocked;
    if (exam.examGroupId) {
      const { listExamsByGroup } = await import("../repository/examRepository");
      const siblings = await listExamsByGroup(repo, exam.examGroupId);
      locked = siblings.every((s) => s.marksLocked);
    }
    if (!locked) {
      throw new ValidationFailedError([
        {
          field: "examId",
          code: "not_finalized",
          message: "Finalize marks before publishing results",
        },
      ]);
    }

    const now = new Date().toISOString();
    if (exam.examGroupId) {
      const { setExamGroupResultsPublished } = await import("../repository/examRepository");
      await setExamGroupResultsPublished(repo, exam.examGroupId, now);
    } else {
      const { error } = await getClient(repo)
        .from("exams")
        .update({
          results_published_at: now,
          updated_at: now,
        } as never)
        .eq("id", examId)
        .eq("school_id", schoolIdOf(repo));
      throwIfError(error, "Failed to publish exam results");
    }

    await emitEvent(repo, {
      eventType: "marks.results_published",
      entityType: "examination",
      entityId: exam.examGroupId ?? examId,
      classId: exam.classId,
      payload: { classId: exam.classId, name: exam.name, examGroupId: exam.examGroupId },
    }).catch(() => undefined);

    afterMarksWrite(ctx, { classId: exam.classId, source: "MarksService.publishResults" });
    return getExam(repo, examId);
  },
};
