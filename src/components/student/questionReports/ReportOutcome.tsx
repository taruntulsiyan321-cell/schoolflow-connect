import { Link } from "react-router-dom";
import { ExplanationText } from "@/components/ExplanationText";
import { cn } from "@/lib/utils";
import { REPORT_REASONS, REPORT_STATUS, isSettled, type QuestionReport } from "@/lib/questionReports";

// The tint and the border carry the tone; the text stays the foreground —
// text-success on its own tint measured 4.13:1 (Practice.tsx).
const TONE = {
  waiting: "border-border bg-muted text-muted-foreground",
  settled: "border-info/40 bg-info/10 text-foreground",
  fixed: "border-success/40 bg-success/10 text-foreground",
  flagged: "border-warning/40 bg-warning/10 text-foreground",
} as const;

/** Where a report stands: the chip alone, for a card's one line. */
export function ReportStatusChip({ report, className }: { report: QuestionReport; className?: string }) {
  const s = REPORT_STATUS[report.status];
  return (
    <span className={cn("inline-flex rounded-full border px-2.5 py-0.5 text-[11px] font-semibold", TONE[s.tone], className)}>
      {s.label}
    </span>
  );
}

/**
 * What the student reported and what was found: the chip, the sentence the
 * check wrote, and the worked answer that came with it.
 */
export function ReportOutcome({ report, showReported = true }: { report: QuestionReport; showReported?: boolean }) {
  const reason = REPORT_REASONS.find((r) => r.key === report.reason)?.label ?? report.reason;
  return (
    <div className="space-y-2 text-sm" data-testid="report-outcome">
      <ReportStatusChip report={report} />
      {showReported && (
        <p className="text-xs text-muted-foreground">
          You reported: {reason}
          {report.claimedIndex != null ? ` — you said (${String.fromCharCode(65 + report.claimedIndex)})` : ""}
          {report.note ? ` — “${report.note}”` : ""}
        </p>
      )}
      {isSettled(report.status) ? (
        <>
          {report.outcome && <p className="font-medium text-foreground">{report.outcome}</p>}
          {report.outcomeExplanation && (
            <div className="rounded-xl border border-border bg-muted/40 p-3">
              <ExplanationText text={report.outcomeExplanation} />
            </div>
          )}
        </>
      ) : (
        <p className="text-xs text-muted-foreground">It's checked within a few minutes. You'll get a notification when it's done.</p>
      )}
    </div>
  );
}

/** Under a reported question on a card: the chip, the sentence, and the way to every report. */
export function ReportStatusLine({ report }: { report: QuestionReport }) {
  return (
    <div className="flex flex-wrap items-center gap-2 text-xs" data-testid="report-status-line">
      <ReportStatusChip report={report} />
      {isSettled(report.status) && report.outcome && <span className="text-muted-foreground">{report.outcome}</span>}
      <Link to="/student/mistakes/reports" className="font-semibold text-primary hover:underline">Your reports</Link>
    </div>
  );
}
