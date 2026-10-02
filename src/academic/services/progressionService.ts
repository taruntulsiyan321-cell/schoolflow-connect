/**
 * ProgressionService — Academic Progression Engine facade.
 * All XP/level/league/reputation mutations go through SQL RPCs.
 * UI must never invent progression numbers.
 *
 * The live app is the individual student panel (2026-10-01). The awards
 * (called by attendance, battles and tests), the parent/teacher student
 * lookup, the teacher class insights, the class leaderboard and the battle XP
 * notifier went with the school side to the `organisation` branch.
 */

import {
  assertCanConsume,
  assertCanOwn,
  toRepoContext,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { broadcastAcademicWrite } from "../live";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";

export type ProgressionSnapshot = {
  user_id: string;
  xp: number;
  level: number;
  xp_into_level: number;
  xp_to_next_level: number;
  level_progress_pct: number;
  league: {
    code: string;
    label: string;
    tier: number;
    min_xp: number;
    demote_below_xp: number | null;
    color_token: string | null;
  } | null;
  next_league: {
    code: string;
    label: string;
    tier: number;
    min_xp: number;
    remaining: number;
  } | null;
  highest_league: string;
  demotion_warning_at: string | null;
  reputation: number;
  study_streak: number;
  study_longest_streak: number;
  study_week_streak: number;
  study_month_streak: number;
  streak_protection_tokens: number;
  featured_badges: string[];
  equipped_badge: string | null;
  badges: Array<{ badge_code: string; tier: string; earned_at: string }>;
  achievements: Array<{
    code: string;
    earned_at: string;
    label: string;
    description: string | null;
    rarity: string;
  }>;
  battleground: {
    total_battles: number;
    wins: number;
    win_streak: number;
    best_win_streak: number;
    best_score: number;
    total_correct: number;
    total_answered: number;
  };
  counts: {
    /**
     * Private to the student (locked decision 10.16). rpc_get_student_progression
     * omits these keys entirely for a parent, teacher, principal or admin caller,
     * so they are optional — and MUST NOT be defaulted to 0, because 0 reads as
     * "did no practice" rather than "not yours to see" (G4).
     */
    practice_sessions?: number;
    homework_submitted: number;
    ai_sessions?: number;
  };
};

const EMPTY_SNAPSHOT = (userId: string): ProgressionSnapshot => ({
  user_id: userId,
  xp: 0,
  level: 1,
  xp_into_level: 0,
  xp_to_next_level: 100,
  level_progress_pct: 0,
  league: {
    code: "bronze",
    label: "Bronze",
    tier: 1,
    min_xp: 0,
    demote_below_xp: null,
    color_token: "tier-bronze",
  },
  next_league: {
    code: "silver",
    label: "Silver",
    tier: 2,
    min_xp: 300,
    remaining: 300,
  },
  highest_league: "bronze",
  demotion_warning_at: null,
  reputation: 0,
  study_streak: 0,
  study_longest_streak: 0,
  study_week_streak: 0,
  study_month_streak: 0,
  streak_protection_tokens: 0,
  featured_badges: [],
  equipped_badge: null,
  badges: [],
  achievements: [],
  battleground: {
    total_battles: 0,
    wins: 0,
    win_streak: 0,
    best_win_streak: 0,
    best_score: 0,
    total_correct: 0,
    total_answered: 0,
  },
  counts: {
    homework_submitted: 0,
  },
});

function afterProgressionWrite(
  ctx: ServiceContext,
  source: string,
  studentId?: string | null,
) {
  broadcastAcademicWrite(ctx.schoolId, ["xp", "achievements", "profile"], {
    studentId: studentId ?? ctx.studentId,
    source,
  });
  notifyStudentXpUpdated();
}

/**
 * ProgressionService — the student's progression snapshot and featured badges.
 */
export const ProgressionService = {
  /** The signed-in student's full progression snapshot. */
  async getSnapshot(
    ctx: ServiceContext,
    userId?: string | null,
  ): Promise<ProgressionSnapshot> {
    assertCanConsume(ctx, "student_xp");
    const uid = userId ?? ctx.userId;
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_get_student_progression",
      { _user_id: uid } as never,
    );
    throwIfError(error, "Failed to load progression");
    if (!data || typeof data !== "object") return EMPTY_SNAPSHOT(uid);
    const snap = data as ProgressionSnapshot;
    return {
      ...EMPTY_SNAPSHOT(uid),
      ...snap,
      featured_badges: Array.isArray(snap.featured_badges) ? snap.featured_badges : [],
      badges: Array.isArray(snap.badges) ? snap.badges : [],
      achievements: Array.isArray(snap.achievements) ? snap.achievements : [],
    };
  },

  async setFeaturedBadges(ctx: ServiceContext, badges: string[]): Promise<void> {
    assertCanOwn(ctx, "student_xp");
    const { error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_set_featured_badges",
      { _badges: badges } as never,
    );
    throwIfError(error, "Failed to set featured badges");
    afterProgressionWrite(ctx, "ProgressionService.setFeaturedBadges");
  },

  async listHistory(
    ctx: ServiceContext,
    opts?: { limit?: number; userId?: string | null },
  ) {
    assertCanConsume(ctx, "student_xp");
    const uid = opts?.userId ?? ctx.userId;
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("progression_history")
      .select(
        "id, rule_code, direction, xp_delta, reputation_delta, xp_after, level_after, league_after, source_type, source_id, reason, created_at",
      )
      .eq("user_id", uid)
      .order("created_at", { ascending: false })
      .limit(opts?.limit ?? 40);
    throwIfError(error, "Failed to load progression history");
    return data ?? [];
  },

  async listAchievements(ctx: ServiceContext, userId?: string | null) {
    assertCanConsume(ctx, "student_badge");
    const snap = await this.getSnapshot(ctx, userId);
    return snap.achievements;
  },

  /** List enabled XP rules (config). */
  async listRules(ctx: ServiceContext) {
    assertCanConsume(ctx, "student_xp");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("progression_xp_rules")
      .select("code, label, direction, amount, reputation_delta, category, enabled")
      .eq("enabled", true)
      .order("category");
    throwIfError(error, "Failed to load XP rules");
    return data ?? [];
  },

  /** List league ladder (config). */
  async listLeagues(ctx: ServiceContext) {
    assertCanConsume(ctx, "student_xp");
    const { data, error } = await getClient(toRepoContext(ctx))
      .from("progression_leagues")
      .select("code, label, tier, min_xp, demote_below_xp, color_token")
      .order("tier");
    throwIfError(error, "Failed to load leagues");
    return data ?? [];
  },
};
