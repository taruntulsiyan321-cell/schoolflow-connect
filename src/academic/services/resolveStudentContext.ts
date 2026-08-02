import { supabase } from "@/integrations/supabase/client";
import { MissingSchoolContextError } from "../tenant";
import type { ServiceContext } from "./context";
import type { AppRole } from "@/auth/types";

/**
 * Build a student ServiceContext outside React (persistence helpers, battle wrappers).
 * Prefer `useAcademicContext()` in components when available.
 * Never invent a default school_id — tenant must come from students / get_my_school_id.
 * Role is resolved from DB (get_my_role) — never trust a hardcoded client role for authz.
 */
export async function resolveStudentServiceContext(): Promise<ServiceContext> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth.user;
  if (!user) throw new Error("Sign in required");

  const { data: roleRaw } = await supabase.rpc("get_my_role");
  const role = (roleRaw as AppRole | null) ?? null;
  if (role !== "student") {
    throw new Error("Student role required for this action");
  }

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
  if (!schoolId) {
    throw new MissingSchoolContextError(
      "Student school is not bound. Sign in again or contact your school admin.",
    );
  }

  return {
    schoolId,
    userId: user.id,
    role: "student",
    studentId: stu?.id ?? null,
  };
}
