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
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import type { PageParams } from "../repository/base";
import { assertMayAccessStudent } from "./parentAccess";

export interface ClassDateAttendanceSummary {
  classId: string;
  className: string;
  section: string;
  totalStudents: number;
  marked: number;
  present: number;
  absent: number;
  late: number;
  halfDay: number;
  leave: number;
  dayRatePct: number;
  locked: boolean;
}

export interface SchoolDateAttendanceSummary {
  date: string;
  overallDayRatePct: number;
  totalStudents: number;
  present: number;
  absent: number;
  classes: ClassDateAttendanceSummary[];
}

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
    await assertMayAccessStudent(ctx, studentId);
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

  /**
   * School-wide day summary for Admin/Principal AttendanceOverview.
   * Day rate is computed here — UI must display, not recalculate.
   */
  async summarizeSchoolDate(
    ctx: ServiceContext,
    date: string,
  ): Promise<SchoolDateAttendanceSummary> {
    assertCanConsume(ctx, "attendance");
    if (!isSchoolOperator(ctx.role)) {
      throw new ForbiddenError("School attendance summary is admin/principal-only");
    }
    const repo = toRepoContext(ctx);
    const schoolId = schoolIdOf(repo);
    const client = getClient(repo);

    const { data: classes, error: cErr } = await client
      .from("classes")
      .select("id, name, section")
      .eq("school_id", schoolId)
      .order("name");
    throwIfError(cErr, "Failed to list classes");

    const { data: locks } = await client
      .from("attendance_locks")
      .select("class_id")
      .eq("date", date);

    const lockedSet = new Set((locks ?? []).map((l: { class_id: string }) => l.class_id));
    const summaries: ClassDateAttendanceSummary[] = [];
    let totalStudents = 0;
    let present = 0;
    let absent = 0;

    for (const cls of classes ?? []) {
      const students = await listStudentsForClass(repo, cls.id);
      const records = await listAttendanceForClassDate(repo, cls.id, date);
      const p = records.filter((r) => r.status === "present" || r.status === "late").length;
      const a = records.filter((r) => r.status === "absent").length;
      const late = records.filter((r) => r.status === "late").length;
      const halfDay = records.filter((r) => r.status === "half_day").length;
      const leave = records.filter((r) => r.status === "leave").length;
      const dayRatePct = students.length ? Math.round((p / students.length) * 100) : 0;
      summaries.push({
        classId: cls.id,
        className: cls.name,
        section: cls.section,
        totalStudents: students.length,
        marked: records.length,
        present: p,
        absent: a,
        late,
        halfDay,
        leave,
        dayRatePct,
        locked: lockedSet.has(cls.id),
      });
      totalStudents += students.length;
      present += p;
      absent += a;
    }

    return {
      date,
      overallDayRatePct: totalStudents ? Math.round((present / totalStudents) * 100) : 0,
      totalStudents,
      present,
      absent,
      classes: summaries,
    };
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
