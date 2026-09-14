import type { RevisionSessionOutcome } from "@/academic";

/**
 * §5.3/§5.5 in one sentence: where the student now stands on the ladder.
 *
 * The recovery result screen has said which half failed since "Show the
 * student which half of recovery failed". The revision result screen said
 * nothing at all: Practice computed the outcome and dropped it on the floor.
 * This is the sentence it was missing.
 *
 * Three outcomes, and they are genuinely three — a pass that ends the run is
 * not the same event as a pass in the middle of it, and saying "passed" for
 * both would hide the only thing the student is working towards.
 *
 *   solid    three consecutive passes; the chapter leaves the queue, which it
 *            does by having no next date rather than by a flag.
 *   passed   the streak advanced and the interval widened.
 *   failed   §5.5 — back to the first rung, and the streak resets to ZERO,
 *            not to one. Three CONSECUTIVE passes means what it says.
 *
 * This function applies no threshold. REVISION_PASS_THRESHOLD lives in
 * recovery_constants and the server compared against it; `passed` and `solid`
 * are its answer, not ours (§10 item 7). It does not compute the next date
 * either — §5.3's 7/21/60 intervals have one home and this is not it.
 *
 * Lives in lib rather than beside the screen so it can be tested: a page file
 * that exports a plain function loses component-level hot reload and trips the
 * react-refresh lint rule the baseline gate holds flat.
 */
export function revisionVerdictLine(
  r: Pick<RevisionSessionOutcome, "passed" | "solid" | "consecutive_passes" | "stages_to_solid">,
): string {
  if (r.solid) {
    return `Solid — ${r.stages_to_solid} checks in a row. This chapter leaves your revision list.`;
  }
  if (r.passed) {
    const left = Math.max(0, r.stages_to_solid - r.consecutive_passes);
    return `Passed — ${r.consecutive_passes} of ${r.stages_to_solid} in a row. ${
      left === 1 ? "One more" : `${left} more`
    } and this chapter is done.`;
  }
  return "Not passed — the run restarts from the first check, not from where you were.";
}
