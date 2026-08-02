import type { AppRole } from "@/auth/types";
import type { AcademicEntityKey } from "../entities";
import { canOwn, canConsume, type OwnerRole } from "../ownership";
import type { RepoContext } from "../repository/base";
import { AcademicRepositoryError } from "../repository/errors";
import { requireSchoolId } from "../tenant";

export class ForbiddenError extends AcademicRepositoryError {
  constructor(message = "You do not have permission for this academic action") {
    super("forbidden", message);
    this.name = "ForbiddenError";
  }
}

export interface ServiceContext {
  schoolId: string;
  userId: string;
  role: AppRole;
  /** Optional teacher row id when already resolved */
  teacherId?: string | null;
  /** Optional student row id when already resolved */
  studentId?: string | null;
  /** Optional class id from students.class_id (never hardcoded) */
  classId?: string | null;
  /** Optional class display label e.g. "10-A" */
  classLabel?: string | null;
  /** Optional class category (commerce/science/…) for curriculum stream */
  classCategory?: string | null;
}

export function toRepoContext(ctx: ServiceContext): RepoContext {
  return {
    schoolId: requireSchoolId(ctx.schoolId),
    userId: ctx.userId,
  };
}

function asOwnerRole(role: AppRole): OwnerRole | null {
  if (
    role === "admin" ||
    role === "principal" ||
    role === "teacher" ||
    role === "student" ||
    role === "parent"
  ) {
    return role;
  }
  // Never map super_admin into school portal ownership (not a Gurukul actor role).
  return null;
}

/** Assert the actor may write this entity. */
export function assertCanOwn(ctx: ServiceContext, entity: AcademicEntityKey): void {
  const ownerRole = asOwnerRole(ctx.role);
  if (!ownerRole || !canOwn(ownerRole, entity)) {
    throw new ForbiddenError(`Role '${ctx.role}' cannot modify ${entity}`);
  }
}

/** Assert the actor may read this entity. */
export function assertCanConsume(ctx: ServiceContext, entity: AcademicEntityKey): void {
  const ownerRole = asOwnerRole(ctx.role);
  if (!ownerRole || !canConsume(ownerRole, entity)) {
    throw new ForbiddenError(`Role '${ctx.role}' cannot read ${entity}`);
  }
}

/** Admin/principal override for operational supervision (read + limited write). */
export function isSchoolOperator(role: AppRole): boolean {
  return role === "admin" || role === "principal";
}
