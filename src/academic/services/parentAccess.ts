import { ForbiddenError, isSchoolOperator, toRepoContext, type ServiceContext } from "./context";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import { assertTeacherOwnsClass } from "../repository/teacherClassesRepository";

/** Verify parent may access a student via parent_user_id or parents→parent_students. */
export async function assertParentOwnsStudent(
  ctx: ServiceContext,
  studentId: string,
): Promise<void> {
  const repo = toRepoContext(ctx);
  const schoolId = schoolIdOf(repo);
  const client = getClient(repo);

  const { data: byParentUser, error: e1 } = await client
    .from("students")
    .select("id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .eq("parent_user_id", ctx.userId)
    .maybeSingle();
  throwIfError(e1, "Failed to verify parent link");
  if (byParentUser) return;

  const { data: parentRow, error: pErr } = await client
    .from("parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("user_id", ctx.userId)
    .maybeSingle();
  throwIfError(pErr, "Failed to resolve parent row");
  if (!parentRow?.id) {
    throw new ForbiddenError("Parents may only view their linked children");
  }

  const { data: link, error: e2 } = await client
    .from("parent_students")
    .select("id")
    .eq("student_id", studentId)
    .eq("school_id", schoolId)
    .eq("parent_id", parentRow.id)
    .maybeSingle();
  throwIfError(e2, "Failed to verify parent_students link");
  if (!link) {
    throw new ForbiddenError("Parents may only view their linked children");
  }
}

/** Teacher may access a student only if assigned to that student's class. */
export async function assertTeacherMayAccessStudent(
  ctx: ServiceContext,
  studentId: string,
): Promise<void> {
  const repo = toRepoContext(ctx);
  const schoolId = schoolIdOf(repo);
  const { data: student, error } = await getClient(repo)
    .from("students")
    .select("id, class_id")
    .eq("id", studentId)
    .eq("school_id", schoolId)
    .maybeSingle();
  throwIfError(error, "Failed to load student for teacher access");
  if (!student?.class_id) {
    throw new ForbiddenError("Teachers may only view students in their assigned classes");
  }
  await assertTeacherOwnsClass(repo, ctx.userId, student.class_id);
}

/**
 * Centralized student-scoped read authorization for academic panels.
 * Student → self; Parent → linked children; Teacher → assigned classes;
 * Principal/Admin → school (tenant scoped by repo).
 */
export async function assertMayAccessStudent(
  ctx: ServiceContext,
  studentId: string,
): Promise<void> {
  if (isSchoolOperator(ctx.role)) return;

  if (ctx.role === "student") {
    if (ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own academic data");
    }
    if (!ctx.studentId) {
      const repo = toRepoContext(ctx);
      const { data: me, error } = await getClient(repo)
        .from("students")
        .select("id")
        .eq("user_id", ctx.userId)
        .eq("school_id", schoolIdOf(repo))
        .maybeSingle();
      throwIfError(error, "Failed to resolve student identity");
      if (!me?.id || me.id !== studentId) {
        throw new ForbiddenError("Students may only view their own academic data");
      }
    }
    return;
  }

  if (ctx.role === "parent") {
    await assertParentOwnsStudent(ctx, studentId);
    return;
  }

  if (ctx.role === "teacher") {
    await assertTeacherMayAccessStudent(ctx, studentId);
    return;
  }

  throw new ForbiddenError("Not authorized to access this student");
}
