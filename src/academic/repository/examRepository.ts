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
  subject: string | null;
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
  start_date?: string | null;
  end_date?: string | null;
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
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
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
  examSubjectId?: string | null,
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
      examSubjectId,
      studentId: row.studentId,
      marksObtained: row.marksObtained,
      remarks: row.remarks,
      teacherAssignedToSubject,
    });
    n += 1;
  }
  return n;
}

// ---------------------------------------------------------------------
// The sitting (§10.22). One `exams` row IS the sitting; `exam_subjects`
// carries the subjects it covers and their subject-wise timetable.
//
// This replaced the exam-group column in Chunk 6.5. The fan-out it superseded
// wrote one exams row per subject, tied them together with a shared group id,
// and then locked and published them with a group-wide UPDATE keyed on that
// column — a statement that silently affects zero rows once the column is gone.
// Every write below is keyed by the sitting's own primary key instead, so the
// same failure cannot be silent again.
// ---------------------------------------------------------------------

export interface SectionSubjectRecord {
  sectionSubjectId: string;
  subject: string;
}

/**
 * The subjects this section actually teaches. An exam may cover these and
 * nothing else — which is why a sitting can no longer name a subject its own
 * section does not teach, the defect Chunk 6.5 had to repair by hand.
 */
export async function listSectionSubjects(
  ctx: RepoContext,
  sectionId: string,
): Promise<SectionSubjectRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("section_subjects")
    .select("id, curriculum_subjects(name)")
    .eq("school_id", schoolId)
    .eq("section_id", sectionId);
  throwIfError(error, "Failed to list section subjects");

  const out: SectionSubjectRecord[] = [];
  for (const row of data ?? []) {
    const joined = (row as { curriculum_subjects?: { name?: string } | { name?: string }[] })
      .curriculum_subjects;
    const name = Array.isArray(joined)
      ? String(joined[0]?.name ?? "").trim()
      : String(joined?.name ?? "").trim();
    if (!name) continue;
    out.push({ sectionSubjectId: String((row as { id: string }).id), subject: name });
  }
  return out.sort((a, b) => a.subject.localeCompare(b.subject));
}

export interface ExamSubjectRecord {
  examSubjectId: string;
  examId: string;
  sectionSubjectId: string;
  subject: string;
  scheduledAt: string | null;
}

type ExamSubjectRow = {
  id: string;
  exam_id: string;
  section_subject_id: string;
  scheduled_at: string | null;
  section_subjects?:
    | { curriculum_subjects?: { name?: string } | { name?: string }[] }
    | { curriculum_subjects?: { name?: string } | { name?: string }[] }[]
    | null;
};

function mapExamSubject(row: ExamSubjectRow): ExamSubjectRecord {
  const ss = Array.isArray(row.section_subjects) ? row.section_subjects[0] : row.section_subjects;
  const cs = Array.isArray(ss?.curriculum_subjects)
    ? ss?.curriculum_subjects[0]
    : ss?.curriculum_subjects;
  return {
    examSubjectId: String(row.id),
    examId: String(row.exam_id),
    sectionSubjectId: String(row.section_subject_id),
    subject: String(cs?.name ?? "").trim(),
    scheduledAt: row.scheduled_at ? String(row.scheduled_at) : null,
  };
}

const EXAM_SUBJECT_SELECT =
  "id, exam_id, section_subject_id, scheduled_at, section_subjects(curriculum_subjects(name))";

/** The subjects one sitting covers. Replaces listExamsByGroup. */
export async function listExamSubjects(
  ctx: RepoContext,
  examId: string,
): Promise<ExamSubjectRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("exam_subjects")
    .select(EXAM_SUBJECT_SELECT)
    .eq("school_id", schoolId)
    .eq("exam_id", examId);
  throwIfError(error, "Failed to list exam subjects");
  return (data ?? [])
    .map((r) => mapExamSubject(r as unknown as ExamSubjectRow))
    .sort((a, b) => a.subject.localeCompare(b.subject));
}

/** The subjects of several sittings at once, keyed by exam id. */
export async function listExamSubjectsForExams(
  ctx: RepoContext,
  examIds: string[],
): Promise<Map<string, ExamSubjectRecord[]>> {
  const out = new Map<string, ExamSubjectRecord[]>();
  if (!examIds.length) return out;
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("exam_subjects")
    .select(EXAM_SUBJECT_SELECT)
    .eq("school_id", schoolId)
    .in("exam_id", examIds);
  throwIfError(error, "Failed to list exam subjects");
  for (const row of data ?? []) {
    const rec = mapExamSubject(row as unknown as ExamSubjectRow);
    const list = out.get(rec.examId) ?? [];
    list.push(rec);
    out.set(rec.examId, list);
  }
  for (const list of out.values()) list.sort((a, b) => a.subject.localeCompare(b.subject));
  return out;
}

export interface CreateClassExamInput {
  classId: string;
  name: string;
  startDate: string;
  endDate?: string | null;
  instructions?: string | null;
  examType?: string;
  /** One max mark across the sitting's subjects (§10.22), not per subject. */
  defaultMaxMarks?: number;
  passingMarks?: number | null;
  subjects: SectionSubjectRecord[];
}

export interface ExamSittingRecord {
  exam: ExamRecord;
  subjects: ExamSubjectRecord[];
}

/** One sitting: one `exams` row, plus one `exam_subjects` row per subject. */
export async function createClassExam(
  ctx: RepoContext,
  input: CreateClassExamInput,
): Promise<ExamSittingRecord> {
  const schoolId = schoolIdOf(ctx);
  if (!input.name.trim()) {
    throw new ValidationFailedError([
      { field: "name", code: "required", message: "Exam name is required" },
    ]);
  }
  if (!input.startDate) {
    throw new ValidationFailedError([
      { field: "startDate", code: "required", message: "Start date is required" },
    ]);
  }
  if (!input.subjects.length) {
    throw new ValidationFailedError([
      {
        field: "subjects",
        code: "required",
        message: "No subjects mapped to this class. Ask admin to set the section's subjects.",
      },
    ]);
  }

  const examType = (input.examType ?? "unit_test") as any;
  const { data: examData, error: examErr } = await getClient(ctx)
    .from("exams")
    .insert({
      school_id: schoolId,
      class_id: input.classId,
      name: input.name.trim(),
      // Legacy display label only. exam_subjects is the authority, so a
      // multi-subject sitting deliberately carries no single subject.
      subject: input.subjects.length === 1 ? input.subjects[0].subject : null,
      subject_id: null,
      max_marks: input.defaultMaxMarks ?? 100,
      passing_marks: input.passingMarks ?? null,
      exam_date: input.startDate,
      start_date: input.startDate,
      end_date: input.endDate ?? input.startDate,
      exam_type: examType,
      status: "scheduled",
      instructions: input.instructions ?? null,
      created_by: ctx.userId ?? null,
      marks_locked: false,
    } as never)
    .select("*")
    .single();
  throwIfError(examErr, "Failed to create class exam");
  const exam = mapExam(examData as ExamRow);

  const { error: subErr } = await getClient(ctx)
    .from("exam_subjects")
    .insert(
      input.subjects.map((s) => ({
        school_id: schoolId,
        exam_id: exam.id,
        section_subject_id: s.sectionSubjectId,
        scheduled_at: input.startDate,
      })) as never,
    );
  if (subErr) {
    // A sitting with no subjects is unusable and would strand its exams row.
    await getClient(ctx).from("exams").delete().eq("id", exam.id).eq("school_id", schoolId);
    throwIfError(subErr, "Failed to schedule exam subjects");
  }

  return { exam, subjects: await listExamSubjects(ctx, exam.id) };
}

/**
 * Finalise the sitting. marks_locked lives on the sitting itself, so this
 * closes every subject it covers at once — can_upload_exam_marks reads
 * exams.marks_locked through exam_subjects. Keyed by primary key, so a miss
 * raises NotFound rather than passing silently, which is how the old
 * group-wide UPDATE failed without a sound.
 */
export async function setExamLocked(
  ctx: RepoContext,
  examId: string,
  locked: boolean,
): Promise<void> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("exams")
    .update({ marks_locked: locked, updated_at: new Date().toISOString() } as never)
    .eq("id", examId)
    .eq("school_id", schoolId)
    .select("id");
  throwIfError(error, "Failed to update exam lock");
  if (!data?.length) throw new NotFoundError("examination", examId);
}

export async function setExamResultsPublished(
  ctx: RepoContext,
  examId: string,
  at: string,
): Promise<void> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("exams")
    .update({ results_published_at: at, updated_at: at } as never)
    .eq("id", examId)
    .eq("school_id", schoolId)
    .select("id");
  throwIfError(error, "Failed to publish exam results");
  if (!data?.length) throw new NotFoundError("examination", examId);
}
