import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, XpService, type StudentXpRow } from "@/academic";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";

export type { StudentXpRow };

export function useStudentXp() {
  const { user } = useAuth();
  const { ctx, ready } = useAcademicContext();
  const [xp, setXp] = useState<StudentXpRow>({
    user_id: "",
    xp: 0,
    level: 1,
    current_streak: 0,
    longest_streak: 0,
    total_battles: 0,
    wins: 0,
  });
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (ctx && ready) {
        const data = await XpService.getForUser(ctx, user.id);
        if (data) setXp(data);
        else {
          setXp({
            user_id: user.id,
            xp: 0,
            level: 1,
            current_streak: 0,
            longest_streak: 0,
            total_battles: 0,
            wins: 0,
          });
        }
      }
    } catch {
      setXp({
        user_id: user.id,
        xp: 0,
        level: 1,
        current_streak: 0,
        longest_streak: 0,
        total_battles: 0,
        wins: 0,
      });
    } finally {
      setLoading(false);
    }
  }, [user, ctx, ready]);

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

export { notifyStudentXpUpdated };
