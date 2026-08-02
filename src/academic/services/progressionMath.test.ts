import { describe, expect, it } from "vitest";
import {
  progressionXpForLevel,
  progressionLevelProgress,
  progressionLeagueFromXp,
  progressionLeagueFromCodeOrXp,
  progressionXpToNextLeague,
  PROGRESSION_LEAGUES,
} from "./progressionMath";

describe("progressionMath SSOT mirrors", () => {
  it("triangular XP curve", () => {
    expect(progressionXpForLevel(1)).toBe(0);
    expect(progressionXpForLevel(2)).toBe(100);
    expect(progressionXpForLevel(3)).toBe(300);
    expect(progressionXpForLevel(4)).toBe(600);
  });

  it("level progress within span", () => {
    const p = progressionLevelProgress(150, 2);
    expect(p.xpIntoLevel).toBe(50);
    expect(p.xpToNextLevel).toBe(150);
    expect(p.levelSpan).toBe(200);
    expect(p.levelProgressPct).toBe(25);
  });

  it("league thresholds", () => {
    expect(progressionLeagueFromXp(0).code).toBe("bronze");
    expect(progressionLeagueFromXp(300).code).toBe("silver");
    expect(progressionLeagueFromXp(40000).code).toBe("nova");
    expect(PROGRESSION_LEAGUES).toHaveLength(10);
  });

  it("prefers league_code over XP", () => {
    expect(progressionLeagueFromCodeOrXp("bronze", 5000).code).toBe("bronze");
    expect(progressionLeagueFromCodeOrXp(null, 5000).code).toBe("diamond");
    expect(progressionLeagueFromCodeOrXp(null, 900).code).toBe("gold");
  });

  it("xp to next league", () => {
    const hit = progressionXpToNextLeague(250);
    expect(hit?.next.code).toBe("silver");
    expect(hit?.remaining).toBe(50);
    expect(progressionXpToNextLeague(50_000)).toBeNull();
  });
});
