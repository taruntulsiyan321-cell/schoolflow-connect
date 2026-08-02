// Pure helpers for the Student Battleground — leagues, ratings, motivation
// copy and battle status labels. No network calls, no new services.

export type League = {
  name: string;
  tier: number;
  colorClass: string;
  minXp: number;
};

export const LEAGUES: League[] = [
  { name: "Bronze", tier: 1, colorClass: "text-tier-bronze", minXp: 0 },
  { name: "Silver", tier: 2, colorClass: "text-tier-silver", minXp: 300 },
  { name: "Gold", tier: 3, colorClass: "text-tier-gold", minXp: 800 },
  { name: "Platinum", tier: 4, colorClass: "text-primary", minXp: 1800 },
  { name: "Diamond", tier: 5, colorClass: "text-accent", minXp: 3500 },
  { name: "Master", tier: 6, colorClass: "text-warning", minXp: 6000 },
  { name: "Champion", tier: 7, colorClass: "text-warning", minXp: 10000 },
  { name: "Legend", tier: 8, colorClass: "text-destructive", minXp: 16000 },
  { name: "Titan", tier: 9, colorClass: "text-primary", minXp: 25000 },
  { name: "Nova", tier: 10, colorClass: "text-accent", minXp: 40000 },
];

/** Prefer backend league_code when present; else derive from XP thresholds. */
export function leagueFromCodeOrXp(leagueCode: string | null | undefined, xp: number): League {
  if (leagueCode) {
    const found = LEAGUES.find((l) => l.name.toLowerCase() === leagueCode.toLowerCase()
      || l.name.toLowerCase().replace(/\s+/g, "_") === leagueCode.toLowerCase());
    // codes are bronze/silver/... matching name lowercased
    const byCode = LEAGUES.find((l) => l.name.toLowerCase() === leagueCode.toLowerCase());
    if (byCode) return byCode;
    if (found) return found;
  }
  return leagueFromXp(xp);
}

/** Which league a student is in based on lifetime XP. */
export function leagueFromXp(xp: number): League {
  let current = LEAGUES[0];
  for (const l of LEAGUES) {
    if (xp >= l.minXp) current = l;
    else break;
  }
  return current;
}

/** XP still needed to reach the next league, or null if already at the top. */
export function xpToNextLeague(xp: number): { next: League; remaining: number } | null {
  const current = leagueFromXp(xp);
  const idx = LEAGUES.findIndex((l) => l.tier === current.tier);
  const next = LEAGUES[idx + 1];
  if (!next) return null;
  return { next, remaining: Math.max(0, next.minXp - xp) };
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
      title: `${streak}-day streak`,
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
      // Head-to-head draw when scores match (incl. RANK() ties both at 1)
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
  } else {
    kind = "active";
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
