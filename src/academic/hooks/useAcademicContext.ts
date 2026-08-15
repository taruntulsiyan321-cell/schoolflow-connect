import { useEffect, useMemo, useRef, useState } from "react";
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
 *
 * Student class/identity is sticky: transient load failures keep the last good
 * identity so class is never wiped across refresh/navigation glitches.
 */
export function useAcademicContext(): {
  ctx: ServiceContext | null;
  /** Auth + identity finished; may still lack school ctx. */
  settled: boolean;
  /** Settled and ServiceContext is available. */
  ready: boolean;
  schoolId: string | null;
  studentId: string | null;
  classId: string | null;
  classLabel: string | null;
  identity: StudentAcademicIdentity | null;
  /** Set when the most recent identity load threw; cleared on the next success. */
  identityError: Error | null;
} {
  const { user, role, schoolId: authSchoolId, loading, status } = useAuth();
  const [identity, setIdentity] = useState<StudentAcademicIdentity | null>(null);
  const [identityReady, setIdentityReady] = useState(false);
  const [identityError, setIdentityError] = useState<Error | null>(null);
  const lastGoodIdentity = useRef<StudentAcademicIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !role) {
        if (!cancelled) {
          lastGoodIdentity.current = null;
          setIdentity(null);
          setIdentityReady(false);
          setIdentityError(null);
        }
        return;
      }
      try {
        const loaded = await loadStudentAcademicIdentity(user.id);
        if (!cancelled) {
          if (loaded?.studentId) {
            lastGoodIdentity.current = loaded;
          }
          setIdentity(loaded ?? lastGoodIdentity.current);
          setIdentityReady(true);
          setIdentityError(null);
        }
      } catch (err) {
        if (!cancelled) {
          // Keep last good identity — do not wipe class/school on soft failure.
          setIdentity(lastGoodIdentity.current);
          // Always settle (even with no prior identity) so a transient failure
          // on the very first load can't leave the portal spinning forever —
          // `identityError` lets callers distinguish this from a real "ready".
          setIdentityReady(true);
          setIdentityError(
            err instanceof Error ? err : new Error("Could not load student identity"),
          );
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
  const classCategory = identity?.classCategory ?? null;
  // Student portal access is distinct from global Auth role priority: a user can
  // legitimately be both teacher and student. The identity RPC verifies the
  // linked student row plus user_roles.student before this becomes "student".
  const studentPortalRole =
    identity?.studentId &&
    (identity.role === "student" || identity.hasStudentRole)
      ? "student"
      : null;
  const effectiveRole = studentPortalRole ?? role;
  // Prefer portal-bound school (students.school_id) over profile fallback — never invent a tenant.
  const schoolId =
    (studentPortalRole ? identity?.schoolId : null) || authSchoolId || null;

  const ctx = useMemo<ServiceContext | null>(() => {
    if (!user?.id || !effectiveRole || !schoolId) return null;
    // Pure student shell must wait for linked student row (class may still be null).
    if (role === "student" && !studentId) return null;
    return {
      schoolId,
      userId: user.id,
      role: effectiveRole,
      studentId,
      classId,
      classLabel,
      classCategory,
    };
  }, [user?.id, effectiveRole, role, schoolId, studentId, classId, classLabel, classCategory]);

  const settled = !loading && status !== "loading" && identityReady;

  return {
    ctx,
    settled,
    ready: settled && !!ctx,
    schoolId,
    studentId,
    classId,
    classLabel,
    identity,
    identityError,
  };
}
