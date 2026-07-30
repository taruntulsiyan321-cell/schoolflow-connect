/**
 * School-scoped query helper.
 * Always prefer filtering by the authenticated user's schoolId from useAuth().
 *
 * Example:
 *   const { schoolId } = useAuth();
 *   supabase.from("students").select("*").eq("school_id", schoolId!)
 *
 * Until every table has school_id, use this only on tenant-aware tables.
 */
export function requireSchoolId(schoolId: string | null | undefined): string {
  if (!schoolId) {
    throw new Error("Missing school context. Sign in again or contact support.");
  }
  return schoolId;
}
