import { supabase } from "@/integrations/supabase/client";
import { DEFAULT_SCHOOL_ID } from "@/auth/constants";
import type { ServiceContext } from "./context";

/**
 * Build a student ServiceContext outside React (persistence helpers, battle wrappers).
 * Prefer `useAcademicContext()` in components when available.
 */
export async function resolveStudentServiceContext(): Promise<ServiceContext> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth.user;
  if (!user) throw new Error("Sign in required");

  const { data: stu } = await supabase
    .from("students")
    .select("id, school_id")
    .eq("user_id", user.id)
    .maybeSingle();

  let schoolId = stu?.school_id ?? null;
  if (!schoolId) {
    const { data: sid } = await supabase.rpc("get_my_school_id");
    schoolId = (sid as string | null) ?? null;
  }

  return {
    schoolId: schoolId ?? DEFAULT_SCHOOL_ID,
    userId: user.id,
    role: "student",
    studentId: stu?.id ?? null,
  };
}
