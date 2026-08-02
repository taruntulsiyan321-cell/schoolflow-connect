import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth";
import type { ServiceContext } from "@/academic";
import {
  loadStudentAcademicIdentity,
  type StudentAcademicIdentity,
} from "@/academic/services/resolveStudentContext";

/**
 * Build ServiceContext from the authenticated session.
 * For students, resolves studentId + classId + tenant school_id via the same
 * identity loader as `resolveStudentServiceContext` (Home and Practice share SSOT).
 */
export function useAcademicContext(): {
  ctx: ServiceContext | null;
  ready: boolean;
  schoolId: string | null;
  studentId: string | null;
  classId: string | null;
  classLabel: string | null;
  identity: StudentAcademicIdentity | null;
} {
  const { user, role, schoolId: authSchoolId, loading, status } = useAuth();
  const [identity, setIdentity] = useState<StudentAcademicIdentity | null>(null);
  const [identityReady, setIdentityReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !role) {
        if (!cancelled) {
          setIdentity(null);
          setIdentityReady(false);
        }
        return;
      }
      if (role !== "student") {
        if (!cancelled) {
          setIdentity(null);
          setIdentityReady(true);
        }
        return;
      }
      try {
        const loaded = await loadStudentAcademicIdentity(user.id);
        if (!cancelled) {
          setIdentity(loaded);
          setIdentityReady(true);
        }
      } catch {
        if (!cancelled) {
          setIdentity(null);
          setIdentityReady(true);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  const studentId = identity?.studentId ?? null;
  const classId = identity?.classId ?? null;
  const classLabel = identity?.classLabel ?? null;
  // Prefer portal-bound school (students.school_id) over profile fallback — never invent a tenant.
  const schoolId =
    (role === "student" ? identity?.schoolId : null) || authSchoolId || null;

  const ctx = useMemo<ServiceContext | null>(() => {
    if (!user?.id || !role || !schoolId) return null;
    return {
      schoolId,
      userId: user.id,
      role,
      studentId,
      classId,
      classLabel,
    };
  }, [user?.id, role, schoolId, studentId, classId, classLabel]);

  return {
    ctx,
    ready: !loading && status !== "loading" && !!ctx && identityReady,
    schoolId,
    studentId,
    classId,
    classLabel,
    identity,
  };
}
