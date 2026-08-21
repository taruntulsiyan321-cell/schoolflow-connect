import { validateMarks, validateTeacherSubjectAssignment } from "../validation/rules";
import { ValidationFailedError, TenantViolationError, NotFoundError } from "./errors";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

export interface ExamRecord {
  id: string;
  schoolId: string;
  classId: string;
  name: string;
  subject: string;
  subjectId: string | null;
  maxMarks: number;
  examDate: string | null;
  status: string | null;
  examType: string;
  marksLocked: boolean;
  resultsPublishedAt: string | null;
  passingMarks: number | null;
  durationMinutes: number | null;
  chapters: string[];
  topics: string[];
  instructions: string | null;
  examGroupId: string | null;
  startDate: string | null;
  endDate: string | null;
}

export interface MarksRecord {
  id: string;
  schoolId: string;
  examId: string;
  studentId: string;
  marksObtained: number;
  remarks: string | null;
}

type ExamRow = {
  id: string;
  school_id?: string | null;
  class_id: string;
  name: string;
  subject: string;
  subject_id?: string | null;
  max_marks: number;
  exam_date: string | null;
  status?: string | null;
  exam_type?: string | null;
  marks_locked?: boolean | null;
  results_published_at?: string | null;
  passing_marks?: number | null;
  duration_minutes?: number | null;
  chapters?: unknown;
  topics?: unknown;
  instructions?: string | null;
  exam_group_id?: string | null;
  start_date?: string | null;
  end_date?: string | null;
};

type MarksRow = {
  id: string;
  school_id?: string | null;
  exam_id: string;
  student_id: string;
  marks_obtained: number;
  remarks: string | null;
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
    examGroupId: row.exam_group_id ? String(row.exam_group_id) : null,
    startDate: row.start_date ? String(row.start_date) : null,
    endDate: row.end_date ? String(row.end_date) : null,
  };
}

function mapMarks(row: MarksRow): MarksRecord {
  return {
    id: row.id,
    schoolId: row.school_id ?? "",
    examId: row.exam_id,
    studentId: row.student_id,
    marksObtained: Number(row.marks_obtained),
    remarks: row.remarks,
  };
}

export async function getExam(ctx: RepoContext, examId: string): Promise<ExamRecord> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("exams")
    .select("*")
    .eq("id", examId)
    .eq("school_id", schoolId)
    .maybeSingle();

  throwIfError(error, "Failed to load exam");
  if (!data) throw new NotFoundError("examination", examId);
  return mapExam(data as ExamRow);
}

export async function listExamsForClass(
  ctx: RepoContext,
  classId: string,
  page?: PageParams,
): Promise<ExamRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("exams")
    .select("*")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .order("exam_date", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to list exams");
  return (data ?? []).map((r) => mapExam(r as ExamRow));
}

/** School-wide exam schedules for admin/principal monitors. */
export async function listExamsForSchool(
  ctx: RepoContext,
  page?: PageParams,
): Promise<ExamRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("exams")
    .select("*")
    .eq("school_id", schoolId)
    .order("exam_date", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to list school exams");
  return (data ?? []).map((r) => mapExam(r as ExamRow));
}

/** Exams with results published — for student/parent result consumers. */
export async function listPublishedResultsForClass(
  ctx: RepoContext,
  classId: string,
  page?: PageParams,
): Promise<ExamRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("exams")
    .select("*")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .not("results_published_at", "is", null)
    .order("exam_date", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to list published exam results");
  return (data ?? []).map((r) => mapExam(r as ExamRow));
}

export async function listMarksForExam(ctx: RepoContext, examId: string): Promise<MarksRecord[]> {
  const exam = await getExam(ctx, examId);
  const { data, error } = await getClient(ctx)
    .from("marks")
    .select("*")
    .eq("exam_id", exam.id)
    .eq("school_id", schoolIdOf(ctx));

  throwIfError(error, "Failed to list marks");
  return (data ?? []).map((r) => mapMarks(r as MarksRow));
}

export async function listMarksForStudent(
  ctx: RepoContext,
  studentId: string,
  page?: PageParams,
): Promise<MarksRecord[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("marks")
    .select("*")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to list student marks");
  return (data ?? []).map((r) => mapMarks(r as MarksRow));
}

/**
 * Published-results-only exam average for a student — the number a student
 * or parent is actually entitled to see (mirrors the publish gate
 * MarksService.listForStudent already enforces for the marks list itself).
 * student_academic_profiles.exams_avg_pct is computed across ALL marks
 * (intentionally, for teacher/principal early-intervention visibility into
 * unpublished work) and must never be shown to students/parents directly.
 */
export async function getPublishedExamsAverage(
  ctx: RepoContext,
  studentId: string,
): Promise<{ count: number; averagePct: number }> {
  const schoolId = schoolIdOf(ctx);
  const marks = await listMarksForStudent(ctx, studentId, { limit: 500 });
  if (marks.length === 0) return { count: 0, averagePct: 0 };

  const examIds = [...new Set(marks.map((m) => m.examId))];
  const { data: examsRaw, error } = await getClient(ctx)
    .from("exams")
    .select("id, max_marks, results_published_at")
    .eq("school_id", schoolId)
    .in("id", examIds);
  throwIfError(error, "Failed to load exams for published-average filter");

  const examMap = new Map(
    (examsRaw ?? []).map((e) => [
      String((e as { id: string }).id),
      {
        maxMarks: Number((e as { max_marks: number }).max_marks),
        published: (e as { results_published_at: string | null }).results_published_at != null,
      },
    ]),
  );

  const pcts: number[] = [];
  for (const m of marks) {
    const exam = examMap.get(m.examId);
    if (!exam || !exam.published || !exam.maxMarks) continue;
    pcts.push((m.marksObtained / exam.maxMarks) * 100);
  }
  if (pcts.length === 0) return { count: 0, averagePct: 0 };
  return {
    count: pcts.length,
    averagePct: Math.round((pcts.reduce((a, b) => a + b, 0) / pcts.length) * 100) / 100,
  };
}

export interface PublishMarksInput {
  examId: string;
  studentId: string;
  marksObtained: number;
  remarks?: string | null;
  /** Caller must verify teaching assignment; repository enforces when false */
  teacherAssignedToSubject: boolean;
}

/**
 * Publish / update marks. Validates max marks + assignment.
 * DB trigger emits marks.published/updated + audit.
 */
export async function publishMarks(ctx: RepoContext, input: PublishMarksInput): Promise<MarksRecord> {
  const schoolId = schoolIdOf(ctx);

  const assignCheck = validateTeacherSubjectAssignment(input.teacherAssignedToSubject);
  if (!assignCheck.ok) throw new ValidationFailedError((assignCheck as { ok: false; issues: unknown[] }).issues as never);

  const exam = await getExam(ctx, input.examId);
  if (exam.marksLocked) {
    throw new ValidationFailedError([
      {
        field: "examId",
        code: "locked",
        message: "Marks are locked for this exam and cannot be edited",
      },
    ]);
  }
  const marksCheck = validateMarks(input.marksObtained, exam.maxMarks);
  if (!marksCheck.ok) throw new ValidationFailedError((marksCheck as { ok: false; issues: unknown[] }).issues as never);

  const { data: student, error: sErr } = await getClient(ctx)
    .from("students")
    .select("id, school_id, class_id")
    .eq("id", input.studentId)
    .maybeSingle();

  throwIfError(sErr, "Failed to verify student");
  if (!student || student.school_id !== schoolId) {
    throw new TenantViolationError("Student is outside the current school");
  }
  if (student.class_id !== exam.classId) {
    throw new ValidationFailedError([
      {
        field: "studentId",
        code: "class_mismatch",
        message: "Student is not in the exam class",
      },
    ]);
  }

  const { data, error } = await getClient(ctx)
    .from("marks")
    .upsert(
      {
        exam_id: input.examId,
        student_id: input.studentId,
        marks_obtained: input.marksObtained,
        remarks: input.remarks ?? null,
        school_id: schoolId,
      },
      { onConflict: "exam_id,student_id" },
    )
    .select("*")
    .single();

  throwIfError(error, "Failed to publish marks");
  return mapMarks(data as MarksRow);
}
