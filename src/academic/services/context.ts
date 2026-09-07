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
  // §10.20 (docs/locked-decisions.md:611-624): the super admin has
  // "unrestricted access to academic data, for support". That is a READ, and it
  // is not ownership — `assertCanOwn` still refuses them, because §10.20's
  // "Can do" list is platform-level (schools, admins, billing, the central
  // question bank, the curriculum tree) and does not include authoring a
  // school's records. So the exemption belongs here and not in `asOwnerRole`.
  //
  // THIS DOES NOT DECIDE WHICH SCHOOL THEY SEE, and that is the whole point.
  // "The access-log row is the grant": `my_accessible_school_ids()` returns
  // only schools with a live, expiring grant now that 20260911000000 closed the
  // ungranted `profiles.school_id` path. A super admin with no open grant
  // therefore reads ZERO ROWS rather than hitting an error — which is the
  // correct answer to "show me a school nobody has granted you", and is why
  // refusing here was the wrong shape: it turned "no grant" into a broken page.
  //
  // Measured in probe22, both directions: no grant → get_my_school_id() NULL,
  // no accessible schools, no exams; grant → the school appears and the exam
  // reads, while get_my_school_id() STAYS NULL.
  if (ctx.role === "super_admin") return;
  const ownerRole = asOwnerRole(ctx.role);
  if (!ownerRole || !canConsume(ownerRole, entity)) {
    throw new ForbiddenError(`Role '${ctx.role}' cannot read ${entity}`);
  }
}

/**
 * May read SCHOOL-WIDE academic data: summaries, rollups, lists across a whole
 * school rather than one class or one child.
 *
 * Admin and principal by §10 and §10.18, plus super_admin by §10.20
 * ("unrestricted access to academic data, for support"). Which school they see
 * is not decided here — `my_accessible_school_ids()` decides that, and for a
 * super admin it is empty until they open a logged, expiring access grant.
 *
 * SEPARATE FROM `isSchoolOperator` ON PURPOSE. That one answers "may supervise
 * and write", and admitting a super admin there would give them writes §10.20
 * does not grant. This one answers "may look".
 *
 * NOT for the audit log: §10.18 is "Visible to admin only", not principal and
 * not super admin, so those call sites test `role === "admin"` directly.
 */
export function canReadSchoolWide(role: AppRole): boolean {
  return role === "admin" || role === "principal" || role === "super_admin";
}

/** Admin/principal override for operational supervision (read + limited write). */
export function isSchoolOperator(role: AppRole): boolean {
  return role === "admin" || role === "principal";
}
