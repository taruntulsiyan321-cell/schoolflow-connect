/**
 * Shared academic work lifecycle helpers.
 * Used by HomeworkService / TestService / MarksService — not a product service.
 */
import {
  ForbiddenError,
  isSchoolOperator,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";
import { teacherAssignedToClassSubject } from "../repository/teacherAssignmentRepository";

export type WorkKind =
  | "homework"
  | "assignment"
  | "worksheet"
  | "project"
  | "internal_assessment";

export type TestKind = "class_test" | "unit_test" | "surprise_test" | "monthly_test";

export type ExamType =
  | "class_test"
  | "unit_test"
  | "monthly_test"
  | "mid_term"
  | "half_yearly"
  | "annual"
  | "practical"
  | "viva"
  | "internal"
  | "other"
  | "final"; // legacy

export const WORK_KINDS: WorkKind[] = [
  "homework",
  "assignment",
  "worksheet",
  "project",
  "internal_assessment",
];

export const WORK_KIND_LABELS: Record<WorkKind, string> = {
  homework: "Homework",
  assignment: "Assignment",
  worksheet: "Worksheet",
  project: "Project",
  internal_assessment: "Internal Assessment",
};

export const TEST_KIND_LABELS: Record<TestKind, string> = {
  class_test: "Class Test",
  unit_test: "Unit Test",
  surprise_test: "Surprise Test",
  monthly_test: "Monthly Test",
};

export const EXAM_TYPE_LABELS: Record<string, string> = {
  class_test: "Class Test",
  unit_test: "Unit Exam",
  monthly_test: "Monthly Exam",
  mid_term: "Mid-Term",
  half_yearly: "Half-Yearly",
  annual: "Annual",
  practical: "Practical",
  viva: "Viva",
  internal: "Internal Assessment",
  other: "Other",
  final: "Annual",
};

/** Teacher may manage academic work for an assigned class (and optional subject). */
export async function assertTeacherMayManageAcademicWork(
  ctx: ServiceContext,
  classId: string,
  subject?: string | null,
): Promise<void> {
  if (isSchoolOperator(ctx.role)) return;
  if (ctx.role !== "teacher") {
    throw new ForbiddenError("Only teachers may manage academic work for a class");
  }
  await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
  const subj = subject?.trim();
  if (subj && subj.toLowerCase() !== "general") {
    const ok = await teacherAssignedToClassSubject(toRepoContext(ctx), {
      teacherUserId: ctx.userId,
      classId,
      subject: subj,
    });
    if (!ok) {
      throw new ForbiddenError(
        "Teachers may only manage work for subjects assigned to their class",
      );
    }
  }
}

export function isPastDue(dueDate: string | null | undefined, dueTime?: string | null): boolean {
  if (!dueDate) return false;
  return new Date().getTime() > new Date(`${dueDate}T${dueTime ?? "23:59:59"}`).getTime();
}

export function normalizeWorkKind(v: string | null | undefined): WorkKind {
  if (v && (WORK_KINDS as string[]).includes(v)) return v as WorkKind;
  return "homework";
}
