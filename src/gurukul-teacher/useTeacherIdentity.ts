import { useCallback, useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import type { TeacherProfile } from "./data";

export type TeacherIdentity = TeacherProfile & {
  teacherRowId: string | null;
  linked: boolean;
  loading: boolean;
  error: string | null;
  reload: () => Promise<void>;
};

const EMPTY: TeacherProfile = {
  id: "",
  name: "",
  employeeId: "",
  email: "",
  phone: "",
  department: "",
  subjects: [],
  qualification: "",
  joinedDate: "",
  address: "",
  gender: "female",
  isClassTeacher: false,
  classTeacherOf: null,
  googleLinked: false,
  googleEmail: "",
  mobileLinked: false,
};

function initialsFrom(name: string) {
  return name
    .split(/\s+/)
    .filter((w) => w.length > 0)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

export function teacherInitials(name: string, fallback = "?") {
  return initialsFrom(name) || fallback;
}

/**
 * Live teacher identity from `profiles` + `teachers` + `teacher_classes`.
 * Replaces mock `teacherProfile` for shell chrome and Profile page.
 */
export function useTeacherIdentity(): TeacherIdentity {
  const { user } = useAuth();
  const [profile, setProfile] = useState<TeacherProfile>(EMPTY);
  const [teacherRowId, setTeacherRowId] = useState<string | null>(null);
  const [linked, setLinked] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    if (!user?.id) {
      setProfile(EMPTY);
      setTeacherRowId(null);
      setLinked(false);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const [{ data: p }, { data: t }] = await Promise.all([
        supabase.from("profiles").select("*").eq("id", user.id).maybeSingle(),
        supabase.from("teachers").select("*").eq("user_id", user.id).maybeSingle(),
      ]);

      let classTeacherOf: TeacherProfile["classTeacherOf"] = null;
      let subjects: string[] = [];

      if (t) {
        if (t.class_teacher_of) {
          const { data: c, error: classErr } = await supabase
            .from("classes")
            .select("name, section")
            .eq("id", t.class_teacher_of)
            .maybeSingle();
          if (classErr) throw classErr;
          if (c) classTeacherOf = { className: c.name, section: c.section };
        }
        const { data: tc, error: tcErr } = await supabase
          .from("teacher_classes")
          .select("subject")
          .eq("teacher_id", t.id);
        if (tcErr) throw tcErr;
        const fromAssignments = [
          ...new Set(
            (tc ?? [])
              .map((r) => String(r.subject ?? "").trim())
              .filter(Boolean),
          ),
        ];
        if (fromAssignments.length) subjects = fromAssignments;
        else if (t.subject) subjects = [t.subject];
      }

      const name =
        (t?.full_name || p?.full_name || user.email || "Teacher").trim() || "Teacher";
      const email = (t?.email || p?.email || user.email || "").trim();
      const phone = (t?.mobile || p?.phone || "").trim();
      const googleEmail =
        typeof user.app_metadata?.provider === "string" &&
        user.app_metadata.provider === "google"
          ? email
          : "";

      setTeacherRowId(t?.id ?? null);
      setLinked(Boolean(t));
      setProfile({
        id: t?.id ?? user.id,
        name,
        employeeId: t?.employee_id ?? "—",
        email,
        phone,
        department: t?.department ?? "—",
        subjects,
        qualification: t?.qualification ?? "",
        joinedDate: t?.joining_date ?? "",
        address: t?.address ?? "",
        gender: "female",
        isClassTeacher: Boolean(t?.is_class_teacher && classTeacherOf),
        classTeacherOf,
        googleLinked: Boolean(googleEmail),
        googleEmail,
        mobileLinked: Boolean(phone),
      });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load teacher profile");
      setProfile({
        ...EMPTY,
        name: user.email ?? "Teacher",
        email: user.email ?? "",
        employeeId: "—",
      });
      setLinked(false);
      setTeacherRowId(null);
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Stable reference unless one of these actually changes — without this, every
  // consumer that puts this hook's return value in a useEffect/useMemo dependency
  // array (e.g. Profile.tsx) gets a "new" identity object on every render even
  // when nothing changed, since object-literal returns are never referentially
  // equal across renders otherwise. That triggers an infinite render loop:
  // effect sees a "new" identity -> setState -> re-render -> new identity object
  // again -> effect fires again. Confirmed live (React's own "Maximum update
  // depth exceeded" loop-detector was firing on the Teacher Profile page).
  return useMemo(
    () => ({
      ...profile,
      teacherRowId,
      linked,
      loading,
      error,
      reload,
    }),
    [profile, teacherRowId, linked, loading, error, reload],
  );
}
