/**
 * A student's pace against the real paper (owner-approved analysis, 2026-10-03):
 * the time they take per answer, by subject or chapter, read against what the
 * CUET paper allows per question (60 minutes for 50 — 72 seconds).
 *
 * Only rows with enough TIMED answers to judge are read, the same floor every
 * pace figure on the Analysis page uses (MIN_OBSERVATIONS_FOR_VERDICT): one
 * attempt left open for ten minutes is not a pace.
 */
import { type PaperShape, secondsPerQuestion } from "./examPaper";
import { mayBeJudged } from "./thresholds";

export type PaceRow = { key: string; timed: number; avgSec: number | null };
export type OverPace = { key: string; avgSec: number; overBy: number };
export type ExamPace = {
  /** What the paper allows for one question, seconds. */
  budgetSec: number;
  /** Rows slower than that, the furthest over first. */
  over: OverPace[];
  /** How many rows had enough timed answers to be read at all. */
  read: number;
};

export function paceAgainstPaper(rows: ReadonlyArray<PaceRow>, paper: PaperShape): ExamPace {
  const budget = secondsPerQuestion(paper);
  const judged = rows.filter((r) => r.avgSec != null && r.avgSec > 0 && mayBeJudged(r.timed));
  const over = judged
    .filter((r) => (r.avgSec as number) > budget)
    .map((r) => ({ key: r.key, avgSec: Math.round(r.avgSec as number), overBy: Math.round((r.avgSec as number) - budget) }))
    .sort((a, b) => b.overBy - a.overBy || a.key.localeCompare(b.key));
  return { budgetSec: Math.round(budget), over, read: judged.length };
}

/** Seconds over the paper's time for one answer pace, or null when within it. */
export function overThePaper(avgSec: number | null | undefined, paper: PaperShape): number | null {
  if (avgSec == null || !(avgSec > 0)) return null;
  const by = Math.round(avgSec - secondsPerQuestion(paper));
  return by > 0 ? by : null;
}
