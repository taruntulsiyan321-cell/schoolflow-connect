import { Trophy, Flame, Zap, Crown, Medal, Target, Star, BookOpen, Award, Brain, Rocket, Sparkles, ShieldCheck, Swords, GraduationCap, Compass } from "lucide-react";
import type { LucideIcon } from "lucide-react";

export type BadgeTier = "bronze" | "silver" | "gold" | "platinum" | "legendary";

export type BadgeMeta = {
  code: string;
  label: string;
  desc: string;
  tier: BadgeTier;
  icon: LucideIcon;
};

export const BADGES: Record<string, BadgeMeta> = {
  // Battleground
  first_win:        { code: "first_win",        label: "First Victory",       desc: "Win your first battle",            tier: "bronze",   icon: Trophy },
  sharp_shooter:    { code: "sharp_shooter",    label: "Sharp Shooter",       desc: "5+ correct in one battle",          tier: "silver",   icon: Target },
  speed_master:     { code: "speed_master",     label: "Speed Demon",         desc: "Answer in under 5s avg",            tier: "gold",     icon: Zap },
  quiz_winner:      { code: "quiz_winner",      label: "Quiz Champion",       desc: "Win 5 battles",                     tier: "silver",   icon: Medal },
  battleground_master: { code: "battleground_master", label: "Battleground Master", desc: "Win 25 battles",          tier: "gold",     icon: Swords },
  arena_legend:     { code: "arena_legend",     label: "Arena Legend",        desc: "Win 100 battles",                   tier: "legendary", icon: Crown },

  // Streaks
  streak_starter:   { code: "streak_starter",   label: "Streak Starter",      desc: "3-day streak",                      tier: "bronze",   icon: Flame },
  consistency:      { code: "consistency",      label: "Consistency Warrior", desc: "7-day streak",                      tier: "silver",   icon: Flame },
  streak_legend:    { code: "streak_legend",    label: "Streak Legend",       desc: "30-day streak",                     tier: "legendary", icon: Flame },

  // Academic
  topper:           { code: "topper",           label: "Subject Topper",      desc: "Top of class in a subject",         tier: "gold",     icon: Crown },
  academic_beast:   { code: "academic_beast",   label: "Academic Beast",      desc: "90%+ across all subjects",          tier: "platinum", icon: Brain },
  homework_warrior: { code: "homework_warrior", label: "Homework Warrior",    desc: "Submit 20 homeworks on time",       tier: "silver",   icon: BookOpen },
  fast_solver:      { code: "fast_solver",      label: "Fast Solver",         desc: "Top of speed leaderboard",          tier: "gold",     icon: Rocket },
  doubt_expert:     { code: "doubt_expert",     label: "Doubt Expert",        desc: "Help peers solve doubts",           tier: "silver",   icon: Sparkles },

  // Attendance
  punctual:         { code: "punctual",         label: "Punctual",            desc: "100% attendance for a month",       tier: "bronze",   icon: ShieldCheck },
  attendance_king:  { code: "attendance_king",  label: "Attendance King",     desc: "95%+ attendance for the year",      tier: "gold",     icon: ShieldCheck },

  // Misc
  rising_star:      { code: "rising_star",      label: "Rising Star",         desc: "Most improved this term",           tier: "silver",   icon: Star },
  scholar:          { code: "scholar",          label: "Scholar",             desc: "Read 10 library books",             tier: "silver",   icon: GraduationCap },
  explorer:         { code: "explorer",         label: "Explorer",            desc: "Try 5 different subjects",          tier: "bronze",   icon: Compass },
  honor_roll:       { code: "honor_roll",       label: "Honor Roll",          desc: "Top 3 in class for a term",         tier: "gold",     icon: Award },
};

export const TIER_CLASS: Record<BadgeTier, { bg: string; ring: string; text: string }> = {
  bronze:    { bg: "bg-tier-bronze",    ring: "ring-tier-bronze/40",    text: "text-tier-bronze" },
  silver:    { bg: "bg-tier-silver",    ring: "ring-tier-silver/40",    text: "text-tier-silver" },
  gold:      { bg: "bg-tier-gold",      ring: "ring-tier-gold/40",      text: "text-tier-gold" },
  platinum:  { bg: "bg-tier-platinum",  ring: "ring-tier-platinum/40",  text: "text-tier-platinum" },
  legendary: { bg: "bg-gradient-victory", ring: "ring-tier-gold/60",    text: "text-tier-gold" },
};

export function getBadge(code: string | null | undefined): BadgeMeta | null {
  if (!code) return null;
  return BADGES[code] ?? null;
}
