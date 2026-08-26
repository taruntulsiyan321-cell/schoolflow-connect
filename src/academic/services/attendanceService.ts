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
  isClassTeacherOfClass,
  listStudentsForClass,
  type AssignedClass,
  type ClassStudentRow,
} from "../repository/teacherClassesRepository";
import { getClient, schoolIdOf, throwIfError } from "../repository/base";
import type { PageParams } from "../repository/base";
import { assertMayAccessStudent } from "./parentAccess";
import { broadcastAcademicWrite } from "../live";

function afterAttendanceWrite(
  ctx: ServiceContext,
  meta?: {
    classId?: string | null;
    studentId?: string | null;
    source?: string;
    domains?: Array<"attendance" | "profile" | "xp">;
  },
) {
  broadcastAcademicWrite(ctx.schoolId, meta?.domains ?? ["attendance", "profile"], {
    classId: meta?.classId,
    studentId: meta?.studentId,
    source: meta?.source ?? "AttendanceService",
  });
}

export interface ClassDateAttendanceSummary {
  classId: string;
  className: string;
  section: string;
  totalStudents: number;
  marked: number;
  present: number;
  absent: number;
  dayRatePct: number;
  /**
   * Chunk 4.7: replaces `locked`. Nothing is ever locked or final; what a
   * reader needs to know is whether this day's figure was changed after it was
   * first submitted. True when at least one student's status actually changed
   * -- resolved from attendance_day_edits, which reads attendance_audit.
   */
  edited: boolean;
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
  // Marking (write) is class-teacher-only, matching TeacherAttendancePage's
  // own canMark = !!selected?.isClassTeacher — a subject-only teacher can
  // view the roster (assertTeacherOwnsClass, used by the read paths below)
  // but must not be able to write attendance for a class they don't own.
  const ok = await isClassTeacherOfClass(toRepoContext(ctx), ctx.userId, classId);
  if (!ok) {
    throw new ForbiddenError("Only the class teacher can mark attendance for this class");
  }
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
    const row = await upsertAttendance(toRepoContext(ctx), input);
    afterAttendanceWrite(ctx, {
      classId: input.classId,
      studentId: input.studentId,
      source: "AttendanceService.mark",
      domains:
        input.status === "present"
          ? ["attendance", "profile", "xp"]
          : ["attendance", "profile"],
    });

    if (input.status === "present") {
      try {
        const { data: stu } = await getClient(toRepoContext(ctx))
          .from("students")
          .select("user_id")
          .eq("id", input.studentId)
          .maybeSingle();
        if (stu?.user_id) {
          const { ProgressionService } = await import("./progressionService");
          await ProgressionService.awardSafe(ctx, {
            ruleCode: "attendance.present",
            sourceType: "attendance",
            sourceId: `${input.studentId}:${input.date}`,
            idempotencyKey: `attendance.present:${input.studentId}:${input.date}`,
            meta: { status: input.status },
            targetUserId: stu.user_id,
          });
        }
      } catch (e) {
        // G10: this is the shape that hid nine broken XP source types for four
        // days. It stays non-fatal — attendance is saved either way — but it
        // no longer stays silent.
        console.warn(
          "[attendance] XP award failed after mark():",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return row;
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
    const saved = await bulkUpsertAttendance(toRepoContext(ctx), rows);
    const awardsXp = rows.some((r) => r.status === "present");
    afterAttendanceWrite(ctx, {
      classId: classIds[0] ?? null,
      source: "AttendanceService.markBulk",
      domains: awardsXp
        ? ["attendance", "profile", "xp"]
        : ["attendance", "profile"],
    });

    // Teacher UI saves via markBulk — award attendance XP consistently with mark().
    const presentRows = rows.filter(
      (r) => r.status === "present",
    );
    if (presentRows.length > 0) {
      try {
        const repo = toRepoContext(ctx);
        const studentIds = [...new Set(presentRows.map((r) => r.studentId))];
        const { data: stus } = await getClient(repo)
          .from("students")
          .select("id, user_id")
          .in("id", studentIds)
          .eq("school_id", schoolIdOf(repo));
        const userByStudent = new Map(
          (stus ?? [])
            .filter((s) => s.user_id)
            .map((s) => [String(s.id), String(s.user_id)] as const),
        );
        const { ProgressionService } = await import("./progressionService");
        for (const r of presentRows) {
          const uid = userByStudent.get(r.studentId);
          if (!uid) continue;
          await ProgressionService.awardSafe(ctx, {
            ruleCode: "attendance.present",
            sourceType: "attendance",
            sourceId: `${r.studentId}:${r.date}`,
            idempotencyKey: `attendance.present:${r.studentId}:${r.date}`,
            meta: { status: r.status },
            targetUserId: uid,
          });
        }
      } catch (e) {
        // G10: same shape as above, on the bulk path the teacher UI uses.
        console.warn(
          "[attendance] XP award failed after markBulk():",
          e instanceof Error ? e.message : e,
        );
      }
    }

    return saved;
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

    // The edited marker. One definition for every screen that shows this day's
    // figure, so a number can never move without an explanation next to it.
    const { data: edits } = await client
      .from("attendance_day_edits")
      .select("section_id")
      .eq("date", date)
      .eq("school_id", schoolId);

    const editedSet = new Set(
      (edits ?? []).map((e) => e.section_id).filter((id): id is string => id !== null),
    );

    // Both queries per class, and all classes, run concurrently — a sequential
    // await here meant a 40-class school made 80 round trips one at a time
    // behind a single spinner.
    const summaries: ClassDateAttendanceSummary[] = await Promise.all(
      (classes ?? []).map(async (cls) => {
        const [students, records] = await Promise.all([
          listStudentsForClass(repo, cls.id),
          listAttendanceForClassDate(repo, cls.id, date),
        ]);
        const p = records.filter((r) => r.status === "present").length;
        const a = records.filter((r) => r.status === "absent").length;
        const dayRatePct = students.length ? Math.round((p / students.length) * 100) : 0;
        return {
          classId: cls.id,
          className: cls.name,
          section: cls.section,
          totalStudents: students.length,
          marked: records.length,
          present: p,
          absent: a,
          dayRatePct,
          edited: editedSet.has(cls.id),
        };
      }),
    );

    let totalStudents = 0;
    let present = 0;
    let absent = 0;
    for (const s of summaries) {
      totalStudents += s.totalStudents;
      present += s.present;
      absent += s.absent;
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
  /**
   * The identifier a school actually uses with parents. The row id is a
   * database UUID and must never be shown — the parent Children page
   * printed it under "Student ID".
   */
  admissionNumber: string | null;
}

async function listChildrenForParent(
  ctx: ReturnType<typeof toRepoContext>,
  parentUserId: string,
): Promise<ParentChildRow[]> {
  const schoolId = schoolIdOf(ctx);
  const client = getClient(ctx);

  const { data: direct, error: dErr } = await client
    .from("students_current")
    .select("id, full_name, class_id, photo_url, roll_number, admission_number, classes(name, section)")
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
      .select("student_id, students:students_current(id, full_name, class_id, photo_url, roll_number, admission_number, classes(name, section))")
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
    admission_number?: string | null;
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
      admissionNumber: s.admission_number ?? null,
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
