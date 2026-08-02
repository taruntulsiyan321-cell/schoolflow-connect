import { useEffect, useMemo, useState } from "react";
import { useAuth } from "@/auth";
import type { ServiceContext } from "@/academic";
import { supabase } from "@/integrations/supabase/client";

/**
 * Build ServiceContext from the authenticated session.
 * For students, also resolves `studentId` + tenant `school_id` from the students table
 * so Academic Engine / Nova stay aligned with gateway actor resolution (no invented school).
 */
export function useAcademicContext(): {
  ctx: ServiceContext | null;
  ready: boolean;
  schoolId: string | null;
  studentId: string | null;
  classId: string | null;
} {
  const { user, role, schoolId: authSchoolId, loading, status } = useAuth();
  const [studentId, setStudentId] = useState<string | null>(null);
  const [classId, setClassId] = useState<string | null>(null);
  const [studentSchoolId, setStudentSchoolId] = useState<string | null>(null);
  const [identityReady, setIdentityReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!user?.id || !role) {
        if (!cancelled) {
          setStudentId(null);
          setClassId(null);
          setStudentSchoolId(null);
          setIdentityReady(false);
        }
        return;
      }
      if (role !== "student") {
        if (!cancelled) {
          setStudentId(null);
          setClassId(null);
          setStudentSchoolId(null);
          setIdentityReady(true);
        }
        return;
      }
      const { data } = await supabase
        .from("students")
        .select("id, class_id, school_id")
        .eq("user_id", user.id)
        .maybeSingle();
      if (!cancelled) {
        setStudentId(data?.id ?? null);
        setClassId(data?.class_id ?? null);
        setStudentSchoolId(data?.school_id ?? null);
        setIdentityReady(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [user?.id, role]);

  // Prefer portal-bound school (students.school_id) over profile fallback — never invent a tenant.
  const schoolId = (role === "student" ? studentSchoolId : null) || authSchoolId || null;

  const ctx = useMemo<ServiceContext | null>(() => {
    if (!user?.id || !role || !schoolId) return null;
    return {
      schoolId,
      userId: user.id,
      role,
      studentId,
    };
  }, [user?.id, role, schoolId, studentId]);

  return {
    ctx,
    ready: !loading && status !== "loading" && !!ctx && identityReady,
    schoolId,
    studentId,
    classId,
  };
}
