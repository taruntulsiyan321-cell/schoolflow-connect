import { describe, expect, it } from "vitest";
import { BADGES, badgeForIndividualCatalog } from "@/lib/badges";

/**
 * An exam account is offered only badges it can be awarded. The catalog was a
 * list of what to hide, and showed six badges nothing ever awards to an exam
 * account (measured 2026-09-25 against every _award_badge call): no award path
 * at all for speed_master, lightning, academic_beast, rising_star and scholar,
 * and flawless is awarded only when a battle finishes.
 */
describe("the individual badge catalog", () => {
  const offered = Object.values(BADGES).filter(badgeForIndividualCatalog).map((b) => b.code).sort();

  it("is the streaks and polymath — practice and activity award paths only", () => {
    expect(offered).toEqual(["consistency", "polymath", "streak_legend", "streak_starter"]);
  });

  it("POSITIVE CONTROL: the badges nothing can award an exam account are not offered", () => {
    for (const code of ["speed_master", "lightning", "flawless", "academic_beast", "rising_star", "scholar", "first_win", "punctual"]) {
      expect(BADGES[code], `${code} is in the catalog`).toBeDefined();
      expect(offered).not.toContain(code);
    }
  });
});
