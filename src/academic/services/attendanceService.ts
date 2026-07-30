import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  ForbiddenError,
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
import type { PageParams } from "../repository/base";

/**
 * AttendanceService — Teacher owns writes; Student/Parent/Principal consume.
 * All panel attendance mutations must go through here (not direct table writes).
 */
export const AttendanceService = {
  async listForClassDate(
    ctx: ServiceContext,
    classId: string,
    date: string,
  ): Promise<AttendanceRecord[]> {
    assertCanConsume(ctx, "attendance");
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
    return listStudentAttendance(toRepoContext(ctx), studentId, page);
  },

  async mark(
    ctx: ServiceContext,
    input: UpsertAttendanceInput,
  ): Promise<AttendanceRecord> {
    assertCanOwn(ctx, "attendance");
    return upsertAttendance(toRepoContext(ctx), input);
  },

  async markBulk(
    ctx: ServiceContext,
    rows: UpsertAttendanceInput[],
  ): Promise<AttendanceRecord[]> {
    assertCanOwn(ctx, "attendance");
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
};
