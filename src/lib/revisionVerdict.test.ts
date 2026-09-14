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
import { revisionVerdictLine } from "@/lib/revisionVerdict";

describe("revisionVerdictLine", () => {
  it("names the finish when the run is complete, and says the chapter leaves", () => {
    const line = revisionVerdictLine({
      passed: true, solid: true, consecutive_passes: 3, stages_to_solid: 3,
    });
    expect(line).toContain("Solid");
    expect(line).toContain("3 checks in a row");
    expect(line.toLowerCase()).toContain("leaves");
  });

  it("counts the streak the engine reported, not the stage", () => {
    expect(
      revisionVerdictLine({ passed: true, solid: false, consecutive_passes: 1, stages_to_solid: 3 }),
    ).toBe("Passed — 1 of 3 in a row. 2 more and this chapter is done.");
    expect(
      revisionVerdictLine({ passed: true, solid: false, consecutive_passes: 2, stages_to_solid: 3 }),
    ).toBe("Passed — 2 of 3 in a row. One more and this chapter is done.");
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
    expect(line).not.toContain("more and this chapter is done");
  });
});
