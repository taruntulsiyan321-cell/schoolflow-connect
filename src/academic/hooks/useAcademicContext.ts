import { useMemo } from "react";
import { useAuth } from "@/auth";
import type { ServiceContext } from "@/academic";
import { DEFAULT_SCHOOL_ID } from "@/auth/constants";

/**
 * Build ServiceContext from the authenticated session.
 * Use this in every panel that calls Academic Engine services.
 */
export function useAcademicContext(): {
  ctx: ServiceContext | null;
  ready: boolean;
  schoolId: string | null;
} {
  const { user, role, schoolId, loading, status } = useAuth();

  const ctx = useMemo<ServiceContext | null>(() => {
    if (!user?.id || !role) return null;
    return {
      schoolId: schoolId ?? DEFAULT_SCHOOL_ID,
      userId: user.id,
      role,
    };
  }, [user?.id, role, schoolId]);

  return {
    ctx,
    ready: !loading && status !== "loading" && !!ctx,
    schoolId: schoolId ?? null,
  };
}
