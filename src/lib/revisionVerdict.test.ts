/**
 * The revision verdict has to say three DIFFERENT things, and the streak it
 * quotes has to be the engine's, not a recount.
 *
 * The bug this guards against is the one that made the function necessary:
 * the outcome existed and nothing rendered it, so nothing would have noticed
 * if every branch returned the same sentence. The distinctness assertion is
 * the positive control — it fails against a stub that returns one string.
 */
import { describe, it, expect } from "vitest";
import { revisionCheckLabel, revisionSplitLine, revisionVerdictLine } from "@/lib/revisionVerdict";

describe("revisionVerdictLine", () => {
  it("names the finish when the run is complete, without promising the chapter goes away", () => {
    const line = revisionVerdictLine({
      passed: true, solid: true, consecutive_passes: 3, stages_to_solid: 3,
    });
    expect(line).toContain("Solid");
    expect(line).toContain("3 checks in a row");
    // It used to say the chapter "leaves your revision list", which is no
    // longer true and was the bug one level up: a solid chapter keeps a date
    // at the long interval instead of dropping out of the schedule.
    expect(line.toLowerCase()).not.toContain("leaves");
    expect(line.toLowerCase()).toContain("less often");
  });

  it("counts the streak the engine reported, not the stage", () => {
    expect(
      revisionVerdictLine({ passed: true, solid: false, consecutive_passes: 1, stages_to_solid: 3 }),
    ).toBe("Passed — 1 of 3 in a row. 2 more and this chapter is solid.");
    expect(
      revisionVerdictLine({ passed: true, solid: false, consecutive_passes: 2, stages_to_solid: 3 }),
    ).toBe("Passed — 2 of 3 in a row. One more and this chapter is solid.");
  });

  it("says a failure restarts the RUN, because §5.5 resets to zero not to one", () => {
    const line = revisionVerdictLine({
      passed: false, solid: false, consecutive_passes: 0, stages_to_solid: 3,
    });
    expect(line).toContain("restarts");
    expect(line).not.toContain("0 of 3");
  });

  it("POSITIVE CONTROL: the three outcomes are three different sentences", () => {
    // Without this, a stub returning one constant would satisfy every
    // assertion above that only checks a substring.
    const lines = new Set([
      revisionVerdictLine({ passed: true, solid: true, consecutive_passes: 3, stages_to_solid: 3 }),
      revisionVerdictLine({ passed: true, solid: false, consecutive_passes: 1, stages_to_solid: 3 }),
      revisionVerdictLine({ passed: false, solid: false, consecutive_passes: 0, stages_to_solid: 3 }),
    ]);
    expect(lines.size).toBe(3);
  });

  it("solid wins over passed, so the last check is never reported as 'one more'", () => {
    const line = revisionVerdictLine({
      passed: true, solid: true, consecutive_passes: 3, stages_to_solid: 3,
    });
    expect(line).not.toContain("more and this chapter is solid");
  });
});

/**
 * The split line exists because a single percentage cannot distinguish "you
 * still miss the same two" from "the chapter has faded" — and those need
 * opposite things from the student.
 *
 * The positive control is the distinctness assertion at the end: it fails
 * against any implementation that returns one sentence for every shape, which
 * is exactly what a blended single number amounts to.
 */
describe("revisionSplitLine", () => {
  it("says nothing when there is no comparison to draw", () => {
    // One half missing is not a diagnosis. Inventing one from a single half
    // is the blended-number failure §4.2b names for recovery's two rates.
    expect(revisionSplitLine({
      mistake_correct: 0, mistake_total: 0, fresh_correct: 6, fresh_total: 8,
    })).toBeNull();
    expect(revisionSplitLine({
      mistake_correct: 2, mistake_total: 3, fresh_correct: 0, fresh_total: 0,
    })).toBeNull();
  });

  it("blames the new material when the old mistakes are all fixed", () => {
    const line = revisionSplitLine({
      mistake_correct: 3, mistake_total: 3, fresh_correct: 5, fresh_total: 8,
    });
    expect(line).toContain("fixed all 3");
    expect(line).toContain("3 new questions");
  });

  it("blames the old mistakes when the new material is clean", () => {
    const line = revisionSplitLine({
      mistake_correct: 1, mistake_total: 3, fresh_correct: 8, fresh_total: 8,
    });
    expect(line).toContain("new material is solid");
    expect(line).toContain("same 2");
  });

  it("reports both when both went, without pretending to a verdict", () => {
    expect(revisionSplitLine({
      mistake_correct: 1, mistake_total: 3, fresh_correct: 5, fresh_total: 8,
    })).toBe("1 of 3 old mistakes and 5 of 8 new questions.");
  });

  it("singularises one lost new question rather than saying '1 questions'", () => {
    expect(revisionSplitLine({
      mistake_correct: 2, mistake_total: 2, fresh_correct: 7, fresh_total: 8,
    })).toContain("1 new question that went");
  });

  it("POSITIVE CONTROL — the four shapes produce four different sentences", () => {
    const lines = [
      revisionSplitLine({ mistake_correct: 3, mistake_total: 3, fresh_correct: 8, fresh_total: 8 }),
      revisionSplitLine({ mistake_correct: 3, mistake_total: 3, fresh_correct: 5, fresh_total: 8 }),
      revisionSplitLine({ mistake_correct: 1, mistake_total: 3, fresh_correct: 8, fresh_total: 8 }),
      revisionSplitLine({ mistake_correct: 1, mistake_total: 3, fresh_correct: 5, fresh_total: 8 }),
    ];
    expect(lines.every((l) => l !== null)).toBe(true);
    expect(new Set(lines).size).toBe(4);
  });
});

describe("revisionCheckLabel — the ladder past solid", () => {
  it("numbers the three checks and calls every later one a solid check", () => {
    expect(revisionCheckLabel(1, 3)).toBe("check 1 of 3");
    expect(revisionCheckLabel(3, 3)).toBe("check 3 of 3");
    // The case the screens got wrong: a solid chapter's maintenance checks.
    expect(revisionCheckLabel(4, 3)).toBe("solid check");
    expect(revisionCheckLabel(7, 3)).toBe("solid check");
  });

  it("a solid chapter's later pass quotes its real run, not the three it needed", () => {
    expect(revisionVerdictLine({ passed: true, solid: true, consecutive_passes: 5, stages_to_solid: 3 }))
      .toContain("5 checks in a row");
  });
});
