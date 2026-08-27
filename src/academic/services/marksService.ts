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
import type {
  ExamSittingRecord,
  ExamSubjectRecord,
} from "../repository/examRepository";
import { teacherAssignedToClassSubject } from "../repository/teacherAssignmentRepository";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import type { PageParams } from "../repository/base";
import { ForbiddenError, isSchoolOperator } from "./context";
import { assertMayAccessStudent } from "./parentAccess";
import { emitEvent, emitEventBestEffort } from "../repository/eventsRepository";
import { assertTeacherMayManageAcademicWork } from "./workLifecycle";
import { ValidationFailedError } from "../repository/errors";
import { broadcastAcademicWrite } from "../live";

/**
 * Which subject of a sitting an operation is about. Named explicitly, or the
 * only one when the sitting covers exactly one subject. A sitting covering
 * several refuses rather than picking the first — which is how the fan-out
 * used to behave, and why finalising "the group" once meant finalising
 * whatever row happened to sort first.
 */
async function resolveSittingSubject(
  repo: ReturnType<typeof toRepoContext>,
  examId: string,
  examSubjectId?: string | null,
): Promise<ExamSubjectRecord> {
  const { listExamSubjects } = await import("../repository/examRepository");
  const subjects = await listExamSubjects(repo, examId);
  if (examSubjectId) {
    const found = subjects.find((s) => s.examSubjectId === examSubjectId);
    if (found) return found;
    throw new ValidationFailedError([
      {
        field: "examSubjectId",
        code: "not_in_exam",
        message: "That subject does not belong to this exam",
      },
    ]);
  }
  if (subjects.length === 1) return subjects[0];
  throw new ValidationFailedError([
    {
      field: "examSubjectId",
      code: subjects.length === 0 ? "exam_has_no_subjects" : "ambiguous",
      message:
        subjects.length === 0
          ? "This exam has no subjects scheduled, so marks cannot be recorded against it"
          : "This exam covers several subjects — say which subject the marks are for",
    },
  ]);
}

/** One subject of one sitting, awaiting marks. Marks are written at this grain. */
export interface PendingSubjectExam {
  exam: ExamRecord;
  subject: ExamSubjectRecord;
}

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
  /**
   * School-wide sittings for the admin monitor. One row per sitting, with the
   * subjects it covers read from exam_subjects — the admin screen used to
   * derive its rows by grouping exams client-side, which is the grouping this
   * chunk moved into the schema.
   */
  async listExamSittingsForSchool(
    ctx: ServiceContext,
    page?: PageParams,
  ): Promise<{ exam: ExamRecord; subjects: ExamSubjectRecord[] }[]> {
    assertCanConsume(ctx, "examination");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only school operators may list school-wide exams");
    }
    const repo = toRepoContext(ctx);
    const exams = await listExamsForSchool(repo, page);
    const { listExamSubjectsForExams } = await import("../repository/examRepository");
    const byExam = await listExamSubjectsForExams(
      repo,
      exams.map((e) => e.id),
    );
    return exams.map((exam) => ({ exam, subjects: byExam.get(exam.id) ?? [] }));
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
        } catch (e) {
          // G10: this catch swallowed BOTH classes of throw.
          // assertMayAccessStudent throws ForbiddenError for "not your
          // student" -- the filter this loop wants -- but it ALSO throws when
          // the identity lookup itself fails ("Failed to resolve student
          // identity"). Treating those alike meant a transient DB error
          // silently DROPPED a mark row, and the student saw a shorter list
          // that looked complete. Exclude the forbidden; surface the rest.
          if (!(e instanceof ForbiddenError)) throw e;
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
    const subject = await resolveSittingSubject(
      toRepoContext(ctx),
      input.examId,
      input.examSubjectId,
    );
    let assigned = isSchoolOperator(ctx.role);
    if (!assigned) {
      assigned = await teacherAssignedToClassSubject(toRepoContext(ctx), {
        teacherUserId: ctx.userId,
        classId: exam.classId,
        subject: subject.subject,
        subjectId: null,
      });
    }
    if (!assigned) {
      throw new ForbiddenError("You can only enter marks for your assigned subject");
    }

    return publishMarks(toRepoContext(ctx), {
      ...input,
      examSubjectId: subject.examSubjectId,
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
    examSubjectId?: string | null,
  ): Promise<number> {
    assertCanOwn(ctx, "marks");
    const repo = toRepoContext(ctx);
    const exam = await getExam(repo, examId);
    // Which subject of the sitting these marks are for. The subject is read
    // from exam_subjects, not from the sitting's legacy display label, which
    // a multi-subject sitting does not have.
    const subject = await resolveSittingSubject(repo, examId, examSubjectId);

    let assigned = isSchoolOperator(ctx.role);
    if (!assigned) {
      assigned = await teacherAssignedToClassSubject(repo, {
        teacherUserId: ctx.userId,
        classId: exam.classId,
        subject: subject.subject,
        subjectId: null,
      });
    }
    if (!assigned) {
      throw new ForbiddenError("You can only enter marks for your assigned subject");
    }
    const { publishMarksBatch } = await import("../repository/examRepository");
    const count = await publishMarksBatch(repo, examId, rows, true, subject.examSubjectId);
    afterMarksWrite(ctx, { classId: exam.classId, source: "MarksService.publishBatch" });
    return count;
  },
  /**
   * The class teacher creates one SITTING for the class (§10.22): one exam
   * covering the subjects its own section teaches, with one max mark across
   * them and a subject-wise timetable held in exam_subjects.
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
      passingMarks?: number | null;
    },
  ): Promise<ExamSittingRecord> {
    assertCanOwn(ctx, "examination");
    const repo = toRepoContext(ctx);
    const { isClassTeacherOfClass } = await import("../repository/teacherClassesRepository");
    if (!isSchoolOperator(ctx.role)) {
      const ok = await isClassTeacherOfClass(repo, ctx.userId, input.classId);
      if (!ok) {
        throw new ForbiddenError("Only the class teacher can create exams for this class");
      }
    }
    const { createClassExam, listSectionSubjects } = await import("../repository/examRepository");
    // The section's own subjects, from section_subjects — not teacher_classes.
    // This is what makes a sitting structurally unable to name a subject the
    // section does not teach.
    const subjects = await listSectionSubjects(repo, input.classId);
    const sitting = await createClassExam(repo, { ...input, subjects });

    await emitEvent(repo, {
      eventType: "examination.scheduled",
      entityType: "examination",
      entityId: sitting.exam.id,
      classId: input.classId,
      payload: {
        name: input.name,
        title: input.name,
        examId: sitting.exam.id,
        subjectCount: sitting.subjects.length,
      },
    }).catch(() => undefined);
    afterMarksWrite(ctx, { classId: input.classId, source: "MarksService.createClassExam" });
    return sitting;
  },

  /** One card per sitting for a class, with the subjects that sitting covers. */
  async listExamSittingsForClass(ctx: ServiceContext, classId: string) {
    assertCanConsume(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exams = await listExamsForClass(repo, classId, { limit: 200 });
    const { listExamSubjectsForExams } = await import("../repository/examRepository");
    const subjectsByExam = await listExamSubjectsForExams(
      repo,
      exams.map((e) => e.id),
    );
    return exams
      .map((e) => ({
        examId: e.id,
        name: e.name,
        startDate: e.startDate ?? e.examDate,
        endDate: e.endDate ?? e.examDate,
        instructions: e.instructions,
        marksLocked: e.marksLocked,
        resultsPublishedAt: e.resultsPublishedAt,
        subjects: subjectsByExam.get(e.id) ?? [],
      }))
      .sort((a, b) => String(b.startDate ?? "").localeCompare(String(a.startDate ?? "")));
  },

  /**
   * The subjects of still-open sittings this teacher should enter marks for.
   * One entry per SUBJECT, since that is the grain marks are written at.
   */
  async listMyPendingSubjectExams(
    ctx: ServiceContext,
    classId: string,
  ): Promise<PendingSubjectExam[]> {
    assertCanConsume(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exams = await listExamsForClass(repo, classId, { limit: 200 });
    const open = exams.filter((e) => !e.marksLocked && !e.resultsPublishedAt);
    if (!open.length) return [];

    const { listExamSubjectsForExams } = await import("../repository/examRepository");
    const subjectsByExam = await listExamSubjectsForExams(
      repo,
      open.map((e) => e.id),
    );

    const out: PendingSubjectExam[] = [];
    for (const exam of open) {
      for (const subject of subjectsByExam.get(exam.id) ?? []) {
        if (!isSchoolOperator(ctx.role)) {
          const ok = await teacherAssignedToClassSubject(repo, {
            teacherUserId: ctx.userId,
            classId: exam.classId,
            subject: subject.subject,
            subjectId: null,
          });
          if (!ok) continue;
        }
        out.push({ exam, subject });
      }
    }
    return out;
  },

  /**
   * Finalise the sitting — class teacher.
   *
   * marks_locked lives on the sitting itself, so locking it closes every
   * subject that sitting covers at once: can_upload_exam_marks reaches
   * exams.marks_locked through exam_subjects. That is the behaviour
   * verification item 2 asserts, and it is now structural rather than a
   * fan-out UPDATE across sibling rows that could match nothing in silence.
   */
  async finalizeMarks(ctx: ServiceContext, examId: string): Promise<ExamRecord> {
    assertCanOwn(ctx, "examination");
    const repo = toRepoContext(ctx);
    const exam = await getExam(repo, examId);
    const { isClassTeacherOfClass } = await import("../repository/teacherClassesRepository");
    if (!isSchoolOperator(ctx.role)) {
      const ok = await isClassTeacherOfClass(repo, ctx.userId, exam.classId);
      if (!ok) throw new ForbiddenError("Only the class teacher can finalize this exam");
    }

    const { setExamLocked } = await import("../repository/examRepository");
    await setExamLocked(repo, examId, true);

    await emitEvent(repo, {
      eventType: "examination.finalized",
      entityType: "examination",
      entityId: examId,
      classId: exam.classId,
      payload: { name: exam.name, examId, examType: exam.examType },
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

    // One sitting, one lock. There are no sibling rows left to reconcile, so
    // the "are all subjects finalised?" sweep this used to run is answered by
    // the sitting's own flag.
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
    const { setExamResultsPublished } = await import("../repository/examRepository");
    await setExamResultsPublished(repo, examId, now);

    await emitEvent(repo, {
      eventType: "marks.results_published",
      entityType: "examination",
      entityId: examId,
      classId: exam.classId,
      payload: { classId: exam.classId, name: exam.name, examId },
    }).catch(() => undefined);

    afterMarksWrite(ctx, { classId: exam.classId, source: "MarksService.publishResults" });
    return getExam(repo, examId);
  },
};
