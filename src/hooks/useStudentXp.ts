import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, XpService, type StudentXpRow } from "@/academic";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";

export type { StudentXpRow };

const EMPTY_XP = (userId = ""): StudentXpRow => ({
  user_id: userId,
  xp: 0,
  level: 1,
  current_streak: 0,
  longest_streak: 0,
  total_battles: 0,
  wins: 0,
});

export function useStudentXp() {
  const { user } = useAuth();
  const { ctx, ready } = useAcademicContext();
  const [xp, setXp] = useState<StudentXpRow>(EMPTY_XP());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (ctx && ready) {
        const data = await XpService.getForUser(ctx, user.id);
        if (data) setXp(data);
        else setXp(EMPTY_XP(user.id));
      }
    } catch (e) {
      setXp(EMPTY_XP(user.id));
      toast.error(e instanceof Error ? e.message : "Could not load XP");
    } finally {
      setLoading(false);
    }
  }, [user, ctx, ready]);

  useEffect(() => {
    if (!user) {
      setXp(EMPTY_XP());
      setLoading(false);
      return;
    }
    if (!ready) return; // keep prior / loading until academic ctx ready — avoid zero flash
    void reload();
  }, [reload, user, ready]);

  useEffect(() => {
    const onUpdate = () => { void reload(); };
    window.addEventListener("student-xp-updated", onUpdate);
    return () => window.removeEventListener("student-xp-updated", onUpdate);
  }, [reload]);

  return { xp, loading, reload };
}

export { notifyStudentXpUpdated };
