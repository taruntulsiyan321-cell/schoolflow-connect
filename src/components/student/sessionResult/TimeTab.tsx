import { Timer } from "lucide-react";
import { Card } from "@/components/ui/card";
import { formatSeconds } from "@/lib/studentAnalysisMetrics";
import { pluralise } from "@/lib/plural";
import { MIN_OBSERVATIONS_FOR_VERDICT } from "@/academic/metrics/thresholds";
import { ANSWER_NOTES, type NoteKey, type SessionAnalysis } from "./analyseSession";

type Props = {
  analysis: SessionAnalysis;
  /** Opens the question in the Questions tab. */
  onShowQuestion: (order: number) => void;
};

const GROUPS: NoteKey[] = ["careless", "stuck", "slowRight"];

/**
 * How time went: the student's usual time against what the paper allows, the
 * answers that went wrong fast (rushed) or slow (stuck), the right ones that
 * took too long, and whether the second half gave way. Weaknesses only — there
 * is no bucket for "fine".
 */
export function TimeTab({ analysis, onShowQuestion }: Props) {
  const { pace, halves } = analysis;
  return (
    <div className="space-y-5">
      <Card className="p-5" data-testid="time-pace">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Timer className="h-4 w-4" aria-hidden /> Your pace</h3>
        {pace ? (
          <div className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">Your usual time per answer</div>
                <div className="text-lg font-bold tabular-nums">{formatSeconds(pace.medianSec)}</div>
              </div>
              <div className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">The real paper allows</div>
                <div className="text-lg font-bold tabular-nums">{formatSeconds(pace.budgetSec)}</div>
              </div>
            </div>
            {pace.overBudget > 0 && (
              <p className="text-muted-foreground">
                {pluralise(pace.overBudget, "answer")} of {pace.timed} took longer than the paper allows.
              </p>
            )}
            {GROUPS.map((k) => {
              const orders = pace[k];
              if (orders.length === 0) return null;
              return (
                <div key={k} data-testid={`time-${k}`}>
                  <div className="font-semibold">{ANSWER_NOTES[k].label} <span className="font-normal text-muted-foreground">— {ANSWER_NOTES[k].help.toLowerCase()}</span></div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {orders.map((o) => (
                      <button
                        key={o}
                        type="button"
                        onClick={() => onShowQuestion(o)}
                        className="rounded-lg border border-border bg-muted px-2.5 py-1 text-xs font-semibold hover:bg-secondary"
                      >
                        Q{o + 1}
                      </button>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Your pace is read once at least {MIN_OBSERVATIONS_FOR_VERDICT} answers are timed.
          </p>
        )}
      </Card>

      {halves && (
        <Card className="p-5" data-testid="time-halves">
          <h3 className="mb-3 text-sm font-semibold">First half and second half</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            {([["First half", halves.first], ["Second half", halves.second]] as const).map(([label, h]) => (
              <div key={label} className="rounded-lg border border-border p-3">
                <div className="text-xs text-muted-foreground">{label}</div>
                <div className="font-bold tabular-nums">{h.correct}/{h.answered} · {h.accuracy}%</div>
                <div className="text-xs text-muted-foreground">{h.avgSec != null ? `${formatSeconds(h.avgSec)} per answer` : "—"}</div>
              </div>
            ))}
          </div>
          {halves.gaveWay && (
            <p className="mt-3 text-sm" data-testid="time-gave-way">
              Your accuracy fell by {halves.accuracyDrop} points in the second half. A shorter session, or a short break
              halfway, may keep it up.
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
