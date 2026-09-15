import type { RecoverySessionOutcome } from "@/academic";

/**
 * §4.2b in one sentence: name the half that failed.
 *
 * "Two rates, never blended, so the report can say which one failed and what
 * that means. 'You can do the steps but the idea isn't solid yet' is
 * actionable. A single 74% is not."
 *
 * That sentence is only sayable because procedural (tiers 0+1) and conceptual
 * (tiers 2+3) are scored against their own thresholds and travel separately
 * all the way here. This function does NOT apply those thresholds — the server
 * did, against recovery_constants, and `procedural_passed` / `conceptual_passed`
 * are its answer. Re-deriving them from the rates would put
 * RECOVERY_PROCEDURAL_THRESHOLD and RECOVERY_CONCEPTUAL_THRESHOLD in a second
 * home (§10 item 7).
 *
 * Lives in lib rather than beside the screen so it can be tested: a page file
 * that exports a plain function loses component-level hot reload and trips the
 * react-refresh lint rule the baseline gate holds flat.
 */
export function recoveryVerdictLine(
  r: Pick<RecoverySessionOutcome, "outcome" | "procedural_passed" | "conceptual_passed">,
): string {
  if (r.outcome === "ready") {
    return "Both halves cleared — the steps and the idea.";
  }
  if (r.procedural_passed && !r.conceptual_passed) {
    return "You can run the steps, but the idea isn't solid yet.";
  }
  if (!r.procedural_passed && r.conceptual_passed) {
    return "You understand the idea; the working still needs practice.";
  }
  return "Both halves need more work before this chapter is solid.";
}
