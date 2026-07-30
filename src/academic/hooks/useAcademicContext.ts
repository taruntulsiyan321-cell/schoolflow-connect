import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth";
import type { ServiceContext } from "@/academic";
import { DEFAULT_SCHOOL_ID } from "@/auth/constants";
import { supabase } from "@/integrations/supabase/client";

/**
 * Build ServiceContext from the authenticated session.
 * For students, also resolves `studentId` from the students table.
 */
export function useAcademicContext(): {
  ctx: ServiceContext | null;
  ready: boolean;
  schoolId: string | null;
  studentId: string | null;
  classId: string | null;
} {
  const { user, role, schoolId, loading, status } = useAuth();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [identityReady, setIdentityReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !role) {
        if (!cancelled) {
          setStudentId(null);
          setClassId(null);
          setIdentityReady(false);
        }
        return;
      }
      if (role !== "student") {
        if (!cancelled) {
          setStudentId(null);
          setClassId(null);
          setIdentityReady(true);
        }
        return;
      }
      const { data } = await supabase
        .from("students")
        .select("id, class_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setStudentId(data?.id ?? null);
        setClassId(data?.class_id ?? null);
        setIdentityReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  const ctx = useMemo<ServiceContext | null>(() => {
    if (!user?.id || !role) return null;
    return {
      schoolId: schoolId ?? DEFAULT_SCHOOL_ID,
      userId: user.id,
      role,
      studentId,
    };
  }, [user?.id, role, schoolId, studentId]);

  return {
    ctx,
    ready: !loading && status !== "loading" && !!ctx && identityReady,
    schoolId: schoolId ?? null,
    studentId,
    classId,
  };
}
