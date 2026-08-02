/**
 * Client mirrors of SQL progression_xp_for_level / level progress.
 * Keep in sync with docs/APPLY_ACADEMIC_PROGRESSION_ENGINE.sql.
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
