import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { useAuth } from "@/hooks/useAuth";
import { useAcademicContext, ProgressionService, type StudentXpRow } from "@/academic";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";

export type { StudentXpRow };

export type StudentXpDisplay = StudentXpRow & {
  xp_into_level: number;
  xp_to_next_level: number;
  level_progress_pct: number;
  study_streak: number;
  reputation: number;
};

const EMPTY_XP = (userId = ""): StudentXpDisplay => ({
  user_id: userId,
  xp: 0,
  level: 1,
  current_streak: 0,
  longest_streak: 0,
  total_battles: 0,
  wins: 0,
  xp_into_level: 0,
  xp_to_next_level: 100,
  level_progress_pct: 0,
  study_streak: 0,
  reputation: 0,
});

/** Load XP display from ProgressionService — never invent level progress on the client. */
export function useStudentXp() {
  const { user } = useAuth();
  const { ctx, ready } = useAcademicContext();
  const [xp, setXp] = useState<StudentXpDisplay>(EMPTY_XP());
  const [loading, setLoading] = useState(true);

  const reload = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    try {
      if (ctx && ready) {
        const snap = await ProgressionService.getSnapshot(ctx, user.id);
        setXp({
          user_id: snap.user_id,
          xp: snap.xp,
          level: snap.level,
          current_streak: snap.study_streak, // legacy alias — prefer study_streak
          longest_streak: snap.study_longest_streak,
          total_battles: snap.battleground.total_battles,
          wins: snap.battleground.wins,
          win_streak: snap.battleground.win_streak,
          best_win_streak: snap.battleground.best_win_streak,
          total_correct: snap.battleground.total_correct,
          total_answered: snap.battleground.total_answered,
          best_score: snap.battleground.best_score,
          equipped_badge: snap.equipped_badge,
          featured_badges: snap.featured_badges,
          league_code: snap.league?.code ?? null,
          reputation: snap.reputation,
          study_streak: snap.study_streak,
          study_longest_streak: snap.study_longest_streak,
          xp_into_level: snap.xp_into_level,
          xp_to_next_level: snap.xp_to_next_level,
          level_progress_pct: snap.level_progress_pct,
        });
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
    if (!ready) return;
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
