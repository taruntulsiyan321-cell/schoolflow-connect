/**
 * §4.2b — the report must say WHICH half failed.
 *
 * The section exists because a single blended number cannot: "'You can do the
 * steps but the idea isn't solid yet' is actionable. A single 74% is not."
 *
 * These assert the four outcomes are genuinely distinguished. A implementation
 * that collapsed them — returning one "not ready" string, or deciding from the
 * rates instead of the server's pass flags — fails here.
 */
import { describe, expect, it } from "vitest";
import { recoveryVerdictLine } from "@/lib/recoveryVerdict";

describe("recoveryVerdictLine", () => {
  it("names the procedural pass with a conceptual fail", () => {
    // The case §4.2 calls "the most common real result and the most useful
    // thing this feature detects".
    const line = recoveryVerdictLine({
      outcome: "not_ready",
      procedural_passed: true,
      conceptual_passed: false,
    });
    expect(line).toBe("You can run the steps, but the idea isn't solid yet.");
  });

  it("names the opposite case differently", () => {
    const line = recoveryVerdictLine({
      outcome: "not_ready",
      procedural_passed: false,
      conceptual_passed: true,
    });
    expect(line).toBe("You understand the idea; the working still needs practice.");
  });

  it("distinguishes all four outcomes", () => {
    // The control: if any two collapse into the same sentence, the split that
    // §4.2b exists to preserve has been thrown away at the last step.
    const lines = new Set([
      recoveryVerdictLine({ outcome: "ready", procedural_passed: true, conceptual_passed: true }),
      recoveryVerdictLine({ outcome: "not_ready", procedural_passed: true, conceptual_passed: false }),
      recoveryVerdictLine({ outcome: "not_ready", procedural_passed: false, conceptual_passed: true }),
      recoveryVerdictLine({ outcome: "not_ready", procedural_passed: false, conceptual_passed: false }),
    ]);
    expect(lines.size).toBe(4);
  });

  it("reads the outcome, not the rates", () => {
    // The thresholds live in recovery_constants and the server applies them.
    // `ready` wins even with both flags false, because the server is the one
    // that decided — a client that second-guessed it would need its own copy
    // of 0.80 and 0.70.
    expect(
      recoveryVerdictLine({ outcome: "ready", procedural_passed: false, conceptual_passed: false }),
    ).toBe("Both halves cleared — the steps and the idea.");
  });
});
