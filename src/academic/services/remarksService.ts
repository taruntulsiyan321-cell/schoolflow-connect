import {
  assertCanOwn,
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import {
  listRemarksForStudent,
  createTeacherRemark,
  type CreateRemarkInput,
} from "../repository/remarksRepository";
import { getTeacherIdForUser } from "../repository/teacherAssignmentRepository";
import type { TeacherRemark } from "../types";
import type { PageParams } from "../repository/base";
import { ForbiddenError, isSchoolOperator } from "./context";
import { ValidationFailedError } from "../repository/errors";
import { broadcastAcademicWrite } from "../live";

/**
 * RemarksService — Teacher creates remarks; Student/Parent/Principal consume.
 */
export const RemarksService = {
  async listForStudent(
    ctx: ServiceContext,
    studentId: string,
    page?: PageParams,
  ): Promise<TeacherRemark[]> {
    assertCanConsume(ctx, "teacher_remark");
    if (ctx.role === "student" && ctx.studentId && ctx.studentId !== studentId) {
      throw new ForbiddenError("Students may only view their own remarks");
    }
    return listRemarksForStudent(toRepoContext(ctx), studentId, page);
  },

  async create(
    ctx: ServiceContext,
    input: Omit<CreateRemarkInput, "teacherId"> & { teacherId?: string },
  ): Promise<TeacherRemark> {
    assertCanOwn(ctx, "teacher_remark");

    let teacherId = input.teacherId ?? ctx.teacherId ?? null;
    if (!teacherId) {
      teacherId = await getTeacherIdForUser(toRepoContext(ctx), ctx.userId);
    }
    if (!teacherId && !isSchoolOperator(ctx.role)) {
      throw new ValidationFailedError([
        {
          field: "teacherId",
          code: "required",
          message: "Teacher profile not linked to this account",
        },
      ]);
    }
    if (!teacherId) {
      throw new ValidationFailedError([
        {
          field: "teacherId",
          code: "required",
          message: "teacherId is required",
        },
      ]);
    }

    const row = await createTeacherRemark(toRepoContext(ctx), {
      ...input,
      teacherId,
    });
    broadcastAcademicWrite(ctx.schoolId, ["profile"], {
      studentId: input.studentId,
      classId: input.classId ?? null,
      source: "RemarksService.create",
    });
    return row;
  },
};
