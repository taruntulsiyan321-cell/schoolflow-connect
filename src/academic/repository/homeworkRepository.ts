import { ValidationFailedError, NotFoundError } from "./errors";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

export interface HomeworkRecord {
  id: string;
  schoolId: string;
  classId: string;
  subject: string;
  subjectId: string | null;
  title: string;
  description: string;
  dueDate: string | null;
  status: string | null;
  createdBy: string | null;
}

export interface HomeworkSubmissionRecord {
  id: string;
  schoolId: string;
  homeworkId: string;
  studentId: string;
  content: string;
  status: string;
  grade: string | null;
  teacherRemarks: string | null;
  submittedAt: string | null;
  gradedAt: string | null;
}

type HomeworkRow = {
  id: string;
  school_id?: string | null;
  class_id: string;
  subject: string;
  subject_id?: string | null;
  title: string;
  description: string;
  due_date: string | null;
  status?: string | null;
  created_by: string | null;
};

type SubmissionRow = {
  id: string;
  school_id?: string | null;
  homework_id: string;
  student_id: string;
  content: string;
  status: string;
  grade: string | null;
  teacher_remarks: string | null;
  submitted_at: string | null;
  graded_at: string | null;
};

function mapHomework(row: HomeworkRow): HomeworkRecord {
  return {
    id: row.id,
    schoolId: row.school_id ?? "",
    classId: row.class_id,
    subject: row.subject,
    subjectId: row.subject_id ?? null,
    title: row.title,
    description: row.description,
    dueDate: row.due_date,
    status: row.status ?? null,
    createdBy: row.created_by,
  };
}

function mapSubmission(row: SubmissionRow): HomeworkSubmissionRecord {
  return {
    id: row.id,
    schoolId: row.school_id ?? "",
    homeworkId: row.homework_id,
    studentId: row.student_id,
    content: row.content,
    status: row.status,
    grade: row.grade,
    teacherRemarks: row.teacher_remarks,
    submittedAt: row.submitted_at,
    gradedAt: row.graded_at,
  };
}

export async function getHomework(ctx: RepoContext, homeworkId: string): Promise<HomeworkRecord> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("homework")
    .select("*")
    .eq("id", homeworkId)
    .eq("school_id", schoolId)
    .maybeSingle();

  throwIfError(error, "Failed to load homework");
  if (!data) throw new NotFoundError("homework", homeworkId);
  return mapHomework(data as HomeworkRow);
}

export async function listHomeworkForClass(
  ctx: RepoContext,
  classId: string,
  page?: PageParams,
): Promise<HomeworkRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("homework")
    .select("*")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to list homework");
  return (data ?? []).map((r) => mapHomework(r as HomeworkRow));
}

export interface CreateHomeworkInput {
  classId: string;
  subject: string;
  subjectId?: string | null;
  title: string;
  description?: string;
  dueDate?: string | null;
  status?: string;
}

export async function createHomework(
  ctx: RepoContext,
  input: CreateHomeworkInput,
): Promise<HomeworkRecord> {
  const schoolId = schoolIdOf(ctx);
  if (!input.title.trim()) {
    throw new ValidationFailedError([
      { field: "title", code: "required", message: "Homework title is required" },
    ]);
  }

  const { data, error } = await getClient(ctx)
    .from("homework")
    .insert({
      school_id: schoolId,
      class_id: input.classId,
      subject: input.subject,
      subject_id: input.subjectId ?? null,
      title: input.title.trim(),
      description: input.description ?? "",
      due_date: input.dueDate ?? null,
      status: input.status ?? "active",
      created_by: ctx.userId ?? null,
    } as never)
    .select("*")
    .single();

  throwIfError(error, "Failed to create homework");
  return mapHomework(data as HomeworkRow);
}

export async function listSubmissionsForHomework(
  ctx: RepoContext,
  homeworkId: string,
): Promise<HomeworkSubmissionRecord[]> {
  await getHomework(ctx, homeworkId);
  const { data, error } = await getClient(ctx)
    .from("homework_submissions")
    .select("*")
    .eq("homework_id", homeworkId);

  throwIfError(error, "Failed to list submissions");
  return (data ?? []).map((r) => mapSubmission(r as SubmissionRow));
}

export async function upsertHomeworkSubmission(
  ctx: RepoContext,
  input: { homeworkId: string; studentId: string; content: string },
): Promise<HomeworkSubmissionRecord> {
  const schoolId = schoolIdOf(ctx);
  await getHomework(ctx, input.homeworkId);

  const { data, error } = await getClient(ctx)
    .from("homework_submissions")
    .upsert(
      {
        homework_id: input.homeworkId,
        student_id: input.studentId,
        content: input.content,
        status: "submitted",
        submitted_at: new Date().toISOString(),
        school_id: schoolId,
      } as never,
      { onConflict: "homework_id,student_id" },
    )
    .select("*")
    .single();

  throwIfError(error, "Failed to submit homework");
  return mapSubmission(data as SubmissionRow);
}

export async function deleteHomework(ctx: RepoContext, homeworkId: string): Promise<void> {
  const schoolId = schoolIdOf(ctx);
  await getHomework(ctx, homeworkId);
  const { error } = await getClient(ctx)
    .from("homework")
    .delete()
    .eq("id", homeworkId)
    .eq("school_id", schoolId);
  throwIfError(error, "Failed to delete homework");
}

export async function gradeHomeworkSubmission(
  ctx: RepoContext,
  input: { submissionId: string; grade: string; remarks?: string | null },
): Promise<HomeworkSubmissionRecord> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("homework_submissions")
    .update({
      grade: input.grade,
      teacher_remarks: input.remarks ?? null,
      status: "graded",
      graded_at: new Date().toISOString(),
      school_id: schoolId,
    } as never)
    .eq("id", input.submissionId)
    .select("*")
    .single();

  throwIfError(error, "Failed to grade homework");
  const submission = mapSubmission(data as SubmissionRow);

  // Emit graded event for sync fan-out
  const { emitEvent } = await import("./eventsRepository");
  await emitEvent(ctx, {
    eventType: "homework.submission.graded",
    entityType: "homework_submission",
    entityId: submission.id,
    studentId: submission.studentId,
    payload: { grade: input.grade, homeworkId: submission.homeworkId },
  }).catch(() => undefined);

  return submission;
}
