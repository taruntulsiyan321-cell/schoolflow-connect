import { validateRemarkBody } from "../validation/rules";
import type { TeacherRemark } from "../types";
import { ValidationFailedError, TenantViolationError } from "./errors";
import {
  getClient,
  schoolIdOf,
  throwIfError,
  type RepoContext,
  type PageParams,
  normalizePage,
} from "./base";

type RemarkRow = {
  id: string;
  school_id: string;
  student_id: string;
  teacher_id: string;
  class_id: string | null;
  subject_id: string | null;
  academic_year_id: string | null;
  remark_type: string;
  body: string;
  visibility: string;
  created_by: string | null;
  created_at: string;
};

function mapRemark(row: RemarkRow): TeacherRemark {
  return {
    id: row.id,
    schoolId: row.school_id,
    studentId: row.student_id,
    teacherId: row.teacher_id,
    classId: row.class_id,
    subjectId: row.subject_id,
    academicYearId: row.academic_year_id,
    remarkType: row.remark_type,
    body: row.body,
    visibility: row.visibility,
    createdBy: row.created_by,
    createdAt: row.created_at,
  };
}

export async function listRemarksForStudent(
  ctx: RepoContext,
  studentId: string,
  page?: PageParams,
): Promise<TeacherRemark[]> {
  const schoolId = schoolIdOf(ctx);
  const { limit, offset } = normalizePage(page);

  const { data, error } = await getClient(ctx)
    .from("teacher_remarks")
    .select("*")
    .eq("school_id", schoolId)
    .eq("student_id", studentId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  throwIfError(error, "Failed to list remarks");
  return (data ?? []).map((r) => mapRemark(r as RemarkRow));
}

export interface CreateRemarkInput {
  studentId: string;
  teacherId: string;
  classId?: string | null;
  subjectId?: string | null;
  academicYearId?: string | null;
  remarkType?: string;
  body: string;
  visibility?: string;
}

export async function createTeacherRemark(
  ctx: RepoContext,
  input: CreateRemarkInput,
): Promise<TeacherRemark> {
  const schoolId = schoolIdOf(ctx);
  const bodyCheck = validateRemarkBody(input.body);
  if (!bodyCheck.ok) throw new ValidationFailedError((bodyCheck as { ok: false; issues: unknown[] }).issues as never);

  const { data: student, error: sErr } = await getClient(ctx)
    .from("students")
    .select("id, school_id, class_id")
    .eq("id", input.studentId)
    .maybeSingle();

  throwIfError(sErr, "Failed to verify student");
  if (!student || student.school_id !== schoolId) {
    throw new TenantViolationError("Student is outside the current school");
  }

  const { data, error } = await getClient(ctx)
    .from("teacher_remarks")
    .insert({
      school_id: schoolId,
      student_id: input.studentId,
      teacher_id: input.teacherId,
      class_id: input.classId ?? student.class_id,
      subject_id: input.subjectId ?? null,
      academic_year_id: input.academicYearId ?? null,
      remark_type: input.remarkType ?? "general",
      body: input.body.trim(),
      visibility: input.visibility ?? "parent_student",
      created_by: ctx.userId ?? null,
    } as never)
    .select("*")
    .single();

  throwIfError(error, "Failed to create remark");
  return mapRemark(data as RemarkRow);
}
