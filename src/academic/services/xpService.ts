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
 * XpService — read student experience; no arbitrary XP writes from the client.
 * Battle/practice RPCs own XP mutations; equip badge is the only intentional client write.
 */
export const XpService = {
  async getForUser(ctx: ServiceContext, userId?: string | null): Promise<StudentXpRow | null> {
    assertCanConsume(ctx, "student_xp");
    const uid = userId ?? ctx.userId;
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("student_xp")
      .select("*")
      .eq("user_id", uid)
      .maybeSingle();
    throwIfError(error, "Failed to load student XP");
    return (data as StudentXpRow | null) ?? null;
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
   */
  async setEquippedBadge(ctx: ServiceContext, badgeCode: string | null): Promise<void> {
    assertCanOwn(ctx, "student_xp");
    const client = getClient(toRepoContext(ctx));
    const { data: row, error: readErr } = await client
      .from("student_xp")
      .select("user_id")
      .eq("user_id", ctx.userId)
      .maybeSingle();
    throwIfError(readErr, "Failed to load XP row for equip");

    const payload = { equipped_badge: badgeCode };
    const { error } = row
      ? await client.from("student_xp").update(payload).eq("user_id", ctx.userId)
      : await client.from("student_xp").insert({
          user_id: ctx.userId,
          xp: 0,
          level: 1,
          ...payload,
        });
    throwIfError(error, "Failed to equip badge");
    broadcastAcademicWrite(ctx.schoolId, ["achievements", "xp"], {
      studentId: ctx.studentId,
      source: "XpService.setEquippedBadge",
    });
    notifyStudentXpUpdated();
  },
};
