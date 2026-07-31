import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
} from "./base";
import { NotFoundError, ValidationFailedError } from "./errors";
import type { ExamRecord } from "./marksRepository";

type ExamRow = {
  id: string;
  school_id?: string | null;
  class_id: string;
  name: string;
  subject: string;
  subject_id?: string | null;
  max_marks: number;
  exam_date: string | null;
  exam_type?: string | null;
  status?: string | null;
  created_by?: string | null;
  marks_locked?: boolean | null;
  results_published_at?: string | null;
  passing_marks?: number | null;
  duration_minutes?: number | null;
  chapters?: unknown;
  topics?: unknown;
  instructions?: string | null;
};

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.map(String);
  return [];
}

function mapExam(row: ExamRow): ExamRecord {
  return {
    id: row.id,
    schoolId: row.school_id ?? "",
    classId: row.class_id,
    name: row.name,
    subject: row.subject,
    subjectId: row.subject_id ?? null,
    maxMarks: Number(row.max_marks),
    examDate: row.exam_date,
    status: row.status ?? null,
    examType: String(row.exam_type ?? "class_test"),
    marksLocked: Boolean(row.marks_locked),
    resultsPublishedAt: row.results_published_at
      ? String(row.results_published_at)
      : null,
    passingMarks: row.passing_marks != null ? Number(row.passing_marks) : null,
    durationMinutes: row.duration_minutes != null ? Number(row.duration_minutes) : null,
    chapters: asStringArray(row.chapters),
    topics: asStringArray(row.topics),
    instructions: row.instructions != null ? String(row.instructions) : null,
  };
}

export interface UpsertExamInput {
  id?: string;
  classId: string;
  name: string;
  subject: string;
  subjectId?: string | null;
  maxMarks: number;
  examDate?: string | null;
  examType?: string;
  status?: string;
  passingMarks?: number | null;
  durationMinutes?: number | null;
  chapters?: string[];
  topics?: string[];
  instructions?: string | null;
  marksLocked?: boolean;
  resultsPublishedAt?: string | null;
}

export async function upsertExam(ctx: RepoContext, input: UpsertExamInput): Promise<ExamRecord> {
  const schoolId = schoolIdOf(ctx);
  if (!input.name.trim()) {
    throw new ValidationFailedError([
      { field: "name", code: "required", message: "Exam name is required" },
    ]);
  }
  if (!(input.maxMarks > 0)) {
    throw new ValidationFailedError([
      { field: "maxMarks", code: "invalid", message: "Max marks must be greater than 0" },
    ]);
  }

  // Allow new exam_type strings; cast as any when DB enum is strict.
  const examType = (input.examType ?? "class_test") as any;

  const payload: Record<string, unknown> = {
    school_id: schoolId,
    class_id: input.classId,
    name: input.name.trim(),
    subject: input.subject,
    subject_id: input.subjectId ?? null,
    max_marks: input.maxMarks,
    exam_date: input.examDate ?? null,
    exam_type: examType,
    status: input.status ?? "scheduled",
    created_by: ctx.userId ?? null,
  };
  if (input.passingMarks !== undefined) payload.passing_marks = input.passingMarks;
  if (input.durationMinutes !== undefined) payload.duration_minutes = input.durationMinutes;
  if (input.chapters !== undefined) payload.chapters = input.chapters;
  if (input.topics !== undefined) payload.topics = input.topics;
  if (input.instructions !== undefined) payload.instructions = input.instructions;
  if (input.marksLocked !== undefined) payload.marks_locked = input.marksLocked;
  if (input.resultsPublishedAt !== undefined) {
    payload.results_published_at = input.resultsPublishedAt;
  }

  if (input.id) {
    const { data, error } = await getClient(ctx)
      .from("exams")
      .update(payload as never)
      .eq("id", input.id)
      .eq("school_id", schoolId)
      .select("*")
      .single();
    throwIfError(error, "Failed to update exam");
    return mapExam(data as ExamRow);
  }

  const { data, error } = await getClient(ctx)
    .from("exams")
    .insert(payload as never)
    .select("*")
    .single();
  throwIfError(error, "Failed to create exam");
  return mapExam(data as ExamRow);
}

export async function deleteExam(ctx: RepoContext, examId: string): Promise<void> {
  const schoolId = schoolIdOf(ctx);
  const { data: existing, error: findErr } = await getClient(ctx)
    .from("exams")
    .select("id")
    .eq("id", examId)
    .eq("school_id", schoolId)
    .maybeSingle();
  throwIfError(findErr, "Failed to find exam");
  if (!existing) throw new NotFoundError("examination", examId);

  await getClient(ctx).from("marks").delete().eq("exam_id", examId);
  const { error } = await getClient(ctx)
    .from("exams")
    .delete()
    .eq("id", examId)
    .eq("school_id", schoolId);
  throwIfError(error, "Failed to delete exam");
}

export async function publishMarksBatch(
  ctx: RepoContext,
  examId: string,
  rows: { studentId: string; marksObtained: number; remarks?: string | null }[],
  teacherAssignedToSubject: boolean,
): Promise<number> {
  const { getExam, publishMarks } = await import("./marksRepository");
  const exam = await getExam(ctx, examId);
  if (exam.marksLocked) {
    throw new ValidationFailedError([
      {
        field: "examId",
        code: "locked",
        message: "Marks are locked for this exam and cannot be edited",
      },
    ]);
  }
  let n = 0;
  for (const row of rows) {
    await publishMarks(ctx, {
      examId,
      studentId: row.studentId,
      marksObtained: row.marksObtained,
      remarks: row.remarks,
      teacherAssignedToSubject,
    });
    n += 1;
  }
  return n;
}
