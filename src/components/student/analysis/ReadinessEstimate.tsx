import type { PaperShape } from "@/academic/metrics/examPaper";
import type { Readiness } from "@/academic/metrics/readiness";
import { READINESS_MIN_COVERAGE_PCT } from "@/academic/metrics/thresholds";
import { displaySubject } from "@/lib/academicPresentation";
import { pluralise } from "@/lib/plural";

/** "If the paper were today": the rows metrics/readiness.ts readinessRows found. The page draws the frame only when there are some. */
export function ReadinessEstimate({ paper, rows }: { paper: PaperShape; rows: Readiness[] }) {
  const name = (s: string) => displaySubject(s) || s;
  return (
    <div className="mt-3 space-y-3 text-sm" data-testid="readiness">
      <ul className="space-y-2">
        {rows.map((r) =>
          r.kind === "estimate" ? (
            <li key={r.subject} className="rounded-xl border border-border/70 bg-surface/60 p-3" data-testid="readiness-estimate">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="font-semibold text-foreground">{name(r.subject)}</span>
                <span className="tabular-nums">
                  <span className="text-lg font-black text-foreground">{r.marks}</span>
                  <span className="text-muted-foreground"> of {r.maxMarks}</span>
                </span>
              </div>
              <p className="mt-1 text-[11px] text-muted-foreground">
                At {r.accuracy}% right over {pluralise(r.answered, "answer")}, answering all {paper.questions} ·{" "}
                {r.practised} of {r.chapters} chapters practised
              </p>
              {r.perQuestion < 0 && (
                <p className="mt-1 text-[11px] text-warning">
                  At this accuracy an answer costs more than it earns — a question you are unsure of is better left.
                </p>
              )}
            </li>
          ) : (
            <li key={r.subject} className="flex flex-wrap items-baseline justify-between gap-x-3 px-1 text-[13px]" data-testid="readiness-not-yet">
              <span className="text-foreground">{name(r.subject)}</span>
              <span className="text-xs text-muted-foreground">
                Not yet — {[
                  r.practised < r.needChapters ? `${pluralise(r.needChapters - r.practised, "more chapter")}` : null,
                  r.answered < r.needAnswers ? `${pluralise(r.needAnswers - r.answered, "more answer")}` : null,
                ].filter(Boolean).join(" and ")}
              </span>
            </li>
          ),
        )}
      </ul>
      <p className="text-[11px] text-muted-foreground">
        An estimate from your practice: every question answered at your practice accuracy, +{paper.marks_correct} right and
        −{Math.abs(paper.marks_wrong)} wrong. A subject is read once half its chapters ({READINESS_MIN_COVERAGE_PCT}%) and{" "}
        {paper.questions} answers are behind it.
      </p>
    </div>
  );
}
