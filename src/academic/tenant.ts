import { DEFAULT_SCHOOL_ID } from "@/auth/constants";

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

/** Prefer auth school; fall back only for local/demo bootstrap. */
export function resolveSchoolId(
  schoolId: string | null | undefined,
  allowDefault = false,
): string {
  if (schoolId) return schoolId;
  if (allowDefault) return DEFAULT_SCHOOL_ID;
  throw new MissingSchoolContextError();
}

/**
 * Apply school scope to a Supabase query builder-like object.
 * Usage: scopeBySchool(supabase.from("students").select("*"), schoolId)
 */
export function scopeBySchool<T extends { eq: (column: string, value: string) => T }>(
  query: T,
  schoolId: string,
): T {
  return query.eq("school_id", requireSchoolId(schoolId));
}
