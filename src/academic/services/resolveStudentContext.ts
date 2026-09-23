import { supabase } from "@/integrations/supabase/client";
import { MissingSchoolContextError } from "../tenant";
import type { ServiceContext } from "./context";
import type { AppRole } from "@/auth/types";
import type { SchoolKind } from "@/gurukul/nav";

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
  /** From schools.kind — null when the RPC/env has not yet returned it. */
  schoolKind: SchoolKind | null;
  /** Competitive exam on exam_accounts — null for organisation schools. */
  examId: string | null;
  examCode: string | null;
  examName: string | null;
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
  school_kind?: string | null;
  exam_id?: string | null;
  exam_code?: string | null;
  exam_name?: string | null;
};

function parseSchoolKind(raw: string | null | undefined): SchoolKind | null {
  if (raw === "school" || raw === "individual") return raw;
  return null;
}

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
 * One identity per signed-in student, shared by every caller for a minute.
 *
 * useAcademicContext is mounted by 87 components, and each mount loaded the
 * identity afresh: a round trip to the auth server (getUser) and then
 * rpc_get_my_student_identity, one after the other. Measured 2026-09-22 as the
 * Class 12 student: Start Practice spent its first ~800 ms on those two calls
 * before it could ask for a single question — for an identity the page had
 * loaded a moment earlier. rpc_get_my_student_identity had run 13,385 times.
 *
 * Only a complete student identity is kept. An account that is not linked to a
 * student yet is re-read on every call, so a portal link made a moment ago is
 * never hidden behind a cached "no student". A failed load is not kept either.
 * Concurrent mounts share the one request in flight.
 */
const IDENTITY_TTL_MS = 60_000;
let identityCache: {
  userId: string;
  at: number;
  promise: Promise<StudentAcademicIdentity | null>;
} | null = null;

/**
 * Load the signed-in student's identity, from the shared copy when it is
 * fresh. The session is read locally: the identity RPC itself runs under the
 * session's token, so the server still verifies it on every load.
 */
export async function loadStudentAcademicIdentity(
  userId?: string | null,
): Promise<StudentAcademicIdentity | null> {
  const { data: auth, error: authErr } = await supabase.auth.getSession();
  if (authErr) throw authErr;
  const user = auth.session?.user;
  if (!user) return null;
  if (userId && user.id !== userId) {
    throw new Error("Student identity user mismatch");
  }
  const hit = identityCache;
  if (hit && hit.userId === user.id && Date.now() - hit.at < IDENTITY_TTL_MS) return hit.promise;
  const promise = fetchStudentAcademicIdentity(user);
  identityCache = { userId: user.id, at: Date.now(), promise };
  const forget = () => {
    if (identityCache?.promise === promise) identityCache = null;
  };
  promise.then((loaded) => { if (!loaded?.studentId) forget(); }, forget);
  return promise;
}

/**
 * Load student identity via SECURITY DEFINER RPC when available.
 * Falls back to direct table reads for envs that have not applied the migration yet.
 */
async function fetchStudentAcademicIdentity(
  user: { id: string },
): Promise<StudentAcademicIdentity | null> {
  // Prefer SSOT RPC (applies link_portal + class join as definer).
  const { data: rpcData, error: rpcError } = await (supabase.rpc as any)(
    "rpc_get_my_student_identity",
  );
  if (!rpcError && Array.isArray(rpcData) && rpcData.length > 0) {
    // The RPC answers with the whole identity, exam included, since
    // 20261047000000 (applied 2026-09-23). It is read here and nowhere else:
    // while that migration was pending this branch re-read schools and
    // exam_accounts itself to fill school_kind and the exam, which gave "which
    // exam is this account" a second home and cost every individual two extra
    // round trips on an identity the RPC had already answered. The fallback
    // below still reads those tables, because it runs only where the RPC
    // answers nothing at all.
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
      schoolKind: parseSchoolKind(row.school_kind),
      examId: row.exam_id ?? null,
      examCode: row.exam_code ?? null,
      examName: row.exam_name ?? null,
    };
  }

  // Fallback path (pre-migration): mirror Auth bootstrap + students/classes reads.
  try {
    await supabase.rpc("link_portal_on_auth", { _uid: user.id });
  } catch {
    /* optional */
  }
  // `ensure_default_role` was called here and is GONE as of 20260906020000.
  //
  // It inserted `(auth.uid(), 'student')` into `public.user_roles` for any
  // authenticated caller holding no role. That table has been read-only at the
  // table level since Chunk 1.5, so the call raised on every student context
  // resolution; and under memberships the function was incoherent anyway, since
  // a membership requires an institution and this named none. Removed rather
  // than logged: there is no longer a function to call.
  //
  // Nothing downstream depended on it. Roles come from `memberships`.

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

  let schoolKind: SchoolKind | null = null;
  let examId: string | null = null;
  let examCode: string | null = null;
  let examName: string | null = null;
  if (schoolId) {
    const { data: sch, error: schErr } = await supabase
      .from("schools")
      .select("kind")
      .eq("id", schoolId)
      .maybeSingle();
    if (schErr) console.warn("[resolveStudentContext] schools.kind lookup failed:", schErr.message);
    schoolKind = parseSchoolKind(sch?.kind);
    if (schoolKind === "individual") {
      const { data: ea, error: eaErr } = await supabase
        .from("exam_accounts")
        .select("exam_id, competitive_exams(code, name)")
        .eq("school_id", schoolId)
        .maybeSingle();
      if (eaErr) console.warn("[resolveStudentContext] exam_accounts lookup failed:", eaErr.message);
      examId = ea?.exam_id ?? null;
      type ExamJoin = { code?: string | null; name?: string | null };
      const rawExam = (ea as { competitive_exams?: ExamJoin | ExamJoin[] | null } | null)?.competitive_exams;
      const exam = Array.isArray(rawExam) ? rawExam[0] : rawExam;
      examCode = exam?.code ?? null;
      examName = exam?.name ?? null;
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
    schoolKind,
    examId,
    examCode,
    examName,
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
