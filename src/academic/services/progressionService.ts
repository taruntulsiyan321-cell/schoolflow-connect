/**
 * ProgressionService — Academic Progression Engine facade.
 * All XP/level/league/reputation mutations go through SQL RPCs.
 * UI must never invent progression numbers.
 */

import {
  assertCanConsume,
  assertCanOwn,
  isSchoolOperator,
  toRepoContext,
  ForbiddenError,
  type ServiceContext,
} from "./context";
import { getClient, throwIfError } from "../repository/base";
import { emitEvent } from "../repository/eventsRepository";
import { broadcastAcademicWrite } from "../live";
import { notifyStudentXpUpdated } from "@/lib/studentXpNotify";
import { assertMayAccessStudent } from "./parentAccess";

export type ProgressionApplyResult = {
  applied: boolean;
  duplicate: boolean;
  history_id?: string;
  xp_delta?: number;
  xp: number;
  level: number;
  league: string;
  reputation: number;
  xp_to_next_level?: number;
  progress_pct?: number;
};

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
    practice_sessions: number;
    homework_submitted: number;
    ai_sessions: number;
  };
};

export type TeacherProgressionInsights = {
  top_xp: Array<{
    student_id: string;
    full_name: string;
    xp: number;
    level: number;
    league: string;
  }>;
  improvers: Array<{
    student_id: string;
    full_name: string;
    xp_gained_7d: number;
  }>;
  inactive: Array<{
    student_id: string;
    full_name: string;
    last_activity_at: string | null;
  }>;
  consistent_practicers: Array<{
    student_id: string;
    full_name: string;
    study_streak: number;
    practice_sessions: number;
  }>;
  class_engagement: {
    students: number;
    with_xp: number;
    avg_xp: number;
    avg_streak: number;
    avg_reputation: number;
    practice_rate: number;
    homework_rate: number;
  } | null;
};

export type ProgressionLeaderboard = {
  scope: string;
  period: string;
  metric: string;
  subject: string | null;
  rows: Array<{
    user_id: string;
    name: string;
    value: number;
    level: number;
    league: string;
  }>;
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
    practice_sessions: 0,
    homework_submitted: 0,
    ai_sessions: 0,
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
 * ProgressionService — single entry for awards, snapshots, leaderboards, insights.
 */
export const ProgressionService = {
  /**
   * Apply a configured XP rule (award or controlled deduction).
   * Idempotent when idempotencyKey is provided.
   */
  async apply(
    ctx: ServiceContext,
    args: {
      ruleCode: string;
      sourceType?: string | null;
      sourceId?: string | null;
      idempotencyKey?: string | null;
      amountOverride?: number | null;
      meta?: Record<string, unknown>;
      targetUserId?: string | null;
    },
  ): Promise<ProgressionApplyResult> {
    const targetingOther =
      !!args.targetUserId && args.targetUserId !== ctx.userId;
    if (targetingOther) {
      // Teachers/operators may award controlled rules (e.g. attendance) for students.
      if (!isSchoolOperator(ctx.role) && ctx.role !== "teacher") {
        throw new ForbiddenError("Not authorized to award progression for another user");
      }
      assertCanConsume(ctx, "student_xp");
    } else {
      assertCanOwn(ctx, "student_xp");
    }
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_apply_progression",
      {
        _rule_code: args.ruleCode,
        _source_type: args.sourceType ?? null,
        _source_id: args.sourceId ?? null,
        _idempotency_key: args.idempotencyKey ?? null,
        _amount_override: args.amountOverride ?? null,
        _meta: args.meta ?? {},
        _target_user_id: args.targetUserId ?? null,
      } as never,
    );
    throwIfError(error, "Failed to apply progression");
    afterProgressionWrite(ctx, `ProgressionService.apply:${args.ruleCode}`);
    return data as ProgressionApplyResult;
  },

  /** Full progression snapshot for self / linked child / class student. */
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

  /** Parent/teacher path: resolve student → user_id then snapshot. */
  async getForStudent(
    ctx: ServiceContext,
    studentId: string,
  ): Promise<ProgressionSnapshot> {
    assertCanConsume(ctx, "student_xp");
    await assertMayAccessStudent(ctx, studentId);
    const { data: stu, error } = await getClient(toRepoContext(ctx))
      .from("students")
      .select("user_id")
      .eq("id", studentId)
      .maybeSingle();
    throwIfError(error, "Failed to resolve student for progression");
    if (!stu?.user_id) return EMPTY_SNAPSHOT("");
    return this.getSnapshot(ctx, stu.user_id);
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

  async teacherClassInsights(
    ctx: ServiceContext,
    classId: string,
  ): Promise<TeacherProgressionInsights> {
    assertCanConsume(ctx, "student_xp");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_teacher_class_progression_insights",
      { _class_id: classId } as never,
    );
    throwIfError(error, "Failed to load class progression insights");
    const raw = (data ?? {}) as TeacherProgressionInsights;
    return {
      top_xp: Array.isArray(raw.top_xp) ? raw.top_xp : [],
      improvers: Array.isArray(raw.improvers) ? raw.improvers : [],
      inactive: Array.isArray(raw.inactive) ? raw.inactive : [],
      consistent_practicers: Array.isArray(raw.consistent_practicers)
        ? raw.consistent_practicers
        : [],
      class_engagement: raw.class_engagement ?? null,
    };
  },

  async leaderboard(
    ctx: ServiceContext,
    opts?: {
      scope?: string;
      period?: string;
      metric?: string;
      subject?: string | null;
      limit?: number;
    },
  ): Promise<ProgressionLeaderboard> {
    assertCanConsume(ctx, "student_xp");
    const { data, error } = await getClient(toRepoContext(ctx)).rpc(
      "rpc_progression_leaderboard",
      {
        _scope: opts?.scope ?? "class",
        _period: opts?.period ?? "weekly",
        _metric: opts?.metric ?? "xp",
        _subject: opts?.subject ?? null,
        _limit: opts?.limit ?? 50,
      } as never,
    );
    throwIfError(error, "Failed to load progression leaderboard");
    const raw = (data ?? {}) as ProgressionLeaderboard;
    return {
      scope: raw.scope ?? opts?.scope ?? "class",
      period: raw.period ?? opts?.period ?? "weekly",
      metric: raw.metric ?? opts?.metric ?? "xp",
      subject: raw.subject ?? null,
      rows: Array.isArray(raw.rows) ? raw.rows : [],
    };
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

  /**
   * Hook helpers — call from domain services after academic activities.
   * Failures are swallowed so producers stay resilient; live bus still refreshes.
   */
  async awardSafe(
    ctx: ServiceContext,
    args: {
      ruleCode: string;
      sourceType?: string | null;
      sourceId?: string | null;
      idempotencyKey?: string | null;
      amountOverride?: number | null;
      meta?: Record<string, unknown>;
      targetUserId?: string | null;
    },
  ): Promise<ProgressionApplyResult | null> {
    try {
      return await this.apply(ctx, args);
    } catch (e) {
      console.warn("ProgressionService.awardSafe:", e);
      return null;
    }
  },

  /** Emit progression.synced for Nova / analytics after external XP mutation (e.g. battle). */
  async notifyExternalXpChange(
    ctx: ServiceContext,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await emitEvent(toRepoContext(ctx), {
      eventType: "xp.updated",
      entityType: "student_xp",
      entityId: null,
      studentId: ctx.studentId ?? null,
      payload,
    }).catch(() => undefined);
    afterProgressionWrite(ctx, "ProgressionService.notifyExternalXpChange");
  },
};

export { EMPTY_SNAPSHOT as emptyProgressionSnapshot };
