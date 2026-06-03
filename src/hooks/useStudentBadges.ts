import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export type EarnedBadge = {
  badge_code: string;
  tier: string;
  earned_at: string;
};

export function useStudentBadges(userId: string | undefined) {
  const [earned, setEarned] = useState<EarnedBadge[]>([]);
  const [equipped, setEquipped] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const reload = useCallback(async () => {
    if (!userId) {
      setEarned([]);
      setEquipped(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    const [{ data: badges }, { data: xp }] = await Promise.all([
      supabase.from("student_badges").select("badge_code, tier, earned_at").eq("user_id", userId).order("earned_at", { ascending: false }),
      supabase.from("student_xp").select("equipped_badge").eq("user_id", userId).maybeSingle(),
    ]);
    setEarned((badges as EarnedBadge[]) ?? []);
    setEquipped(xp?.equipped_badge ?? null);
    setLoading(false);
  }, [userId]);

  useEffect(() => {
    reload();
  }, [reload]);

  const equip = async (badgeCode: string | null) => {
    if (!userId) return;
    if (badgeCode) {
      const owns = earned.some((b) => b.badge_code === badgeCode);
      if (!owns) {
        toast.error("You can only equip badges you have earned.");
        return;
      }
    }
    setSaving(true);
    const { data: row } = await supabase.from("student_xp").select("user_id").eq("user_id", userId).maybeSingle();
    const payload = { equipped_badge: badgeCode };
    const { error } = row
      ? await supabase.from("student_xp").update(payload).eq("user_id", userId)
      : await supabase.from("student_xp").insert({ user_id: userId, xp: 0, level: 1, ...payload });
    setSaving(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    setEquipped(badgeCode);
    toast.success(badgeCode ? "Badge equipped — visible to your class." : "Badge unequipped.");
  };

  return { earned, equipped, loading, saving, equip, reload };
}

/** Batch-load public equipped badges for classmates / leaderboards. */
export async function fetchEquippedBadgesByUserIds(userIds: string[]): Promise<Record<string, string | null>> {
  const unique = [...new Set(userIds.filter(Boolean))];
  if (!unique.length) return {};
  const { data } = await supabase.from("student_xp").select("user_id, equipped_badge").in("user_id", unique);
  const map: Record<string, string | null> = {};
  unique.forEach((id) => { map[id] = null; });
  (data ?? []).forEach((r) => { map[r.user_id] = r.equipped_badge; });
  return map;
}
