import {
  assertCanConsume,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { XpService } from "./xpService";

export type EarnedBadgeRow = {
  badge_code: string;
  tier: string;
  earned_at: string;
};

/**
 * BadgeService — read earned badges; awards happen in SQL (_award_badge → badge.earned).
 * Equip goes through XpService (student_xp.equipped_badge).
 */
export const BadgeService = {
  async listEarned(ctx: ServiceContext, userId?: string | null): Promise<EarnedBadgeRow[]> {
    assertCanConsume(ctx, "student_badge");
    const uid = userId ?? ctx.userId;
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("student_badges")
      .select("badge_code, tier, earned_at")
      .eq("user_id", uid)
      .order("earned_at", { ascending: false });
    throwIfError(error, "Failed to load badges");
    return (data as EarnedBadgeRow[]) ?? [];
  },

  async listWithEquipped(
    ctx: ServiceContext,
    userId?: string | null,
  ): Promise<{ earned: EarnedBadgeRow[]; equipped: string | null }> {
    const uid = userId ?? ctx.userId;
    const [earned, equipped] = await Promise.all([
      this.listEarned(ctx, uid),
      XpService.getEquippedBadge(ctx, uid),
    ]);
    return { earned, equipped };
  },

  async equip(ctx: ServiceContext, badgeCode: string | null): Promise<void> {
    if (badgeCode) {
      const earned = await this.listEarned(ctx);
      if (!earned.some((b) => b.badge_code === badgeCode)) {
        throw new Error("You can only equip badges you have earned.");
      }
    }
    await XpService.setEquippedBadge(ctx, badgeCode);
  },
};
