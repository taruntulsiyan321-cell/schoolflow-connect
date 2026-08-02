import type { ServiceContext } from "./context";
import { MissingSchoolContextError } from "../tenant";

export type StudentContextReadiness = {
  ready: boolean;
  userId: string | null;
  studentId: string | null;
  schoolId: string | null;
  classId: string | null;
  reason: string | null;
};

export function assertStudentContext(
  ctx: ServiceContext | null | undefined,
): asserts ctx is ServiceContext {
  if (!ctx) throw new Error("Student academic context is not ready");
  if (!ctx.userId) throw new Error("Sign in required");
  if (ctx.role !== "student") throw new Error("Student role required for this action");
  if (!ctx.schoolId) {
    throw new MissingSchoolContextError(
      "Student school is not bound. Sign in again or contact your school admin.",
    );
  }
}

export function evaluateStudentContext(
  ctx: ServiceContext | null | undefined,
  opts?: { requireStudentRow?: boolean; requireClass?: boolean },
): StudentContextReadiness {
  if (!ctx?.userId) {
    return {
      ready: false,
      userId: null,
      studentId: null,
      schoolId: null,
      classId: null,
      reason: "Sign in required",
    };
  }
  if (ctx.role !== "student") {
    return {
      ready: false,
      userId: ctx.userId,
      studentId: ctx.studentId ?? null,
      schoolId: ctx.schoolId ?? null,
      classId: ctx.classId ?? null,
      reason: "Student role required",
    };
  }
  if (!ctx.schoolId) {
    return {
      ready: false,
      userId: ctx.userId,
      studentId: ctx.studentId ?? null,
      schoolId: null,
      classId: ctx.classId ?? null,
      reason: "School not bound",
    };
  }
  if (opts?.requireStudentRow && !ctx.studentId) {
    return {
      ready: false,
      userId: ctx.userId,
      studentId: null,
      schoolId: ctx.schoolId,
      classId: ctx.classId ?? null,
      reason: "Student profile not linked",
    };
  }
  if (opts?.requireClass && !ctx.classId) {
    return {
      ready: false,
      userId: ctx.userId,
      studentId: ctx.studentId ?? null,
      schoolId: ctx.schoolId,
      classId: null,
      reason: "Couldn't determine your class",
    };
  }
  return {
    ready: true,
    userId: ctx.userId,
    studentId: ctx.studentId ?? null,
    schoolId: ctx.schoolId,
    classId: ctx.classId ?? null,
    reason: null,
  };
}

export function studentShellReady(input: {
  academicReady: boolean;
  progressionLoaded: boolean;
}): boolean {
  return input.academicReady && input.progressionLoaded;
}
