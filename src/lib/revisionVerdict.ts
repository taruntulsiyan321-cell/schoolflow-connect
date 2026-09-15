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
 *   solid    three consecutive passes. The chapter does NOT leave the
 *            schedule — it drops to the long interval and keeps a date.
 *            Dropping it was how a student who proved three times that they
 *            knew a chapter stopped ever being asked about it again.
 *   passed   the streak advanced and the interval widened.
 *   failed   §5.5 — back to the first rung, and the streak resets to ZERO,
 *            not to one. Three CONSECUTIVE passes means what it says.
 *
 * This function applies no threshold. REVISION_PASS_THRESHOLD lives in
 * recovery_constants and the server compared against it; `passed` and `solid`
 * are its answer, not ours (§10 item 7). It does not compute the next date
 * either — the intervals have one home and this is not it.
 *
 * Lives in lib rather than beside the screen so it can be tested: a page file
 * that exports a plain function loses component-level hot reload and trips the
 * react-refresh lint rule the baseline gate holds flat.
 */
export function revisionVerdictLine(
  r: Pick<RevisionSessionOutcome, "passed" | "solid" | "consecutive_passes" | "stages_to_solid">,
): string {
  if (r.solid) {
    return `Solid — ${r.stages_to_solid} checks in a row. This chapter now comes back far less often.`;
  }
  if (r.passed) {
    const left = Math.max(0, r.stages_to_solid - r.consecutive_passes);
    return `Passed — ${r.consecutive_passes} of ${r.stages_to_solid} in a row. ${
      left === 1 ? "One more" : `${left} more`
    } and this chapter is done.`;
  }
  return "Not passed — the run restarts from the first check, not from where you were.";
}

/**
 * The second sentence: which HALF of the check went wrong.
 *
 * A revision check is the student's own past mistakes plus material they have
 * never seen (§5.4). Those two halves answer different questions, and a single
 * percentage cannot tell them apart:
 *
 *   old wrong, new right   the chapter is fine; specific gaps have not closed
 *   old right, new wrong   the fixes stuck but the chapter has faded
 *   both wrong             the chapter has gone
 *
 * Returns null when there is nothing worth saying — either half missing means
 * there is no comparison to draw, and inventing one from a single half would
 * be the blended-single-number failure §4.2b names for recovery.
 */
export function revisionSplitLine(
  r: Pick<
    RevisionSessionOutcome,
    "mistake_correct" | "mistake_total" | "fresh_correct" | "fresh_total"
  >,
): string | null {
  if (r.mistake_total === 0 || r.fresh_total === 0) return null;

  const oldOk = r.mistake_correct === r.mistake_total;
  const newOk = r.fresh_correct === r.fresh_total;

  if (oldOk && newOk) {
    return `Every one of the ${r.mistake_total} you used to miss, and all ${r.fresh_total} new ones.`;
  }
  if (oldOk) {
    return `You fixed all ${r.mistake_total} of your old mistakes — it was the ${
      r.fresh_total - r.fresh_correct
    } new ${r.fresh_total - r.fresh_correct === 1 ? "question" : "questions"} that went.`;
  }
  if (newOk) {
    return `The new material is solid — it is the same ${
      r.mistake_total - r.mistake_correct
    } you keep missing that are still open.`;
  }
  return `${r.mistake_correct} of ${r.mistake_total} old mistakes and ${r.fresh_correct} of ${r.fresh_total} new questions.`;
}
