import { getClient, schoolIdOf, throwIfError, type RepoContext } from "./base";

/**
 * Teaching-assignment checks used by marks / homework services.
 * Centralized so panels never reimplement subject ownership rules.
 */
export async function teacherAssignedToClassSubject(
  ctx: RepoContext,
  input: {
    teacherUserId: string;
    classId: string;
    subject?: string | null;
    subjectId?: string | null;
  },
): Promise<boolean> {
  const schoolId = schoolIdOf(ctx);

  const { data: teacher, error: tErr } = await getClient(ctx)
    .from("teachers")
    .select("id, class_teacher_of")
    .eq("school_id", schoolId)
    .eq("user_id", input.teacherUserId)
    .maybeSingle();

  throwIfError(tErr, "Failed to load teacher");
  if (!teacher) return false;

  if (teacher.class_teacher_of === input.classId) return true;

  let q = getClient(ctx)
    .from("teacher_classes")
    .select("id")
    .eq("school_id", schoolId)
    .eq("teacher_id", teacher.id)
    .eq("class_id", input.classId)
    .limit(1);

  if (input.subjectId) {
    q = q.eq("subject_id", input.subjectId);
  } else if (input.subject) {
    q = q.eq("subject", input.subject);
  }

  const { data, error } = await q;
  throwIfError(error, "Failed to check teaching assignment");
  return (data?.length ?? 0) > 0;
}

export async function getTeacherIdForUser(
  ctx: RepoContext,
  userId: string,
): Promise<string | null> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("teachers")
    .select("id")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .maybeSingle();

  throwIfError(error, "Failed to resolve teacher");
  return data?.id ?? null;
}
