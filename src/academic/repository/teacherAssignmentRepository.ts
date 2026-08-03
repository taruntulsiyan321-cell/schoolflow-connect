import { getClient, schoolIdOf, throwIfError, type RepoContext } from "./base";

/**
 * Teaching-assignment checks used by marks / homework / doubts services.
 * Delegates to public.teacher_teaches_class_subject so TS matches RLS:
 * case-insensitive subject text, subject_id, and subject_id↔name fallback.
 * Class-teacher-only does NOT unlock every subject.
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
  if (!input.classId) return false;
  if (!input.subjectId && !String(input.subject ?? "").trim()) return false;

  const { data, error } = await getClient(ctx).rpc("teacher_teaches_class_subject", {
    _user_id: input.teacherUserId,
    _class_id: input.classId,
    _subject: String(input.subject ?? "").trim() || null,
    _subject_id: input.subjectId ?? null,
  } as never);

  throwIfError(error, "Failed to check teaching assignment");
  return data === true;
}

/** True if this user is the class teacher of the class. */
export async function isClassTeacherOfClass(
  ctx: RepoContext,
  teacherUserId: string,
  classId: string,
): Promise<boolean> {
  const schoolId = schoolIdOf(ctx);
  const { data: teacher, error } = await getClient(ctx)
    .from("teachers")
    .select("id, class_teacher_of")
    .eq("school_id", schoolId)
    .eq("user_id", teacherUserId)
    .maybeSingle();
  throwIfError(error, "Failed to load teacher");
  return !!teacher && teacher.class_teacher_of === classId;
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
