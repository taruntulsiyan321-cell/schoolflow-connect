import { describe, expect, it } from "vitest";
import {
  compareWithLast,
  difficultyBreakdown,
  examMarks,
  formBreakdown,
  halves,
  metBefore,
  oneFix,
  paceReading,
  type SessionAttempt,
  topicBreakdown,
  toSessionAttempt,
} from "./sessionAnalysis";
import { CARELESS_SHARE, MIN_OBSERVATIONS_FOR_VERDICT, SLOW_SHARE } from "./thresholds";
import { TREND_DELTA_POINTS } from "../recovery/constants";

/**
 * A session read every way a student can use — each figure worked by hand from
 * the fixture below, so a change in the arithmetic fails here.
 */
const PAPER = { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 }; // 72 s a question

let n = 0;
const at = (over: Partial<SessionAttempt>): SessionAttempt => ({
  order: n++, topic: "Goodwill", chapter: "Admission", difficulty: "medium", form: "mcq", timeMs: 40_000,
  skipped: false, timedOut: false, isCorrect: true, excluded: false, bankQuestionId: null, ...over,
});

// Twelve questions. Goodwill: 6 asked, 4 right, 1 wrong, 1 skipped. Ratio: 6 asked, 3 right, 3 wrong.
function session(): SessionAttempt[] {
  n = 0;
  return [
    at({ timeMs: 40_000 }),
    at({ timeMs: 38_000 }),
    at({ timeMs: 42_000 }),
    at({ timeMs: 44_000, difficulty: "easy" }),
    at({ isCorrect: false, timeMs: 12_000, difficulty: "easy" }), // careless: under half the median (40 s)
    at({ skipped: true, isCorrect: null, timeMs: 3_000 }),
    at({ topic: "Ratio", timeMs: 41_000, difficulty: "hard" }),
    at({ topic: "Ratio", timeMs: 39_000, difficulty: "hard" }),
    at({ topic: "Ratio", timeMs: 100_000, difficulty: "hard" }), // right but slow: over 60 s and over 72 s
    at({ topic: "Ratio", isCorrect: false, timeMs: 95_000, difficulty: "hard", form: "match" }), // stuck
    at({ topic: "Ratio", isCorrect: false, timeMs: 43_000, difficulty: "hard", form: "match" }),
    at({ topic: "Ratio", isCorrect: false, timeMs: 37_000, difficulty: "hard" }),
  ];
}

describe("the breakdowns", () => {
  it("topics, weakest first, a percentage only with enough answers behind it", () => {
    const rows = topicBreakdown(session());
    expect(rows.map((r) => r.key)).toEqual(["Ratio", "Goodwill"]);
    expect(rows[0]).toMatchObject({ asked: 6, answered: 6, correct: 3, wrong: 3, skipped: 0, accuracy: 50 });
    // Goodwill: 5 answered (the skip is not an answer) — exactly the floor, so it carries a percentage.
    expect(MIN_OBSERVATIONS_FOR_VERDICT).toBe(5);
    expect(rows[1]).toMatchObject({ asked: 6, answered: 5, correct: 4, wrong: 1, skipped: 1, accuracy: 80 });
  });

  it("below the floor a row has counts and no percentage", () => {
    n = 0;
    const rows = topicBreakdown([at({}), at({ isCorrect: false }), at({})]);
    expect(rows[0]).toMatchObject({ answered: 3, correct: 2, wrong: 1, accuracy: null });
  });

  it("an answer left out of accuracy is not counted either way", () => {
    n = 0;
    const rows = topicBreakdown([at({ isCorrect: false, excluded: true }), at({})]);
    expect(rows[0]).toMatchObject({ asked: 2, answered: 1, wrong: 0 });
  });

  it("one topic in two cases is one row, named by its most used spelling (KNOWN_ISSUES 106)", () => {
    n = 0;
    const rows = topicBreakdown([
      at({ topic: "Ratio Analysis", isCorrect: false }), // filed under the chapter's name
      at({ topic: "Ratio analysis" }),
      at({ topic: " Ratio analysis ", isCorrect: false }),
      at({ topic: null, chapter: "ratio ANALYSIS" }),
      at({ topic: "Goodwill" }),
    ]);
    expect(rows.map((r) => [r.key, r.asked, r.wrong])).toEqual([["Ratio analysis", 4, 2], ["Goodwill", 1, 0]]);
    // A tie goes to the spelling met first.
    n = 0;
    expect(topicBreakdown([at({ topic: "share capital" }), at({ topic: "Share Capital" })]).map((r) => [r.key, r.asked]))
      .toEqual([["share capital", 2]]);
  });

  it("difficulty in its own order, and forms only when the session had more than direct questions", () => {
    expect(difficultyBreakdown(session()).map((r) => r.key)).toEqual(["easy", "medium", "hard"]);
    expect(formBreakdown(session())?.map((r) => [r.key, r.wrong])).toEqual([["match", 2], ["mcq", 2]]);
    n = 0;
    expect(formBreakdown([at({}), at({})])).toBeNull();
  });
});

describe("why an answer went wrong, read from its time", () => {
  it("against the student's own usual time and the paper's", () => {
    const p = paceReading(session(), PAPER)!;
    // Eleven timed answers; their median is 41 s. The paper allows 72 s.
    expect(p).toMatchObject({ medianSec: 41, budgetSec: 72, timed: 11, overBudget: 2 });
    expect(p.careless).toEqual([4]); // 12 s < 0.5 × 41
    expect(p.stuck).toEqual([9]); // 95 s > 1.5 × 41
    expect(p.slowRight).toEqual([8]); // 100 s > 61.5 s and > 72 s
    // The notes the student reads say "under half" and "half as long again"
    // (ANSWER_NOTES, analyseSession.ts): a change here must change those words.
    expect([CARELESS_SHARE, SLOW_SHARE]).toEqual([0.5, 1.5]);
  });

  it("says nothing when too few answers were timed to know what usual is", () => {
    n = 0;
    expect(paceReading([at({}), at({}), at({ isCorrect: false, timeMs: 1000 })], PAPER)).toBeNull();
  });
});

describe("the two halves", () => {
  it("names a drop only when it is a movement, not noise", () => {
    // First six: 5 answered, 4 right (80%). Last six: 6 answered, 3 right (50%). 30 points.
    const h = halves(session())!;
    expect(h.first).toMatchObject({ answered: 5, correct: 4, accuracy: 80 });
    expect(h.second).toMatchObject({ answered: 6, correct: 3, accuracy: 50 });
    expect(h).toMatchObject({ accuracyDrop: 30, gaveWay: true });
    expect(TREND_DELTA_POINTS).toBeLessThanOrEqual(30);
  });

  it("is silent when a half has too few answers", () => {
    n = 0;
    expect(halves([at({}), at({}), at({}), at({})])).toBeNull();
  });
});

describe("on the real paper", () => {
  it("+5 right, −1 wrong, 0 left — out of five a question asked", () => {
    expect(examMarks(session(), PAPER)).toEqual({ score: 7 * 5 - 4, max: 60, correct: 7, wrong: 4, left: 1 });
  });
});

describe("against the last session on this chapter", () => {
  const previous = {
    finishedAt: "2026-10-01T10:00:00Z",
    attempts: [
      ...Array.from({ length: 5 }, () => ({ topic: "Ratio", isCorrect: true, skipped: false, timedOut: false, timeMs: 50_000, excluded: false })),
      ...Array.from({ length: 5 }, () => ({ topic: "Goodwill", isCorrect: false, skipped: false, timedOut: false, timeMs: 30_000, excluded: false })),
    ],
  };

  it("accuracy and pace, then and now, and each topic both asked", () => {
    const c = compareWithLast(session(), previous)!;
    expect(c.then).toMatchObject({ answered: 10, correct: 5, accuracy: 50, avgSec: 40 });
    expect(c.now).toMatchObject({ answered: 11, correct: 7, accuracy: 64 });
    expect(c.accuracyChange).toBe(14);
    expect(c.topics.map((t) => [t.topic, t.then.correct, t.now.correct])).toEqual([["Ratio", 5, 3], ["Goodwill", 0, 4]]);
  });

  it("last time's spelling of a topic meets this time's, and takes this session's name", () => {
    const then = { ...previous, attempts: previous.attempts.map((a) => ({ ...a, topic: a.topic.toUpperCase() })) };
    const c = compareWithLast(session(), then)!;
    expect(c.topics.map((t) => [t.topic, t.then.correct, t.now.correct])).toEqual([["Ratio", 5, 3], ["Goodwill", 0, 4]]);
  });

  it("nothing to compare with is nothing, not zero", () => {
    expect(compareWithLast(session(), null)).toBeNull();
    expect(compareWithLast(session(), { finishedAt: "x", attempts: [] })).toBeNull();
  });
});

describe("questions met before", () => {
  it("fixed, still wrong, and slipped — by their own last answer", () => {
    n = 0;
    const now = [
      at({ bankQuestionId: "q1", isCorrect: true }),
      at({ bankQuestionId: "q2", isCorrect: false }),
      at({ bankQuestionId: "q3", isCorrect: false }),
      at({ bankQuestionId: "q4", isCorrect: true }),
      at({ bankQuestionId: "q5", isCorrect: true }),
    ];
    const earlier = [
      { bankQuestionId: "q1", isCorrect: false, skipped: false },
      { bankQuestionId: "q2", isCorrect: false, skipped: false },
      { bankQuestionId: "q3", isCorrect: true, skipped: false },
      { bankQuestionId: "q4", isCorrect: null, skipped: true },
    ];
    expect(metBefore(now, earlier)).toEqual({ fixed: [0, 3], stillWrong: [1], slipped: [2] });
    expect(metBefore(now, [])).toBeNull();
  });
});

describe("the one thing to do next", () => {
  it("the topic that cost the most — and nothing when nothing went wrong", () => {
    expect(oneFix(session())).toMatchObject({ key: "Ratio", wrong: 3 });
    n = 0;
    expect(oneFix([at({}), at({})])).toBeNull();
  });
});

describe("an attempt as the screen holds it", () => {
  it("knows its form from its text", () => {
    const a = toSessionAttempt(0, {
      question: "Assertion (A): Goodwill is intangible.\nReason (R): It cannot be seen.",
      options: ["a", "b", "c", "d"], isCorrect: true,
    });
    expect(a).toMatchObject({ form: "assertion_reason", skipped: false, excluded: false, topic: null });
  });
});
