import {
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./context";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";
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
 * Authorize a WRITE to a class timetable.
 *
 * Deliberately stricter than the read path: reads accept any teacher assigned
 * to the class, but `class_timetables`' RLS only grants writes to admin,
 * principal, or the class teacher (`teachers.class_teacher_of = class_id`).
 * `assertTeacherOwnsClass` is the looser "assigned to" check and would let a
 * subject teacher through here, so the service check would then disagree with
 * the policy and surface as an opaque RLS rejection instead of a clear error.
 */
async function assertMayWriteTimetable(
  ctx: ServiceContext,
  classId: string,
): Promise<void> {
  if (isSchoolOperator(ctx.role)) return;
  if (ctx.role === "teacher") {
    const { isClassTeacherOfClass } = await import("../repository/teacherClassesRepository");
    if (await isClassTeacherOfClass(toRepoContext(ctx), ctx.userId, classId)) return;
    throw new ForbiddenError("Only the class teacher can edit this class timetable");
  }
  throw new ForbiddenError("Not authorized to edit class timetables");
}

/**
 * TimetableService — class schedule in `class_timetables`.
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

    // school_id is filtered explicitly, not left to RLS: every other read in
    // this service scopes by tenant itself, and rows predating the school_id
    // backfill can still carry NULL.
    const { data: tt, error: ttErr } = await client
      .from("class_timetables")
      .select("grid")
      .eq("class_id", resolved.classId)
      .or(`school_id.eq.${schoolId},school_id.is.null`)
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

  /**
   * Create or replace a class's timetable grid.
   *
   * `school_id` is set explicitly rather than left to the table's trigger:
   * the admin/principal branch of the "timetable write" policy is
   * `has_role(...) AND same_school(school_id)`, and `same_school(NULL)` is
   * never true — so a row that reached the table without it would be
   * invisible and unwritable to the very roles that own timetables.
   */
  async upsertForClass(
    ctx: ServiceContext,
    classId: string,
    grid: Record<string, string>,
  ): Promise<ClassTimetableSnapshot | null> {
    assertCanConsume(ctx, "class");
    if (!classId) throw new ForbiddenError("classId is required");
    await assertMayWriteTimetable(ctx, classId);

    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);

    // Confirm the class is in the caller's school before writing. Without this
    // an operator could address another school's class_id and rely on RLS
    // alone to reject it.
    const { data: cls, error: classErr } = await client
      .from("classes")
      .select("id")
      .eq("id", classId)
      .eq("school_id", schoolId)
      .maybeSingle();
    throwIfError(classErr, "Failed to load class");
    if (!cls) throw new ForbiddenError("Class not found in this school");

    const { error } = await client
      .from("class_timetables")
      .upsert(
        {
          class_id: classId,
          school_id: schoolId,
          grid: normalizeGrid(grid),
          updated_at: new Date().toISOString(),
          updated_by: ctx.userId,
        } as never,
        { onConflict: "class_id" },
      );
    throwIfError(error, "Failed to save timetable");

    broadcastAcademicWrite(ctx.schoolId, ["timetable"], {
      classId,
      source: "TimetableService.upsertForClass",
    });

    return this.forClass(ctx, classId);
  },

  /** Empty a class's timetable without deleting the row's audit trail. */
  async clearForClass(ctx: ServiceContext, classId: string): Promise<void> {
    assertCanConsume(ctx, "class");
    if (!classId) throw new ForbiddenError("classId is required");
    await assertMayWriteTimetable(ctx, classId);

    const repo = toRepoContext(ctx);
    const client = getClient(repo);

    const { error } = await client
      .from("class_timetables")
      .update({
        grid: {},
        updated_at: new Date().toISOString(),
        updated_by: ctx.userId,
      } as never)
      .eq("class_id", classId)
      .eq("school_id", schoolIdOf(repo));
    throwIfError(error, "Failed to clear timetable");

    broadcastAcademicWrite(ctx.schoolId, ["timetable"], {
      classId,
      source: "TimetableService.clearForClass",
    });
  },
};
