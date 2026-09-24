/**
 * §6.3's chapter list — the main screen Analysis never had.
 *
 * Every assertion here is a sentence of §6.2, §6.3, §6.4, §6.5 or §6.6, and
 * each one fails against the page as it stood: there was no such list at all,
 * the per-chapter trend came from practice_sessions.chapter (null for a
 * whole-subject session, so those chapters had no trend), and skipping was
 * never surfaced per chapter.
 */
import { describe, expect, it } from "vitest";
import { deriveWeakChapters } from "@/lib/weakChapters";
import { REPEATED_MISTAKE_PIN, TREND_MIN_SESSIONS } from "@/academic/recovery/constants";

const state = (over: Partial<Parameters<typeof deriveWeakChapters>[0]["states"][number]> = {}) => ({
  chapter_id: "c1", chapter: "Real Numbers", subject: "Mathematics", state: "has_mistakes", ...over,
});
const tally = (chapter_id: string, attempted: number, correct: number, day: number) => ({
  chapter_id, attempted, correct, created_at: `2026-09-${String(day).padStart(2, "0")}T10:00:00Z`,
});
const mistake = (chapter_id: string, over: Partial<{ status: string; times_wrong: number; created_at: string; topic: string }> = {}) => ({
  chapter_id, status: "open", times_wrong: 1, created_at: "2026-09-01T10:00:00Z", topic: null, ...over,
});
const attempt = (chapter_id: string, over: Partial<{ topic: string; skipped: boolean; time_taken_ms: number }> = {}) => ({
  chapter_id, topic: null, skipped: false, time_taken_ms: null, ...over,
});

describe("which chapters the list holds", () => {
  it("is weaknesses only: a chapter with nothing open is not a row", () => {
    const rows = deriveWeakChapters({
      states: [state({ chapter_id: "open", open_mistakes: 2 }), state({ chapter_id: "clean", chapter: "Polynomials", state: "recovered" })],
      tallies: [tally("open", 10, 4, 1), tally("clean", 10, 10, 1)],
      mistakes: [mistake("open"), mistake("open")],
      attempts: [attempt("clean")],
    });
    expect(rows.map((r) => r.chapterId)).toEqual(["open"]);
  });

  it("a chapter with only skipped questions is still something to do (§6.6)", () => {
    const rows = deriveWeakChapters({
      states: [state({ chapter_id: "skips", state: "untouched" })],
      tallies: [tally("skips", 10, 10, 1)],
      mistakes: [],
      attempts: [attempt("skips", { skipped: true }), attempt("skips", { skipped: true })],
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].skipped).toBe(2);
    expect(rows[0].openMistakes).toBe(0);
  });
});

describe("the signals, side by side and never blended (§6.2)", () => {
  const rows = deriveWeakChapters({
    states: [state({ chapter_id: "c1", open_mistakes: 3, next_revision_at: "2026-10-01T00:00:00Z", revision_due: false })],
    tallies: [tally("c1", 10, 2, 1), tally("c1", 10, 3, 2), tally("c1", 10, 8, 3), tally("c1", 10, 9, 4)],
    mistakes: [
      mistake("c1", { times_wrong: 3, created_at: "2026-08-01T10:00:00Z", topic: "HCF and LCM" }),
      mistake("c1", { times_wrong: 1, topic: "HCF and LCM" }),
      mistake("c1", { times_wrong: 2, topic: "Euclid's Lemma" }),
      mistake("c1", { status: "cleared", times_wrong: 5 }),
    ],
    attempts: [
      attempt("c1", { time_taken_ms: 40000 }),
      attempt("c1", { skipped: true, topic: "Euclid's Lemma", time_taken_ms: 5000 }),
      attempt("other", { time_taken_ms: 10000 }),
    ],
  });

  it("counts the open mistakes, and the repeated ones inside them", () => {
    expect(rows[0].openMistakes).toBe(3);
    // times_wrong > 1, and the cleared row is not open at all.
    expect(rows[0].repeatedMistakes).toBe(2);
  });

  it("gives accuracy its denominator (§6.3: 8 of 20 is not 8 of 200)", () => {
    expect(rows[0].attempted).toBe(40);
    expect(rows[0].accuracyPct).toBe(55);   // 22 of 40
  });

  it("reports the oldest open mistake, which is the neglect signal", () => {
    expect(rows[0].oldestOpenAt).toBe("2026-08-01T10:00:00Z");
  });

  it("breaks the chapter down by topic, and counts skips separately (§6.5, §6.6)", () => {
    expect(rows[0].mistakeTopics).toEqual([
      { topic: "HCF and LCM", count: 2 },
      { topic: "Euclid's Lemma", count: 1 },
    ]);
    expect(rows[0].skippedTopics).toEqual([{ topic: "Euclid's Lemma", count: 1 }]);
    expect(rows[0].skipped).toBe(1);
  });

  it("times the chapter against the student's own pace (§6.5)", () => {
    // 40s and 5s here; 10s elsewhere. Slow and correct is not mastery.
    expect(rows[0].avgSecPerQuestion).toBe(22.5);
    expect(rows[0].ownAvgSecPerQuestion).toBeCloseTo(18.3, 1);
  });

  it("carries no composite score of any kind (§6.2)", () => {
    for (const key of Object.keys(rows[0])) {
      expect(key.toLowerCase()).not.toMatch(/score|weakness|rating|grade/);
    }
  });
});

describe("the trend (§6.4)", () => {
  it("follows a chapter practised inside a whole-subject session", () => {
    // Four tally rows, each one a session that touched this chapter — which is
    // the case that had no trend at all when the series came from
    // practice_sessions.chapter (null for a subject session).
    const rows = deriveWeakChapters({
      states: [state({ chapter_id: "c1", open_mistakes: 1 })],
      tallies: [tally("c1", 10, 4, 1), tally("c1", 10, 4, 2), tally("c1", 10, 8, 3), tally("c1", 10, 8, 4)],
      mistakes: [mistake("c1")],
      attempts: [],
    });
    expect(rows[0].sessions).toBe(4);
    expect(rows[0].trend).toBe("improving");
    expect(rows[0].trendDeltaPoints).toBeGreaterThan(0);
  });

  it("CONTROL: says so rather than guessing when there are too few sessions", () => {
    const rows = deriveWeakChapters({
      states: [state({ chapter_id: "c1", open_mistakes: 1 })],
      tallies: [tally("c1", 10, 2, 1), tally("c1", 10, 9, 2)],
      mistakes: [mistake("c1")],
      attempts: [],
    });
    expect(rows[0].sessions).toBeLessThan(TREND_MIN_SESSIONS);
    expect(rows[0].trend).toBe("not_enough_data");
    expect(rows[0].trendDeltaPoints).toBeNull();
  });
});

describe("the order (§6.3)", () => {
  it("ranks by open mistakes, with revision_failed and repeated mistakes pinned above", () => {
    const many = Array.from({ length: 9 }, () => mistake("most"));
    const repeated = Array.from({ length: REPEATED_MISTAKE_PIN }, () => mistake("repeats", { times_wrong: 4 }));
    const rows = deriveWeakChapters({
      states: [
        state({ chapter_id: "most", chapter: "Most open" }),
        state({ chapter_id: "repeats", chapter: "Keeps coming back" }),
        state({ chapter_id: "failed", chapter: "Failed its check", state: "revision_failed" }),
      ],
      tallies: [],
      mistakes: [...many, ...repeated, mistake("failed")],
      attempts: [],
    });
    expect(rows.map((r) => r.chapterId)).toEqual(["failed", "repeats", "most"]);
    expect(rows[0].pin).toBe("revision_failed");
    expect(rows[1].pin).toBe("repeated_mistakes");
    expect(rows[2].pin).toBeNull();
    // CONTROL: without the pins this is the order, so the pins are what moved them.
    expect([...rows].sort((a, b) => b.openMistakes - a.openMistakes).map((r) => r.chapterId))
      .toEqual(["most", "repeats", "failed"]);
  });
});
