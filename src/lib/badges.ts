import {
  Trophy, Flame, Zap, Crown, Medal, Target, Star, BookOpen, Brain, Rocket,
  ShieldCheck, Swords, GraduationCap, Compass, Moon, Sunrise, Gauge,
  Crosshair, Gem, Diamond, Skull, TrendingUp, Repeat, Hourglass, CheckCircle2,
  Calendar, Bolt, Atom,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum" | "legendary";
export type BadgeRarity = "common" | "rare" | "epic" | "legendary";
export type BadgeGroup =
  | "battleground"
  | "streak"
  | "speed"
  | "accuracy"
  | "academic"
  | "test"
  | "attendance"
  | "leaderboard"
  | "mastery"
  | "special";

export type BadgeMeta = {
  code: string;
  label: string;
  desc: string;
  tier: BadgeTier;
  rarity: BadgeRarity;
  group: BadgeGroup;
  icon: LucideIcon;
  /** Hidden badges are not shown until earned (mystery achievements). */
  hidden?: boolean;
};

/** Authoritative badge catalog. DB award logic uses these codes. */
export const BADGES: Record<string, BadgeMeta> = {
  // ── Battleground ──────────────────────────────────────────────
  first_win:           { code: "first_win",           label: "First Blood",          desc: "Win your first battle",                 tier: "bronze",    rarity: "common", group: "battleground", icon: Trophy },
  gladiator:           { code: "gladiator",           label: "Gladiator",            desc: "Fight in 10 battles",                   tier: "bronze",    rarity: "common", group: "battleground", icon: Swords },
  quiz_winner:         { code: "quiz_winner",         label: "Quiz Champion",        desc: "Win 5 battles",                         tier: "silver",    rarity: "common", group: "battleground", icon: Medal },
  veteran:             { code: "veteran",             label: "Arena Veteran",        desc: "Play 50 battles",                       tier: "gold",      rarity: "rare",   group: "battleground", icon: ShieldCheck },
  battleground_master: { code: "battleground_master", label: "Battleground Master",  desc: "Win 25 battles",                        tier: "gold",      rarity: "rare",   group: "battleground", icon: Swords },
  arena_legend:        { code: "arena_legend",        label: "Arena Legend",         desc: "Win 100 battles",                       tier: "legendary", rarity: "legendary", group: "battleground", icon: Crown },

  // ── Win streaks ───────────────────────────────────────────────
  win_streak_3:        { code: "win_streak_3",        label: "On Fire",              desc: "Win 3 battles in a row",                tier: "silver",    rarity: "rare",   group: "streak", icon: Flame },
  win_streak_5:        { code: "win_streak_5",        label: "Dominator",            desc: "Win 5 battles in a row",                tier: "gold",      rarity: "epic",   group: "streak", icon: Flame },
  win_streak_10:       { code: "win_streak_10",       label: "Untouchable",          desc: "Win 10 battles in a row",               tier: "legendary", rarity: "legendary", group: "streak", icon: Skull },

  // ── Daily streaks ─────────────────────────────────────────────
  streak_starter:      { code: "streak_starter",      label: "Streak Starter",       desc: "3-day activity streak",                 tier: "bronze",    rarity: "common", group: "streak", icon: Flame },
  consistency:         { code: "consistency",         label: "Consistency Warrior",  desc: "7-day activity streak",                 tier: "silver",    rarity: "rare",   group: "streak", icon: Repeat },
  streak_legend:       { code: "streak_legend",       label: "Streak Legend",        desc: "30-day activity streak",                tier: "legendary", rarity: "legendary", group: "streak", icon: Flame },

  // ── Speed ─────────────────────────────────────────────────────
  speed_master:        { code: "speed_master",        label: "Speed Demon",          desc: "Average under 5s with 3+ correct",      tier: "gold",      rarity: "rare",   group: "speed", icon: Zap },
  lightning:           { code: "lightning",           label: "Lightning Reflex",     desc: "Average under 3s with 5+ correct",      tier: "platinum",  rarity: "epic",   group: "speed", icon: Bolt },
  fast_solver:         { code: "fast_solver",         label: "Fast Solver",          desc: "Top of the speed leaderboard",          tier: "gold",      rarity: "epic",   group: "speed", icon: Rocket },

  // ── Accuracy ──────────────────────────────────────────────────
  sharp_shooter:       { code: "sharp_shooter",       label: "Sharp Shooter",        desc: "5+ correct in one battle",              tier: "silver",    rarity: "common", group: "accuracy", icon: Target },
  flawless:            { code: "flawless",            label: "Flawless Victory",     desc: "100% correct (5+ questions)",           tier: "gold",      rarity: "epic",   group: "accuracy", icon: Crosshair },
  high_scorer:         { code: "high_scorer",         label: "High Scorer",          desc: "Score 150+ in a single battle",         tier: "gold",      rarity: "rare",   group: "accuracy", icon: TrendingUp },
  unstoppable:         { code: "unstoppable",         label: "Unstoppable",          desc: "Score 300+ in a single battle",         tier: "platinum",  rarity: "epic",   group: "accuracy", icon: Gauge },

  // ── Academic / Test ────────────────────────────────────────────
  first_test:           { code: "first_test",           label: "Practice Begins",      desc: "Complete your first Test",               tier: "bronze",    rarity: "common", group: "test", icon: BookOpen },
  test_perfect:         { code: "test_perfect",         label: "Perfect Practice",     desc: "Score 100% on a Test",                   tier: "gold",      rarity: "epic",   group: "test", icon: CheckCircle2 },
  homework_warrior:    { code: "homework_warrior",    label: "Practice Warrior",     desc: "Complete 10 submitted Tests",            tier: "silver",    rarity: "rare",   group: "test", icon: BookOpen },
  topper:              { code: "topper",              label: "Subject Topper",       desc: "Top of your class in a subject",        tier: "gold",      rarity: "epic",   group: "academic", icon: Crown },
  academic_beast:      { code: "academic_beast",      label: "Academic Beast",       desc: "90%+ across all subjects",              tier: "platinum",  rarity: "legendary", group: "academic", icon: Brain },
  rising_star:         { code: "rising_star",         label: "Rising Star",          desc: "Most improved this term",               tier: "silver",    rarity: "rare",   group: "academic", icon: Star },
  scholar:             { code: "scholar",             label: "Scholar",              desc: "Score 90%+ on 5 consecutive Tests",      tier: "silver",    rarity: "rare",   group: "academic", icon: GraduationCap },
  explorer:            { code: "explorer",            label: "Explorer",             desc: "Battle in 5 different subjects",         tier: "bronze",    rarity: "common", group: "academic", icon: Compass },

  // ── Subject mastery ───────────────────────────────────────────
  math_master:         { code: "math_master",         label: "Math Master",          desc: "Dominate Mathematics battles",          tier: "gold",      rarity: "epic",   group: "mastery", icon: Atom },
  science_master:      { code: "science_master",      label: "Science Whiz",         desc: "Dominate Science battles",              tier: "gold",      rarity: "epic",   group: "mastery", icon: Atom },
  polymath:            { code: "polymath",            label: "Polymath",             desc: "Master 3+ subjects",                    tier: "legendary", rarity: "legendary", group: "mastery", icon: Gem },

  // ── Leaderboard ───────────────────────────────────────────────
  podium:              { code: "podium",              label: "On the Podium",        desc: "Reach the top 3 of any leaderboard",    tier: "silver",    rarity: "rare",   group: "leaderboard", icon: Medal },
  class_king:          { code: "class_king",          label: "Class Royalty",        desc: "Hit #1 on your class leaderboard",      tier: "gold",      rarity: "epic",   group: "leaderboard", icon: Crown },
  school_champion:     { code: "school_champion",     label: "School Champion",      desc: "Hit #1 on the school leaderboard",      tier: "legendary", rarity: "legendary", group: "leaderboard", icon: Trophy },

  // ── Attendance ────────────────────────────────────────────────
  punctual:            { code: "punctual",            label: "Punctual",             desc: "100% attendance for a month",           tier: "bronze",    rarity: "common", group: "attendance", icon: Calendar },
  attendance_king:     { code: "attendance_king",     label: "Attendance King",      desc: "95%+ attendance for the year",          tier: "gold",      rarity: "epic",   group: "attendance", icon: ShieldCheck },

  // ── Special / hidden ──────────────────────────────────────────
  night_owl:           { code: "night_owl",           label: "Night Owl",            desc: "Battle between midnight and 5 AM",       tier: "silver",    rarity: "rare",   group: "special", icon: Moon, hidden: true },
  early_bird:          { code: "early_bird",          label: "Early Bird",           desc: "Battle between 5 AM and 8 AM",          tier: "silver",    rarity: "rare",   group: "special", icon: Sunrise, hidden: true },
  comeback_king:       { code: "comeback_king",       label: "Comeback King",        desc: "Win after a losing streak",             tier: "gold",      rarity: "epic",   group: "special", icon: Hourglass, hidden: true },
  the_chosen_one:      { code: "the_chosen_one",      label: "The Chosen One",       desc: "A legend hidden in plain sight",        tier: "legendary", rarity: "legendary", group: "special", icon: Diamond, hidden: true },
};

export const TIER_CLASS: Record<BadgeTier, { bg: string; ring: string; text: string }> = {
  bronze:    { bg: "bg-tier-bronze",     ring: "ring-tier-bronze/40",   text: "text-tier-bronze" },
  silver:    { bg: "bg-tier-silver",     ring: "ring-tier-silver/40",   text: "text-tier-silver" },
  gold:      { bg: "bg-tier-gold",       ring: "ring-tier-gold/40",     text: "text-tier-gold" },
  platinum:  { bg: "bg-tier-platinum",   ring: "ring-tier-platinum/40", text: "text-tier-platinum" },
  legendary: { bg: "bg-primary", ring: "ring-tier-gold/60",    text: "text-tier-gold" },
};

export const RARITY_LABEL: Record<BadgeRarity, string> = {
  common: "Common",
  rare: "Rare",
  epic: "Epic",
  legendary: "Legendary",
};

export const GROUP_LABEL: Record<BadgeGroup, string> = {
  battleground: "Battleground",
  streak: "Streaks",
  speed: "Speed",
  accuracy: "Accuracy",
  academic: "Academic",
  test: "Test",
  attendance: "Attendance",
  leaderboard: "Leaderboard",
  mastery: "Subject Mastery",
  special: "Special & Hidden",
};

export const GROUP_ORDER: BadgeGroup[] = [
  "battleground", "streak", "speed", "accuracy", "mastery",
  "academic", "test", "leaderboard", "attendance", "special",
];

export function getBadge(code: string | null | undefined): BadgeMeta | null {
  if (!code) return null;
  return BADGES[code] ?? null;
}

export function badgesByGroup(): Record<BadgeGroup, BadgeMeta[]> {
  const out = {} as Record<BadgeGroup, BadgeMeta[]>;
  GROUP_ORDER.forEach((g) => { out[g] = []; });
  Object.values(BADGES).forEach((b) => { out[b.group].push(b); });
  return out;
}
