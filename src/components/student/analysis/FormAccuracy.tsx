import { pluralise } from "@/lib/plural";
import { formatSeconds } from "@/lib/studentAnalysisMetrics";
import { accuracyWhenMeaningful, MIN_OBSERVATIONS_FOR_VERDICT } from "@/academic/metrics/thresholds";
import { FORM_LABELS, isQuestionForm } from "../../../../supabase/functions/_shared/questionForms.ts";

export type FormAccuracyRow = {
  form: string;
  attempts: number;
  answered: number;
  correct: number;
  skipped: number;
  accuracy: number | null;
  avg_sec: number | null;
};

/**
 * Accuracy by the kind of question, across all practice (docs/TODO.md C1):
 * "70% on direct questions, 30% on assertion–reason" — the CUET figure a
 * student can act on, because the paper sets each kind in a known share.
 *
 * The rows come weakest first from rpc_student_practice_analytics (by_form).
 * A percentage only where enough answers stand behind it; the counts always,
 * so a kind met twice reads as "1 of 2", not as 50%. Weaknesses only (§10.8):
 * nothing here praises a kind for going well.
 */
export function FormAccuracy({ rows }: { rows: ReadonlyArray<FormAccuracyRow> }) {
  return (
    // relative: the scroll box contains what is placed inside it absolutely.
    <div className="relative mt-4 overflow-x-auto" data-testid="form-accuracy">
      <table className="w-full text-left text-sm">
        <thead>
          <tr className="text-xs text-muted-foreground">
            <th scope="col" className="py-1.5 pr-2 font-medium">Kind of question</th>
            <th scope="col" className="py-1.5 pr-2 font-medium">Right</th>
            <th scope="col" className="py-1.5 pr-2 font-medium" title={`Shown once ${MIN_OBSERVATIONS_FOR_VERDICT} questions are answered`}>Accuracy</th>
            <th scope="col" className="hidden py-1.5 font-medium sm:table-cell">Per answer</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const accuracy = accuracyWhenMeaningful(r.answered, r.accuracy);
            return (
              <tr key={r.form} className="border-t border-border/60" data-testid="form-accuracy-row">
                <td className="py-2 pr-2 font-medium">{isQuestionForm(r.form) ? FORM_LABELS[r.form] : r.form}</td>
                <td className="py-2 pr-2 tabular-nums">
                  {r.correct} of {r.answered}
                  {r.skipped > 0 && <span className="text-xs text-muted-foreground"> · {pluralise(r.skipped, "skip")}</span>}
                </td>
                <td className="py-2 pr-2 tabular-nums">{accuracy == null ? "—" : `${Math.round(accuracy)}%`}</td>
                <td className="hidden py-2 tabular-nums sm:table-cell">{r.avg_sec != null && r.avg_sec > 0 ? formatSeconds(r.avg_sec) : "—"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
