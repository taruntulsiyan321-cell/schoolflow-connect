import { supabase } from "@/integrations/supabase/client";
import { MissingSchoolContextError } from "../tenant";
import type { ServiceContext } from "./context";
import type { AppRole } from "@/auth/types";

/** Shared student academic identity — Home, Practice, and service helpers. */
export type StudentAcademicIdentity = {
  userId: string;
  role: AppRole | null;
  /** True when user_roles grants student portal access, independent of global role priority. */
  hasStudentRole: boolean;
  studentId: string | null;
  schoolId: string | null;
  classId: string | null;
  className: string | null;
  classSection: string | null;
  classDisplayName: string | null;
  classCategory: string | null;
  /** Display label e.g. "10-A" or display_name — never hardcoded. */
  classLabel: string | null;
};

type IdentityRpcRow = {
  user_id: string;
  role: AppRole | null;
  has_student_role?: boolean | null;
  student_id: string | null;
  school_id: string | null;
  class_id: string | null;
  class_name: string | null;
  class_section: string | null;
  class_display_name: string | null;
  class_category: string | null;
};

const ROLE_PRIORITY: AppRole[] = [
  "super_admin",
  "admin",
  "principal",
  "teacher",
  "student",
  "parent",
];

function pickRole(roles: { role: string }[] | null | undefined): AppRole | null {
  const owned = (roles ?? []).map((r) => r.role as AppRole);
  return ROLE_PRIORITY.find((p) => owned.includes(p)) ?? null;
}

function buildClassLabel(row: {
  class_display_name?: string | null;
  class_name?: string | null;
  class_section?: string | null;
}): string | null {
  const display = row.class_display_name?.trim();
  if (display) return display;
  const base = [row.class_name, row.class_section].filter(Boolean).join("-");
  return base || null;
}

/**
 * Load student identity via SECURITY DEFINER RPC when available.
 * Falls back to direct table reads for envs that have not applied the migration yet.
 */
export async function loadStudentAcademicIdentity(
  userId?: string | null,
): Promise<StudentAcademicIdentity | null> {
  const { data: auth, error: authErr } = await supabase.auth.getUser();
  if (authErr) throw authErr;
  const user = auth.user;
  if (!user) return null;
  if (userId && user.id !== userId) {
    throw new Error("Student identity user mismatch");
  }

  // Prefer SSOT RPC (applies link_portal + ensure_default_role + class join as definer).
  const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
    "rpc_get_my_student_identity",
  );
  if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
    const row = rpcData[0] as IdentityRpcRow;
    return {
      userId: row.user_id ?? user.id,
      role: row.role ?? null,
      hasStudentRole: row.has_student_role ?? row.role === "student",
      studentId: row.student_id ?? null,
      schoolId: row.school_id ?? null,
      classId: row.class_id ?? null,
      className: row.class_name ?? null,
      classSection: row.class_section ?? null,
      classDisplayName: row.class_display_name ?? null,
      classCategory: row.class_category ?? null,
      classLabel: buildClassLabel(row),
    };
  }

  // Fallback path (pre-migration): mirror Auth bootstrap + students/classes reads.
  try {
    await supabase.rpc("link_portal_on_auth", { _uid: user.id });
  } catch {
    /* optional */
  }
  try {
    // Portal link only — never invents a synthetic student role.
    await supabase.rpc("ensure_default_role");
  } catch {
    /* optional */
  }

  let role: AppRole | null = null;
  const { data: roleRaw, error: roleErr } = await supabase.rpc("get_my_role");
  if (roleErr) console.warn("[resolveStudentContext] get_my_role failed:", roleErr.message);
  role = (roleRaw as AppRole | null) ?? null;
  const { data: roles, error: rolesErr } = await supabase.from("user_roles").select("role").eq("user_id", user.id);
  if (rolesErr) console.warn("[resolveStudentContext] user_roles lookup failed:", rolesErr.message);
  const hasStudentRole = (roles ?? []).some((entry) => entry.role === "student");
  if (!role) {
    role = pickRole(roles);
  }

  const { data: stu, error: stuErr } = await supabase
    .from("students")
    .select("id, school_id, class_id, classes(name, section, display_name, category)")
    .eq("user_id", user.id)
    .maybeSingle();
  if (stuErr) console.warn("[resolveStudentContext] students lookup failed:", stuErr.message);

  type ClassJoin = {
    name?: string | null;
    section?: string | null;
    display_name?: string | null;
    category?: string | null;
  };
  const rawClass = (stu as { classes?: ClassJoin | ClassJoin[] | null } | null)?.classes;
  const cls = Array.isArray(rawClass) ? rawClass[0] : rawClass;

  let schoolId = stu?.school_id ?? null;
  if (!schoolId) {
    const { data: sid, error: sidErr } = await supabase.rpc("get_my_school_id");
    if (sidErr) console.warn("[resolveStudentContext] get_my_school_id failed:", sidErr.message);
    schoolId = (sid as string | null) ?? null;
  }

  // A student portal identity must not inherit the global teacher/admin role.
  // The row and explicit user_roles grant are both required to prevent privilege inference.
  if (stu?.id && hasStudentRole) {
    role = "student";
  }

  // If embed was blocked by RLS, fetch class by id (own-class policy after migration).
  let className = cls?.name ?? null;
  let classSection = cls?.section ?? null;
  let classDisplayName = cls?.display_name ?? null;
  let classCategory = cls?.category ?? null;
  if (stu?.class_id && !className && !classDisplayName) {
    const { data: c, error: cErr } = await supabase
      .from("classes")
      .select("name, section, display_name, category")
      .eq("id", stu.class_id)
      .maybeSingle();
    if (cErr) console.warn("[resolveStudentContext] class fallback lookup failed:", cErr.message);
    if (c) {
      className = c.name ?? null;
      classSection = c.section ?? null;
      classDisplayName = c.display_name ?? null;
      classCategory = c.category ?? null;
    }
  }

  return {
    userId: user.id,
    role,
    hasStudentRole,
    studentId: stu?.id ?? null,
    schoolId,
    classId: stu?.class_id ?? null,
    className,
    classSection,
    classDisplayName,
    classCategory,
    classLabel: buildClassLabel({
      class_display_name: classDisplayName,
      class_name: className,
      class_section: classSection,
    }),
  };
}

export function identityToServiceContext(identity: StudentAcademicIdentity): ServiceContext {
  if (!identity.schoolId) {
    throw new MissingSchoolContextError(
      "Student school is not bound. Sign in again or contact your school admin.",
    );
  }
  // A globally teacher/admin user may enter the student portal only when the
  // student row is bound to their user and user_roles explicitly grants student.
  const hasStudentPortalCapability =
    Boolean(identity.studentId) &&
    (identity.role === "student" || identity.hasStudentRole === true);
  if (!hasStudentPortalCapability) {
    throw new Error("Student role required for this action");
  }
  return {
    schoolId: identity.schoolId,
    userId: identity.userId,
    role: "student",
    studentId: identity.studentId,
    classId: identity.classId,
    classLabel: identity.classLabel,
    classCategory: identity.classCategory,
  };
}

/**
 * Build a student ServiceContext outside React (persistence helpers, battle wrappers).
 * Prefer `useAcademicContext()` in components when available.
 * Never invent a default school_id — tenant must come from students / get_my_school_id.
 * Role is resolved from DB (get_my_role / identity RPC) — never trust a hardcoded client role.
 */
export async function resolveStudentServiceContext(): Promise<ServiceContext> {
  const identity = await loadStudentAcademicIdentity();
  if (!identity) throw new Error("Sign in required");
  return identityToServiceContext(identity);
}
