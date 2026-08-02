import type { ServiceContext } from "./context";
import { MissingSchoolContextError } from "../tenant";

export type StudentContextReadiness = {
  ready: boolean;
  userId: string | null;
  studentId: string | null;
  schoolId: string | null;
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
  opts?: { requireStudentRow?: boolean },
): StudentContextReadiness {
  if (!ctx?.userId) {
    return { ready: false, userId: null, studentId: null, schoolId: null, reason: "Sign in required" };
  }
  if (ctx.role !== "student") {
    return {
      ready: false,
      userId: ctx.userId,
      studentId: ctx.studentId ?? null,
      schoolId: ctx.schoolId ?? null,
      reason: "Student role required",
    };
  }
  if (!ctx.schoolId) {
    return {
      ready: false,
      userId: ctx.userId,
      studentId: ctx.studentId ?? null,
      schoolId: null,
      reason: "School not bound",
    };
  }
  if (opts?.requireStudentRow && !ctx.studentId) {
    return {
      ready: false,
      userId: ctx.userId,
      studentId: null,
      schoolId: ctx.schoolId,
      reason: "Student profile not linked",
    };
  }
  return {
    ready: true,
    userId: ctx.userId,
    studentId: ctx.studentId ?? null,
    schoolId: ctx.schoolId,
    reason: null,
  };
}

export function studentShellReady(input: {
  academicReady: boolean;
  progressionLoaded: boolean;
}): boolean {
  return input.academicReady && input.progressionLoaded;
}
