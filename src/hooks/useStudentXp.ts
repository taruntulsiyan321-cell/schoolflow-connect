import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";

export type StudentXpRow = {
  xp: number;
  level: number;
  current_streak?: number;
  longest_streak?: number;
  total_battles?: number;
  wins?: number;
  equipped_badge?: string | null;
};

export function useStudentXp() {
  const { user } = useAuth();
  const [xp, setXp] = useState<StudentXpRow>({ xp: 0, level: 1 });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    const { data } = await supabase.from("student_xp").select("*").eq("user_id", user.id).maybeSingle();
    if (data) setXp(data as StudentXpRow);
    setLoading(false);
  }, [user]);

  useEffect(() => {
    reload();
  }, [reload]);

  useEffect(() => {
    const onUpdate = () => reload();
    window.addEventListener("student-xp-updated", onUpdate);
    return () => window.removeEventListener("student-xp-updated", onUpdate);
  }, [reload]);

  return { xp, loading, reload };
}

export function notifyStudentXpUpdated() {
  window.dispatchEvent(new Event("student-xp-updated"));
}
