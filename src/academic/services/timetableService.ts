import {
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./context";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import { assertMayAccessStudent } from "./parentAccess";

export type ClassTimetableSnapshot = {
  classId: string;
  classLabel: string;
  grid: Record<string, string>;
  hasData: boolean;
};

function normalizeGrid(grid: unknown): Record<string, string> {
  if (!grid || typeof grid !== "object" || Array.isArray(grid)) return {};
  return Object.fromEntries(
    Object.entries(grid as Record<string, unknown>).map(([key, value]) => [key, String(value ?? "")]),
  );
}

async function resolveStudentClassId(
  ctx: ServiceContext,
  classId?: string | null,
): Promise<{ classId: string; studentId: string | null } | null> {
  const repo = toRepoContext(ctx);
  const schoolId = schoolIdOf(repo);
  const client = getClient(repo);

  if (ctx.role === "student") {
    const { data: me, error } = await client
      .from("students")
      .select("id, class_id")
      .eq("user_id", ctx.userId)
      .eq("school_id", schoolId)
      .maybeSingle();
    throwIfError(error, "Failed to resolve student class");
    if (!me?.class_id) return null;
    if (classId && classId !== me.class_id) {
      throw new ForbiddenError("Students may only view their own class timetable");
    }
    return { classId: me.class_id, studentId: me.id };
  }

  if (!classId) {
    throw new ForbiddenError("classId is required");
  }

  if (ctx.role === "parent") {
    if (!ctx.studentId) {
      throw new ForbiddenError("Parent must select a linked child");
    }
    await assertMayAccessStudent(ctx, ctx.studentId);
    const { data: child, error } = await client
      .from("students")
      .select("id, class_id")
      .eq("id", ctx.studentId)
      .eq("school_id", schoolId)
      .maybeSingle();
    throwIfError(error, "Failed to resolve child class");
    if (!child?.class_id || child.class_id !== classId) {
      throw new ForbiddenError("Parents may only view their child's class timetable");
    }
    return { classId, studentId: child.id };
  }

  if (ctx.role === "teacher") {
    const { assertTeacherOwnsClass } = await import("../repository/teacherClassesRepository");
    await assertTeacherOwnsClass(repo, ctx.userId, classId);
  } else if (!isSchoolOperator(ctx.role)) {
    throw new ForbiddenError("Not authorized to read class timetable");
  }

  return { classId, studentId: null };
}

/**
 * TimetableService — read-only class schedule from `class_timetables`.
 * Panels must not query the table directly.
 */
export const TimetableService = {
  async forClass(
    ctx: ServiceContext,
    classId?: string | null,
  ): Promise<ClassTimetableSnapshot | null> {
    assertCanConsume(ctx, "class");

    const resolved = await resolveStudentClassId(ctx, classId);
    if (!resolved) return null;

    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);

    const { data: cls, error: classErr } = await client
      .from("classes")
      .select("id, name, section")
      .eq("id", resolved.classId)
      .eq("school_id", schoolId)
      .maybeSingle();
    throwIfError(classErr, "Failed to load class");
    if (!cls) return null;

    const { data: tt, error: ttErr } = await client
      .from("class_timetables")
      .select("grid")
      .eq("class_id", resolved.classId)
      .maybeSingle();
    throwIfError(ttErr, "Failed to load timetable");

    const grid = normalizeGrid(tt?.grid);
    const hasData = Object.values(grid).some((v) => v.trim() !== "");
    const classLabel = cls.section ? `${cls.name} — Section ${cls.section}` : cls.name;

    return {
      classId: resolved.classId,
      classLabel,
      grid,
      hasData,
    };
  },
};
