import { describe, expect, it } from "vitest";
import { overThePaper, paceAgainstPaper } from "./examPace";
import { secondsPerQuestion } from "./examPaper";
import { MIN_OBSERVATIONS_FOR_VERDICT } from "./thresholds";

const PAPER = { questions: 50, minutes: 60, marks_correct: 5, marks_wrong: -1 };

describe("pace against the paper", () => {
  it("the paper allows 72 seconds a question", () => {
    expect(secondsPerQuestion(PAPER)).toBe(72);
  });

  it("names the rows slower than the paper, furthest over first — only rows with enough timed answers", () => {
    expect(MIN_OBSERVATIONS_FOR_VERDICT).toBe(5);
    const pace = paceAgainstPaper([
      { key: "Economics", timed: 12, avgSec: 95.4 }, // 23 over
      { key: "Accountancy", timed: 30, avgSec: 140 }, // 68 over
      { key: "Business Studies", timed: 9, avgSec: 60 }, // within
      { key: "English", timed: 4, avgSec: 300 }, // too few timed answers to read
      { key: "Maths", timed: 7, avgSec: 72 }, // exactly the paper's time is not over it
      { key: "Untimed", timed: 10, avgSec: null },
    ], PAPER);
    expect(pace).toEqual({
      budgetSec: 72,
      over: [{ key: "Accountancy", avgSec: 140, overBy: 68 }, { key: "Economics", avgSec: 95, overBy: 23 }],
      read: 4,
    });
  });

  it("one answer's pace: seconds over the paper, or null within it", () => {
    expect(overThePaper(100, PAPER)).toBe(28);
    expect(overThePaper(72, PAPER)).toBeNull();
    expect(overThePaper(40, PAPER)).toBeNull();
    expect(overThePaper(null, PAPER)).toBeNull();
  });
});
