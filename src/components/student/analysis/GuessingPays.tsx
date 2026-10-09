import { pluralise } from "@/lib/plural";
import { MIN_OBSERVATIONS_FOR_VERDICT } from "@/academic/metrics/thresholds";
import { breakEvenWords, type GuessVerdict } from "@/academic/metrics/guessing";
import type { PaperShape } from "@/academic/metrics/examPaper";

/** "+2 marks", "−1 mark", "0 marks". */
const signedMarks = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n)} ${Math.abs(n) === 1 ? "mark" : "marks"}`;

/**
 * Does guessing pay, for this student (docs/TODO.md C3): their own rate on
 * the answers they marked "I'm guessing", against the share a guess must get
 * right to gain marks on the real paper, and what to do about it. A fact and a
 * next step — not praise (§10.8).
 */
export function GuessingPays({ verdict, paper }: { verdict: GuessVerdict; paper: Pick<PaperShape, "marks_correct" | "marks_wrong"> }) {
  const marking = `+${paper.marks_correct}/−${Math.abs(paper.marks_wrong)}`;
  if (verdict.pays === null) {
    return (
      <p className="mt-3 text-sm text-muted-foreground" data-testid="guessing-pays" data-verdict="unknown">
        You have marked {pluralise(verdict.answered, "answer")} as a guess, {verdict.correct} right. Once {MIN_OBSERVATIONS_FOR_VERDICT} are
        marked, this says whether guessing pays for you at {marking}.
      </p>
    );
  }
  return (
    <div className="mt-3 space-y-1" data-testid="guessing-pays" data-verdict={verdict.pays ? "pays" : "leave"}>
      <p className="text-sm font-semibold text-foreground">{verdict.pays ? "Your guesses pay." : "Leave them blank."}</p>
      <p className="text-sm text-muted-foreground">
        {verdict.correct} of {pluralise(verdict.answered, "guess", "guesses")} right ({Math.round(verdict.rate * 100)}%) —{" "}
        {verdict.pays ? "more than" : "not more than"} the {breakEvenWords(verdict.breakEven)} a guess must get right to gain
        marks at {marking}. Marked that way they came to {signedMarks(verdict.net)}.
      </p>
      <p className="text-xs text-muted-foreground">
        {verdict.pays
          ? "On the paper, an answer you would guess is worth giving."
          : "On the paper, leave a question blank rather than guess it."}
      </p>
    </div>
  );
}
