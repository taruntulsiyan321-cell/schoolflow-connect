/**
 * Multi-tenant helpers for the Academic Engine.
 * Every tenant-scoped query must include school_id from the auth context.
 */

export class MissingSchoolContextError extends Error {
  constructor(message = "Missing school context. Sign in again or contact support.") {
    super(message);
    this.name = "MissingSchoolContextError";
  }
}

export function requireSchoolId(schoolId: string | null | undefined): string {
  if (!schoolId) throw new MissingSchoolContextError();
  return schoolId;
}


