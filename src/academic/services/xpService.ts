import {
  assertCanConsume,
  assertCanOwn,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";

export type StudentXpRow = {
  user_id: string;
  xp: number;
  level: number;
  current_streak: number;
  longest_streak: number;
  total_battles: number;
  wins: number;
  win_streak?: number;
  best_win_streak?: number;
  total_correct?: number;
  total_answered?: number;
  best_score?: number;
  equipped_badge?: string | null;
  last_battle_at?: string | null;
  updated_at?: string;
  league_code?: string | null;
  highest_league_code?: string | null;
  reputation?: number;
  study_streak?: number;
  study_longest_streak?: number;
  study_week_streak?: number;
  study_month_streak?: number;
  demotion_warning_at?: string | null;
  featured_badges?: string[] | null;
  streak_protection_tokens?: number;
};

/**
 * XpService — badge equip + batch equipped reads only.
 * XP / level / streak / league UI must use ProgressionService.getSnapshot /
 * ProgressionService.leaderboard (rpc_get_student_progression /
 * rpc_progression_leaderboard). Do not invent totals from raw student_xp.
 */
export const XpService = {
  /**
   * @deprecated Prefer ProgressionService.getSnapshot for XP/level/streak/league.
   * Kept for callers that need a flat row shape; delegates to ProgressionService.
   */
  async getForUser(ctx: ServiceContext, userId?: string | null): Promise<StudentXpRow | null> {
    assertCanConsume(ctx, "student_xp");
    const { ProgressionService } = await import("./progressionService");
    const snap = await ProgressionService.getSnapshot(ctx, userId);
    return {
      user_id: snap.user_id,
      xp: snap.xp,
      level: snap.level,
      current_streak: snap.battleground.win_streak,
      longest_streak: snap.battleground.best_win_streak,
      total_battles: snap.battleground.total_battles,
      wins: snap.battleground.wins,
      win_streak: snap.battleground.win_streak,
      best_win_streak: snap.battleground.best_win_streak,
      total_correct: snap.battleground.total_correct,
      total_answered: snap.battleground.total_answered,
      best_score: snap.battleground.best_score,
      equipped_badge: snap.equipped_badge,
      league_code: snap.league?.code ?? null,
      highest_league_code: snap.highest_league || null,
      reputation: snap.reputation,
      study_streak: snap.study_streak,
      study_longest_streak: snap.study_longest_streak,
      study_week_streak: snap.study_week_streak,
      study_month_streak: snap.study_month_streak,
      demotion_warning_at: snap.demotion_warning_at,
      featured_badges: snap.featured_badges,
      streak_protection_tokens: snap.streak_protection_tokens,
    };
  },

  async getEquippedBadge(ctx: ServiceContext, userId?: string | null): Promise<string | null> {
    assertCanConsume(ctx, "student_xp");
    const uid = userId ?? ctx.userId;
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("student_xp")
      .select("equipped_badge")
      .eq("user_id", uid)
      .maybeSingle();
    throwIfError(error, "Failed to load equipped badge");
    return data?.equipped_badge ?? null;
  },

  /** Batch public equipped badges for classmates / leaderboards. */
  async getEquippedByUserIds(
    ctx: ServiceContext,
    userIds: string[],
  ): Promise<Record<string, string | null>> {
    assertCanConsume(ctx, "student_xp");
    const unique = [...new Set(userIds.filter(Boolean))];
    const map: Record<string, string | null> = {};
    unique.forEach((id) => {
      map[id] = null;
    });
    if (!unique.length) return map;
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("student_xp")
      .select("user_id, equipped_badge")
      .in("user_id", unique);
    throwIfError(error, "Failed to load equipped badges");
    (data ?? []).forEach((r) => {
      map[r.user_id] = r.equipped_badge;
    });
    return map;
  },

  /**
   * Equip / unequip a badge the student already earned.
   * Does not invent XP or unlock badges.
   *
   * Goes through rpc_set_equipped_badge rather than writing the row. student_xp
   * carries no client write privilege any more (20260905000000_xp_engine_owned):
   * the update/insert that used to live here was the same door that let a
   * student set their own xp and reach rank 1 on both leaderboards. The RPC
   * re-checks that the badge was earned, so BadgeService.equip's check is now a
   * courtesy rather than the boundary.
   */
  async setEquippedBadge(ctx: ServiceContext, badgeCode: string | null): Promise<void> {
    assertCanOwn(ctx, "student_xp");
    const { error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_set_equipped_badge",
      { _badge_code: badgeCode } as never,
    );
    throwIfError(error, "Failed to equip badge");
    broadcastAcademicWrite(ctx.schoolId, ["achievements", "xp"], {
      studentId: ctx.studentId,
      source: "XpService.setEquippedBadge",
    });
    notifyStudentXpUpdated();
  },
};
