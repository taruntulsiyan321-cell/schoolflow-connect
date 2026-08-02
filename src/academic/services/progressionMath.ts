/**
 * Client mirrors of SQL progression_xp_for_level / level progress / leagues.
 * Keep in sync with docs/APPLY_ACADEMIC_PROGRESSION_ENGINE.sql
 * (progression_leagues + progression_xp_for_level).
 *
 * Prefer ProgressionService snapshot fields (league_code, xp_into_level, …)
 * over deriving on the client — especially league, which has demotion hysteresis.
 */

/** Cumulative XP required to reach the start of `_level` (1-based). */
export function progressionXpForLevel(level: number): number {
  const L = Math.max(1, Math.floor(level));
  return Math.floor((100 * L * (L - 1)) / 2);
}

export function progressionLevelProgress(xp: number, level: number) {
  const cur = progressionXpForLevel(level);
  const next = progressionXpForLevel(level + 1);
  const into = Math.max(0, Math.floor(xp) - cur);
  const toNext = Math.max(0, next - Math.floor(xp));
  const span = Math.max(0, next - cur);
  const pct =
    span <= 0 ? 100 : Math.min(100, Math.round((100 * into) / span));
  return {
    xpIntoLevel: into,
    xpToNextLevel: toNext,
    levelSpan: span,
    levelProgressPct: pct,
  };
}

/** Mirrors `progression_leagues` seed (code, label, tier, min_xp). */
export type ProgressionLeagueDef = {
  code: string;
  label: string;
  tier: number;
  minXp: number;
};

export const PROGRESSION_LEAGUES: ProgressionLeagueDef[] = [
  { code: "bronze", label: "Bronze", tier: 1, minXp: 0 },
  { code: "silver", label: "Silver", tier: 2, minXp: 300 },
  { code: "gold", label: "Gold", tier: 3, minXp: 800 },
  { code: "platinum", label: "Platinum", tier: 4, minXp: 1800 },
  { code: "diamond", label: "Diamond", tier: 5, minXp: 3500 },
  { code: "master", label: "Master", tier: 6, minXp: 6000 },
  { code: "champion", label: "Champion", tier: 7, minXp: 10000 },
  { code: "legend", label: "Legend", tier: 8, minXp: 16000 },
  { code: "titan", label: "Titan", tier: 9, minXp: 25000 },
  { code: "nova", label: "Nova", tier: 10, minXp: 40000 },
];

/** Fallback when snapshot.league is missing — matches SQL progression_league_for_xp. */
export function progressionLeagueFromXp(xp: number): ProgressionLeagueDef {
  let current = PROGRESSION_LEAGUES[0];
  const n = Math.max(0, Math.floor(xp));
  for (const l of PROGRESSION_LEAGUES) {
    if (n >= l.minXp) current = l;
    else break;
  }
  return current;
}

export function progressionLeagueFromCodeOrXp(
  leagueCode: string | null | undefined,
  xp: number,
): ProgressionLeagueDef {
  if (leagueCode) {
    const code = leagueCode.toLowerCase().replace(/\s+/g, "_");
    const byCode = PROGRESSION_LEAGUES.find((l) => l.code === code || l.label.toLowerCase() === code);
    if (byCode) return byCode;
  }
  return progressionLeagueFromXp(xp);
}

export function progressionXpToNextLeague(xp: number): {
  next: ProgressionLeagueDef;
  remaining: number;
} | null {
  const current = progressionLeagueFromXp(xp);
  const idx = PROGRESSION_LEAGUES.findIndex((l) => l.tier === current.tier);
  const next = PROGRESSION_LEAGUES[idx + 1];
  if (!next) return null;
  return { next, remaining: Math.max(0, next.minXp - Math.floor(xp)) };
}
