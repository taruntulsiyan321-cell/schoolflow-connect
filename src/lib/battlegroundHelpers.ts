// Pure helpers for the Student Battleground — leagues, ratings, motivation
// copy and battle status labels. No network calls, no new services.
// League thresholds SSOT: academic/services/progressionMath (mirrors SQL).

import {
  PROGRESSION_LEAGUES,
  progressionLeagueFromCodeOrXp,
  progressionLeagueFromXp,
  progressionXpToNextLeague,
} from "@/academic/services/progressionMath";

export type League = {
  name: string;
  tier: number;
  colorClass: string;
  minXp: number;
};

const COLOR_BY_CODE: Record<string, string> = {
  bronze: "text-tier-bronze",
  silver: "text-tier-silver",
  gold: "text-tier-gold",
  platinum: "text-primary",
  diamond: "text-accent",
  master: "text-warning",
  champion: "text-warning",
  legend: "text-destructive",
  titan: "text-primary",
  nova: "text-accent",
};

function toUiLeague(def: { code: string; label: string; tier: number; minXp: number }): League {
  return {
    name: def.label,
    tier: def.tier,
    colorClass: COLOR_BY_CODE[def.code] ?? "text-tier-bronze",
    minXp: def.minXp,
  };
}

/** UI leagues — thresholds from Progression Engine seed. */
export const LEAGUES: League[] = PROGRESSION_LEAGUES.map(toUiLeague);

/**
 * Prefer engine league_code (includes demotion hysteresis) over XP-only derivation.
 */
export function leagueFromCodeOrXp(leagueCode: string | null | undefined, xp: number): League {
  return toUiLeague(progressionLeagueFromCodeOrXp(leagueCode, xp));
}

/** Fallback when league_code unavailable — matches SQL progression_league_for_xp. */
export function leagueFromXp(xp: number): League {
  return toUiLeague(progressionLeagueFromXp(xp));
}

/** XP still needed to reach the next league, or null if already at the top. */
export function xpToNextLeague(xp: number): { next: League; remaining: number } | null {
  const hit = progressionXpToNextLeague(xp);
  if (!hit) return null;
  return { next: toUiLeague(hit.next), remaining: hit.remaining };
}

/**
 * A single competitive rating number (ELO-flavoured, not stored server-side)
 * derived from XP + win rate so the arena has a "rating" stat without a
 * schema migration. Deterministic and monotonic in xp/wins.
 */
export function battleRatingFromXp(xp: number, wins: number, battles: number): number {
  const base = 1000 + Math.round(xp * 0.6);
  const winRate = battles > 0 ? wins / battles : 0;
  const winBonus = Math.round(winRate * 400) + Math.min(wins, 100) * 2;
  return Math.max(0, base + winBonus);
}

/** Accuracy % from a student_xp row's lifetime correct/answered counters. */
export function accuracyFromXp(row: {
  total_correct?: number | null;
  total_answered?: number | null;
}): number {
  const correct = row.total_correct ?? 0;
  const answered = row.total_answered ?? 0;
  if (!answered) return 0;
  return Math.round((correct / answered) * 100);
}

export type MotivationCardInput = {
  xp: number;
  level: number;
  streak: number;
  wins: number;
  classRank?: number | null;
  schoolRank?: number | null;
};

export type MotivationCard = {
  title: string;
  message: string;
  icon: "flame" | "trophy" | "target" | "sparkles" | "swords";
};

/** A single, ever-changing line of encouragement based on the student's state. */
export function motivationCard(input: MotivationCardInput): MotivationCard {
  const { streak, wins, classRank, schoolRank } = input;

  if (classRank === 1) {
    return {
      title: "You're #1 in class",
      message: "Defend your throne — a challenger could dethrone you any moment.",
      icon: "trophy",
    };
  }
  if (typeof classRank === "number" && classRank > 1 && classRank <= 3) {
    return {
      title: `#${classRank} in class`,
      message: "So close to the top — one strong win could take you there.",
      icon: "target",
    };
  }
  if (streak >= 3) {
    return {
      title: `${streak}-win streak`,
      message: "You're on fire! Keep battling today to protect your streak.",
      icon: "flame",
    };
  }
  if (wins === 0) {
    return {
      title: "Ready for your first win?",
      message: "Start a quick challenge — every champion starts with battle one.",
      icon: "swords",
    };
  }
  if (typeof schoolRank === "number" && schoolRank <= 10) {
    return {
      title: `Top ${schoolRank <= 3 ? schoolRank : 10} in school`,
      message: "You're ranked among the best in the whole school. Keep climbing!",
      icon: "sparkles",
    };
  }
  return {
    title: "Keep the momentum going",
    message: `${wins} wins so far — win one more today to boost your rank.`,
    icon: "swords",
  };
}

/**
 * Is a battle's live window actually open right now? `status === 'live'` is
 * always trusted. For `status === 'scheduled'`, a battle is only live
 * within [starts_at, starts_at + expected_duration + grace] — NOT simply
 * "starts_at has passed", which was the bug: no server-side process ever
 * transitions a teacher-created (non-featured) battle's status once its
 * window ends (rpc_rotate_featured_battles only expires the 4 auto-generated
 * featured sources), so a scheduled battle nobody ever actually started
 * showed as "live"/"active" forever — reproduced live: a battle scheduled
 * for 2026-08-09 still showed as "Live" in the teacher panel on 2026-08-20,
 * 11 days later. This was independently reimplemented (all missing the
 * upper bound) in 4 places; this is now the one shared source of truth.
 */
export function isBattleWindowOpen(battle: {
  status: string;
  starts_at: string;
  duration_sec?: number | null;
  question_count?: number | null;
  per_question_sec?: number | null;
}): boolean {
  if (battle.status === "live") return true;
  if (battle.status !== "scheduled") return false;
  const startMs = new Date(battle.starts_at).getTime();
  if (!Number.isFinite(startMs) || startMs > Date.now()) return false;
  const windowSec =
    battle.duration_sec ??
    (battle.question_count && battle.per_question_sec
      ? battle.question_count * battle.per_question_sec
      : 300);
  const GRACE_SEC = 20 * 60; // generous buffer for players to join/finish
  return Date.now() <= startMs + (windowSec + GRACE_SEC) * 1000;
}

export type BattleStatusKind = "waiting" | "active" | "completed" | "won" | "lost" | "draw" | "expired";

export type BattleStatusInput = {
  battleStatus: string; // 'scheduled' | 'live' | 'finished' | 'cancelled'
  startsAt: string;
  finishedAt?: string | null;
  rank?: number | null;
  totalParticipants?: number;
  /** When set with opponentScore, equal scores map to draw. */
  myScore?: number | null;
  opponentScore?: number | null;
};

export type BattleStatusInfo = {
  kind: BattleStatusKind;
  label: string;
  toneClass: string;
};

const STATUS_META: Record<BattleStatusKind, { label: string; toneClass: string }> = {
  waiting: { label: "Waiting", toneClass: "bg-muted text-muted-foreground" },
  active: { label: "Active", toneClass: "bg-primary/10 text-primary" },
  completed: { label: "Completed", toneClass: "bg-muted text-muted-foreground" },
  won: { label: "Won", toneClass: "bg-accent/15 text-accent" },
  lost: { label: "Lost", toneClass: "bg-destructive/10 text-destructive" },
  draw: { label: "Draw", toneClass: "bg-muted text-muted-foreground" },
  expired: { label: "Expired", toneClass: "bg-muted text-muted-foreground" },
};

/** Derive a single human status for a battle_participant + battle pair. */
export function formatBattleStatus(input: BattleStatusInput): BattleStatusInfo {
  const {
    battleStatus,
    startsAt,
    finishedAt,
    rank,
    totalParticipants = 0,
    myScore,
    opponentScore,
  } = input;
  let kind: BattleStatusKind;

  if (battleStatus === "cancelled") {
    kind = "expired";
  } else if (finishedAt) {
    if (totalParticipants > 1) {
      const scoresKnown =
        typeof myScore === "number" && typeof opponentScore === "number";
      // Head-draw when scores match (incl. RANK() ties both at 1)
      if (scoresKnown && myScore === opponentScore) {
        kind = "draw";
      } else if (rank === 1) {
        kind = "won";
      } else if (rank != null && rank > 1) {
        kind = "lost";
      } else if (scoresKnown) {
        kind = (myScore as number) > (opponentScore as number) ? "won" : "lost";
      } else {
        kind = "completed";
      }
    } else {
      kind = "completed";
    }
  } else if (battleStatus === "finished") {
    // Battle ended but this participant never finished their run
    kind = "lost";
  } else if (battleStatus === "scheduled" && new Date(startsAt).getTime() > Date.now()) {
    kind = "waiting";
  } else if (isBattleWindowOpen({ status: battleStatus, starts_at: startsAt })) {
    kind = "active";
  } else {
    kind = "expired";
  }

  return { kind, ...STATUS_META[kind] };
}

export const BATTLE_STATUS_FILTERS: { key: BattleStatusKind; label: string }[] = [
  { key: "waiting", label: "Waiting" },
  { key: "active", label: "Active" },
  { key: "completed", label: "Completed" },
  { key: "won", label: "Won" },
  { key: "lost", label: "Lost" },
];
