import { describe, expect, it } from "vitest";
import {
  progressionXpForLevel,
  progressionLevelProgress,
  progressionLeagueFromXp,
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

});
