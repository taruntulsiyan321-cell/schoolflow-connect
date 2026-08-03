import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import {
  BadgeService,
  resolveStudentServiceContext,
  useAcademicLive,
  type EarnedBadgeRow,
} from "@/academic";
import { useInitialLoadGate } from "@/hooks/useInitialLoadGate";

export type EarnedBadge = EarnedBadgeRow;

export function useStudentBadges(userId: string | undefined) {
  const liveVersion = useAcademicLive(["achievements", "xp"]);
  const [earned, setEarned] = useState<EarnedBadge[]>([]);
  const [equipped, setEquipped] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { beginLoading, endLoading, showLoading } = useInitialLoadGate();

  const reload = useCallback(async () => {
    if (!userId) {
      setEarned([]);
      setEquipped(null);
      endLoading(setLoading);
      return;
    }
    beginLoading(setLoading);
    try {
      const ctx = await resolveStudentServiceContext();
      const { earned: list, equipped: eq } = await BadgeService.listWithEquipped(ctx, userId);
      setEarned(list);
      setEquipped(eq);
    } catch (err) {
      setEarned([]);
      setEquipped(null);
      toast.error(err instanceof Error ? err.message : "Could not load badges");
    } finally {
      endLoading(setLoading);
    }
  }, [userId, beginLoading, endLoading]);

  useEffect(() => {
    void reload();
  }, [reload, liveVersion]);

  const equip = async (badgeCode: string | null) => {
    if (!userId) return;
    setSaving(true);
    try {
      const ctx = await resolveStudentServiceContext();
      await BadgeService.equip(ctx, badgeCode);
      setEquipped(badgeCode);
      toast.success(badgeCode ? "Badge equipped — visible to your class." : "Badge unequipped.");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Could not equip badge");
    } finally {
      setSaving(false);
    }
  };

  return { earned, equipped, loading: showLoading(loading), saving, equip, reload };
}

/** Batch-load public equipped badges for classmates / leaderboards. */
export async function fetchEquippedBadgesByUserIds(
  userIds: string[],
): Promise<Record<string, string | null>> {
  try {
    const ctx = await resolveStudentServiceContext();
    const { XpService } = await import("@/academic");
    return XpService.getEquippedByUserIds(ctx, userIds);
  } catch {
    return {};
  }
}
