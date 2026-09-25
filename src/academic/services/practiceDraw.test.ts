/**
 * A student who did 10 questions yesterday is not asked those 10 again today
 * while unseen questions remain; a repeat comes only once the unseen pool runs
 * short, the longest-ago first.
 */
import { describe, expect, it } from "vitest";
import { drawFreshFirst, lastSeenFromAttempts } from "./practiceDraw";

const pool = (n: number) => Array.from({ length: n }, (_, i) => ({ id: `q${i}` }));
/** A seeded generator, so each run is reproducible and runs differ. */
const seeded = (seed: number) => () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const seenAt = (ids: string[], day: string) => new Map(ids.map((id) => [id, `2026-09-${day}T10:00:00Z`]));

describe("drawFreshFirst", () => {
  it("never repeats yesterday's questions while unseen ones remain", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const yesterday = drawFreshFirst(pool(100), new Map(), 10, seeded(seed)).map((q) => q.id);
      const today = drawFreshFirst(pool(100), seenAt(yesterday, "24"), 10, seeded(seed + 1000)).map((q) => q.id);
      expect(today.filter((id) => yesterday.includes(id))).toEqual([]);
      expect(new Set(today).size).toBe(10);
    }
  });

  it("CONTROL: a plain random draw, the old behaviour, does repeat yesterday's questions", () => {
    const plain = (seed: number) => drawFreshFirst(pool(100), new Map(), 10, seeded(seed)).map((q) => q.id);
    let repeats = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const yesterday = plain(seed);
      repeats += plain(seed + 1000).filter((id) => yesterday.includes(id)).length;
    }
    expect(repeats).toBeGreaterThan(0);
  });

  it("tops up from the longest-ago answers when the unseen pool is short", () => {
    const old = ["q0", "q1", "q2", "q3", "q4", "q5", "q6", "q7"];
    const recent = ["q8", "q9"];
    const lastSeen = new Map([...seenAt(old, "20"), ...seenAt(recent, "24")]);
    for (let seed = 1; seed <= 50; seed++) {
      const ids = drawFreshFirst(pool(12), lastSeen, 10, seeded(seed)).map((q) => q.id);
      expect(ids).toContain("q10");
      expect(ids).toContain("q11");
      expect(ids.filter((id) => recent.includes(id))).toEqual([]);
      expect(new Set(ids).size).toBe(10);
    }
  });

  it("is still random: two students with the same history get different sessions", () => {
    const a = drawFreshFirst(pool(100), new Map(), 10, seeded(7)).map((q) => q.id);
    const b = drawFreshFirst(pool(100), new Map(), 10, seeded(8)).map((q) => q.id);
    expect(a).not.toEqual(b);
  });

  it("serves the whole pool when the session is larger than it", () => {
    expect(drawFreshFirst(pool(4), seenAt(["q0"], "24"), 10, seeded(3))).toHaveLength(4);
  });
});

describe("lastSeenFromAttempts", () => {
  it("keeps the latest answer per question and skips non-bank attempts", () => {
    const m = lastSeenFromAttempts([
      { bank_question_id: "q1", created_at: "2026-09-20T00:00:00Z" },
      { bank_question_id: "q1", created_at: "2026-09-24T00:00:00Z" },
      { bank_question_id: null, created_at: "2026-09-25T00:00:00Z" },
    ]);
    expect([...m]).toEqual([["q1", "2026-09-24T00:00:00Z"]]);
  });
});
