import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
  isSchoolOperator,
  type ServiceContext,
} from "./context";
import {
  listAttendanceForClassDate,
  listStudentAttendance,
  upsertAttendance,
  bulkUpsertAttendance,
  type AttendanceRecord,
  type AttendanceStatus,
  type UpsertAttendanceInput,
} from "../repository/attendanceRepository";
import {
  listAssignedClassesForTeacher,
  assertTeacherOwnsClass,
  listStudentsForClass,
  type AssignedClass,
  type ClassStudentRow,
} from "../repository/teacherClassesRepository";
import { getClient, schoolIdOf } from "../repository/base";
import { throwIfError } from "../repository/base";
import type { PageParams } from "../repository/base";

async function assertTeacherMayMarkClass(ctx: ServiceContext, classId: string): Promise<void> {
  if (isSchoolOperator(ctx.role)) return;
  if (ctx.role !== "teacher") {
    throw new ForbiddenError("Only teachers may mark attendance");
  }
  await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
}

/**
 * AttendanceService — Teacher owns writes; Student/Parent/Principal consume.
 * All panel attendance mutations must go through here (not direct table writes).
 */
export const AttendanceService = {
  /** Classes assigned via Teacher–Class–Subject mapping ∪ class teacher. */
  async listAssignedClasses(ctx: ServiceContext): Promise<AssignedClass[]> {
    assertCanConsume(ctx, "attendance");
    if (ctx.role !== "teacher") {
      throw new ForbiddenError("Assigned class list is for the teacher attendance workflow");
    }
    return listAssignedClassesForTeacher(toRepoContext(ctx), ctx.userId);
  },

  async listClassStudents(ctx: ServiceContext, classId: string): Promise<ClassStudentRow[]> {
    assertCanConsume(ctx, "attendance");
    if (ctx.role === "teacher") {
      await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
    } else if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Not authorized to list class students for attendance");
    }
    return listStudentsForClass(toRepoContext(ctx), classId);
  },

  async listForClassDate(
    ctx: ServiceContext,
    classId: string,
    date: string,
  ): Promise<AttendanceRecord[]> {
    assertCanConsume(ctx, "attendance");
    if (ctx.role === "teacher") {
      await assertTeacherOwnsClass(toRepoContext(ctx), ctx.userId, classId);
    }
    return listAttendanceForClassDate(toRepoContext(ctx), classId, date);
  },

  async listForStudent(
    ctx: ServiceContext,
    studentId: string,
    page?: PageParams,
  ): Promise<AttendanceRecord[]> {
    assertCanConsume(ctx, "attendance");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own attendance");
    }
    if (ctx.role === "parent") {
      await assertParentOwnsStudent(ctx, studentId);
    }
    return listStudentAttendance(toRepoContext(ctx), studentId, page);
  },

  async mark(
    ctx: ServiceContext,
    input: UpsertAttendanceInput,
  ): Promise<AttendanceRecord> {
    assertCanOwn(ctx, "attendance");
    await assertTeacherMayMarkClass(ctx, input.classId);
    return upsertAttendance(toRepoContext(ctx), input);
  },

  async markBulk(
    ctx: ServiceContext,
    rows: UpsertAttendanceInput[],
  ): Promise<AttendanceRecord[]> {
    assertCanOwn(ctx, "attendance");
    const classIds = [...new Set(rows.map((r) => r.classId))];
    for (const classId of classIds) {
      await assertTeacherMayMarkClass(ctx, classId);
    }
    return bulkUpsertAttendance(toRepoContext(ctx), rows);
  },

  async markPresent(
    ctx: ServiceContext,
    studentId: string,
    classId: string,
    date: string,
  ): Promise<AttendanceRecord> {
    return this.mark(ctx, { studentId, classId, date, status: "present" satisfies AttendanceStatus });
  },

  /**
   * Parent children linked via parent_user_id or parent_students.
   * Used by Parent attendance views — no mock IDs.
   */
  async listParentChildren(ctx: ServiceContext): Promise<ParentChildRow[]> {
    assertCanConsume(ctx, "attendance");
    if (ctx.role !== "parent" && !isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("Only parents may list linked children");
    }
    return listChildrenForParent(toRepoContext(ctx), ctx.userId);
  },
};

export type { AssignedClass, ClassStudentRow, AttendanceRecord, AttendanceStatus, UpsertAttendanceInput };

export interface ParentChildRow {
  id: string;
  fullName: string;
  classId: string | null;
  classLabel: string;
  photoUrl: string | null;
  rollNumber: string | null;
}

async function assertParentOwnsStudent(ctx: ServiceContext, studentId: string): Promise<void> {
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
    throw new ForbiddenError("Parents may only view their linked children's attendance");
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
    throw new ForbiddenError("Parents may only view their linked children's attendance");
  }
}

async function listChildrenForParent(
  ctx: ReturnType<typeof toRepoContext>,
  parentUserId: string,
): Promise<ParentChildRow[]> {
  const schoolId = schoolIdOf(ctx);
  const client = getClient(ctx);

  const { data: direct, error: dErr } = await client
    .from("students")
    .select("id, full_name, class_id, photo_url, roll_number, classes(name, section)")
    .eq("school_id", schoolId)
    .eq("parent_user_id", parentUserId);
  throwIfError(dErr, "Failed to list children");

  const { data: parentRow, error: pErr } = await client
    .from("parents")
    .select("id")
    .eq("school_id", schoolId)
    .eq("user_id", parentUserId)
    .maybeSingle();
  throwIfError(pErr, "Failed to resolve parent");

  let linked: unknown[] = [];
  if (parentRow?.id) {
    const { data: links, error: lErr } = await client
      .from("parent_students")
      .select("student_id, students(id, full_name, class_id, photo_url, roll_number, classes(name, section))")
      .eq("school_id", schoolId)
      .eq("parent_id", parentRow.id);
    throwIfError(lErr, "Failed to list parent_students");
    linked = links ?? [];
  }

  const byId = new Map<string, ParentChildRow>();

  const mapStudent = (s: {
    id: string;
    full_name: string;
    class_id: string | null;
    photo_url?: string | null;
    roll_number?: string | null;
    classes?: { name: string; section: string } | null;
  }) => {
    const cls = s.classes;
    byId.set(s.id, {
      id: s.id,
      fullName: s.full_name,
      classId: s.class_id,
      classLabel: cls ? `Class ${cls.name}-${cls.section}` : "Unassigned",
      photoUrl: s.photo_url ?? null,
      rollNumber: s.roll_number ?? null,
    });
  };

  for (const s of direct ?? []) {
    mapStudent(s as Parameters<typeof mapStudent>[0]);
  }
  for (const row of linked) {
    const s = (row as { students?: Parameters<typeof mapStudent>[0] | null }).students;
    if (s?.id) mapStudent(s);
  }

  return [...byId.values()].sort((a, b) => a.fullName.localeCompare(b.fullName));
}
