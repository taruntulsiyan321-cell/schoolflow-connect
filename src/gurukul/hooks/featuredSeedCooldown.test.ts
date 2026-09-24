/**
 * The Battleground asks the server to seed featured battles when there is
 * nothing to show — not on every reload.
 *
 * `rpc_ensure_featured_battles_all` runs `rpc_refresh_featured_battles()`, the
 * GLOBAL hourly maintenance job (cron job 1, `5 * * * *`), and then three
 * per-class seeds. useBattlegroundData used to call it at the top of every
 * reload(), and reload() fires on mount, on every live battle/xp event and on
 * every student-xp-updated — so a battle in progress fired it over and over.
 *
 * Measured on production 2026-09-23, from pg_stat_statements:
 *
 *     rpc_ensure_featured_battles_all   13,183 calls
 *       11,754 s of database time — 3.3 HOURS, mean 892 ms, max 4.5 s
 *
 * the largest single consumer of this project's database time, and what
 * `rpc_finish_practice_session` was losing its statement timeout to.
 */
import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { stripComments } from "@/test/stripComments";
import {
  FEATURED_SEED_COOLDOWN_MS,
  isCurrentPeriodFeatured,
  maySeedFeatured,
  resetFeaturedSeedCooldown,
} from "@/gurukul/hooks/useBattlegroundData";

const SOURCE = stripComments(readFileSync(join(__dirname, "useBattlegroundData.ts"), "utf8"));

describe("the seed is asked for only when a card is missing", () => {
  it("does not run on every reload: the call sits behind the missing-card test", () => {
    const call = SOURCE.indexOf("ensureFeaturedAll(academicCtx)");
    expect(call, "ensureFeaturedAll is still called somewhere — the cards must still be seedable").toBeGreaterThan(0);
    const guard = SOURCE.indexOf("missingFeatured.length > 0 && maySeedFeatured(");
    expect(guard, "the call must be guarded by there being nothing to show").toBeGreaterThan(0);
    expect(guard, "the guard must come before the call").toBeLessThan(call);
    // The old shape: the first thing reload() did, before any read.
    const reloadStart = SOURCE.indexOf("const reload = useCallback(");
    const firstRead = SOURCE.indexOf("readFeatured", reloadStart);
    expect(call, "the seed must follow the read that decides whether it is needed").toBeGreaterThan(firstRead);
  });

  it("knows which sources are missing for the current day and week", () => {
    const today = new Date().toISOString();
    const lastYear = new Date(Date.now() - 400 * 86400000).toISOString();
    expect(isCurrentPeriodFeatured("featured_daily", today)).toBe(true);
    expect(isCurrentPeriodFeatured("featured_weekly", today)).toBe(true);
    // A card from a window that has rolled over does not count, which is what
    // makes the next visit seed instead of showing yesterday's battle.
    expect(isCurrentPeriodFeatured("featured_daily", lastYear)).toBe(false);
    expect(isCurrentPeriodFeatured("featured_weekly", lastYear)).toBe(false);
  });
});

describe("the cooldown bounds a class that cannot be seeded", () => {
  beforeEach(() => {
    resetFeaturedSeedCooldown();
  });

  it("allows one attempt, then refuses until the cooldown passes", () => {
    const t0 = 1_000_000;
    expect(maySeedFeatured("class-1", t0)).toBe(true);
    expect(maySeedFeatured("class-1", t0 + 1000), "a second reload a second later must not ask again").toBe(false);
    expect(maySeedFeatured("class-1", t0 + FEATURED_SEED_COOLDOWN_MS - 1)).toBe(false);
    expect(maySeedFeatured("class-1", t0 + FEATURED_SEED_COOLDOWN_MS)).toBe(true);
  });

  it("is per class, and a student with no class is not mistaken for one", () => {
    const t0 = 2_000_000;
    expect(maySeedFeatured("class-1", t0)).toBe(true);
    expect(maySeedFeatured("class-2", t0), "another class's window is its own").toBe(true);
    expect(maySeedFeatured(null, t0)).toBe(true);
    expect(maySeedFeatured(null, t0 + 1)).toBe(false);
  });

  it("CONTROL: a hundred reloads in a battle now ask at most once", () => {
    const t0 = 3_000_000;
    let asked = 0;
    for (let i = 0; i < 100; i++) {
      // Every 200 ms, as live XP events arrive during a battle.
      if (maySeedFeatured("class-1", t0 + i * 200)) asked += 1;
    }
    expect(asked, "100 reloads used to be 100 calls of ~892 ms each").toBe(1);
  });
});
