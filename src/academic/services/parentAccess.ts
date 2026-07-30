import { ForbiddenError, toRepoContext, type ServiceContext } from "./context";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";

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

export async function assertMayAccessStudent(
  ctx: ServiceContext,
  studentId: string,
): Promise<void> {
  if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
    throw new ForbiddenError("Students may only view their own academic data");
  }
  if (ctx.role === "parent") {
    await assertParentOwnsStudent(ctx, studentId);
  }
}
