/**
 * Does guessing pay, for this student (docs/TODO.md C3).
 *
 * On a paper marked +R for a right answer and −W for a wrong one, a guess
 * gains marks on average once more than W / (R + W) of guesses come out right:
 * one in six at CUET's +5/−1. The "I'm guessing" tap gives each student their
 * own rate, so the reading is theirs, not a rule of thumb — and it is read
 * against the paper the server states (rpc_exam_paper), never a restated mark.
 *
 * No verdict below the floor every other figure in Analysis waits for
 * (MIN_OBSERVATIONS_FOR_VERDICT): three guesses, two of them lucky, are not a
 * habit to keep.
 */
import type { PaperShape } from "./examPaper";
import { mayBeJudged } from "./thresholds";

/** The student's guesses across practice: answered, and right. */
export type GuessRecord = { answered: number; correct: number };

export type GuessVerdict = GuessRecord & {
  /** Share of guesses right, 0–1. */
  rate: number;
  /** The share a guess must beat to gain marks: 1/6 at +5/−1. */
  breakEven: number;
  /** What the guesses came to under the paper's marking. */
  net: number;
  /** True: guessing pays. False: leave those questions. Null: too few guesses yet. */
  pays: boolean | null;
};

/** The share of guesses that must come out right for guessing to gain marks. */
export function breakEvenRate(paper: Pick<PaperShape, "marks_correct" | "marks_wrong">): number {
  const loss = Math.abs(paper.marks_wrong);
  return loss / (paper.marks_correct + loss);
}

/** Null when the student has answered nothing as a guess: there is nothing to read. */
export function guessVerdict(g: GuessRecord, paper: PaperShape): GuessVerdict | null {
  if (!(g.answered > 0)) return null;
  const rate = g.correct / g.answered;
  const breakEven = breakEvenRate(paper);
  return {
    ...g,
    rate,
    breakEven,
    net: g.correct * paper.marks_correct + (g.answered - g.correct) * paper.marks_wrong,
    // At exactly the break-even a guess gains nothing on average, so it does not pay.
    pays: mayBeJudged(g.answered) ? rate > breakEven : null,
  };
}

/** "1 in 6" when the break-even is a whole one-in-N, else a percentage. */
export function breakEvenWords(breakEven: number): string {
  if (breakEven <= 0) return "any share";
  const n = 1 / breakEven;
  return Math.abs(n - Math.round(n)) < 1e-9 ? `1 in ${Math.round(n)}` : `${Math.round(breakEven * 100)}%`;
}
