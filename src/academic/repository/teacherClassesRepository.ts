import { getClient, schoolIdOf, throwIfError, type RepoContext } from "./base";
import { NotFoundError, TenantViolationError } from "./errors";

export interface AssignedClass {
  id: string;
  name: string;
  section: string;
  academicYear: string | null;
  subject: string | null;
  subjectId: string | null;
  isClassTeacher: boolean;
  studentCount: number;
}

export interface ClassStudentRow {
  id: string;
  fullName: string;
  rollNumber: string | null;
  admissionNumber: string | null;
  photoUrl: string | null;
  classId: string;
}

/** Resolve teachers.id for the authenticated user within the school. */
export async function resolveTeacherId(ctx: RepoContext, userId: string): Promise<string> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("teachers")
    .select("id")
    .eq("school_id", schoolId)
    .eq("user_id", userId)
    .maybeSingle();
  throwIfError(error, "Failed to resolve teacher");
  if (!data?.id) throw new NotFoundError("teacher", userId);
  return data.id;
}

/**
 * Classes the teacher may mark attendance for:
 * class_teacher_of ∪ teacher_classes mappings (Teacher–Class–Subject).
 */
export async function listAssignedClassesForTeacher(
  ctx: RepoContext,
  teacherUserId: string,
): Promise<AssignedClass[]> {
  const schoolId = schoolIdOf(ctx);
  const teacherId = await resolveTeacherId(ctx, teacherUserId);

  const { data: teacher, error: tErr } = await getClient(ctx)
    .from("teachers")
    .select("id, class_teacher_of")
    .eq("id", teacherId)
    .maybeSingle();
  throwIfError(tErr, "Failed to load teacher");

  const byClass = new Map<string, AssignedClass>();

  if (teacher?.class_teacher_of) {
    const { data: cls, error } = await getClient(ctx)
      .from("classes")
      .select("id, name, section, academic_year")
      .eq("id", teacher.class_teacher_of)
      .eq("school_id", schoolId)
      .maybeSingle();
    throwIfError(error, "Failed to load class teacher class");
    if (cls) {
      byClass.set(cls.id, {
        id: cls.id,
        name: cls.name,
        section: cls.section,
        academicYear: cls.academic_year ?? null,
        subject: null,
        subjectId: null,
        isClassTeacher: true,
        studentCount: 0,
      });
    }
  }

  const { data: mappings, error: mErr } = await (getClient(ctx) as any)
    .from("teacher_classes")
    .select("class_id, subject, subject_id, classes(id, name, section, academic_year)")
    .eq("teacher_id", teacherId)
    .eq("school_id", schoolId);
  throwIfError(mErr, "Failed to load teacher class mappings");

  for (const row of (mappings ?? []) as Array<{
    class_id: string;
    subject: string | null;
    subject_id?: string | null;
    classes:
      | { id: string; name: string; section: string; academic_year: string | null }
      | null;
  }>) {
    const c = row.classes;
    if (!c?.id) continue;
    const existing = byClass.get(c.id);
    if (existing) {
      if (!existing.subject && row.subject) existing.subject = row.subject;
      if (!existing.subjectId && row.subject_id) existing.subjectId = row.subject_id;
      continue;
    }
    byClass.set(c.id, {
      id: c.id,
      name: c.name,
      section: c.section,
      academicYear: c.academic_year ?? null,
      subject: row.subject ?? null,
      subjectId: row.subject_id ?? null,
      isClassTeacher: false,
      studentCount: 0,
    });
  }

  const classes = [...byClass.values()];
  for (const cls of classes) {
    const { count, error } = await getClient(ctx)
      .from("students")
      .select("id", { count: "exact", head: true })
      .eq("school_id", schoolId)
      .eq("class_id", cls.id);
    throwIfError(error, "Failed to count students");
    cls.studentCount = count ?? 0;
  }

  return classes.sort((a, b) =>
    `${a.name}-${a.section}`.localeCompare(`${b.name}-${b.section}`),
  );
}

export async function assertTeacherOwnsClass(
  ctx: RepoContext,
  teacherUserId: string,
  classId: string,
): Promise<void> {
  const assigned = await listAssignedClassesForTeacher(ctx, teacherUserId);
  if (!assigned.some((c) => c.id === classId)) {
    throw new TenantViolationError("Teacher is not assigned to this class");
  }
}

export async function listStudentsForClass(
  ctx: RepoContext,
  classId: string,
): Promise<ClassStudentRow[]> {
  const schoolId = schoolIdOf(ctx);
  const { data, error } = await getClient(ctx)
    .from("students")
    .select("id, full_name, roll_number, admission_number, photo_url, class_id")
    .eq("school_id", schoolId)
    .eq("class_id", classId)
    .order("roll_number", { ascending: true });
  throwIfError(error, "Failed to list class students");

  return (data ?? []).map((s) => ({
    id: s.id,
    fullName: s.full_name,
    rollNumber: s.roll_number,
    admissionNumber: s.admission_number,
    photoUrl: (s as { photo_url?: string | null }).photo_url ?? null,
    classId: s.class_id!,
  }));
}
