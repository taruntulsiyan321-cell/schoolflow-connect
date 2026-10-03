import type { PaperShape } from "@/academic/metrics/examPaper";
import { overThePaper, type PaceRow, paceAgainstPaper } from "@/academic/metrics/examPace";
import { MIN_OBSERVATIONS_FOR_VERDICT } from "@/academic/metrics/thresholds";
import { formatSeconds } from "@/lib/studentAnalysisMetrics";

/**
 * The student's pace by subject against what the real paper allows per
 * question. Weaknesses only (§10.8): the subjects slower than the paper are
 * named; the rest are not ranked or praised.
 */
export function ExamPaceSummary({ paper, subjects }: { paper: PaperShape; subjects: PaceRow[] }) {
  const pace = paceAgainstPaper(subjects, paper);
  return (
    <div className="mt-3 space-y-3 text-sm" data-testid="exam-pace">
      <p className="text-muted-foreground">
        The paper allows <span className="font-semibold text-foreground tabular-nums">{formatSeconds(pace.budgetSec)}</span> a
        question — {paper.minutes} minutes for {paper.questions}.
      </p>
      {pace.read === 0 ? (
        <p className="text-muted-foreground">No subject has {MIN_OBSERVATIONS_FOR_VERDICT} timed answers behind it yet.</p>
      ) : pace.over.length === 0 ? (
        <p className="text-muted-foreground">No subject you have practised takes longer than that.</p>
      ) : (
        <ul className="space-y-2">
          {pace.over.map((r) => (
            <li key={r.key} className="flex items-center justify-between gap-3 rounded-xl border border-warning/20 bg-warning/5 p-2.5" data-testid="exam-pace-over">
              <span className="min-w-0 truncate font-semibold text-foreground">{r.key}</span>
              <span className="shrink-0 text-right tabular-nums">
                <span className="font-black text-foreground">{formatSeconds(r.avgSec)}</span>
                <span className="block text-[11px] text-warning">{formatSeconds(r.overBy)} over the paper</span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** "28s over the paper", under a pace slower than the paper allows; nothing when within it, or not known. */
export function OverThePaper({ avgSec, paper }: { avgSec: number | null | undefined; paper: PaperShape | null }) {
  const by = paper ? overThePaper(avgSec, paper) : null;
  if (by == null) return null;
  return <div className="text-[10px] font-semibold tabular-nums text-warning">{formatSeconds(by)} over the paper</div>;
}
