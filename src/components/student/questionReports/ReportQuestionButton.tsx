import { useState } from "react";
import { Flag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuestionReport } from "@/lib/questionReports";
import { ReportQuestionDialog } from "./ReportQuestionDialog";

type Props = {
  questionId: string;
  question: { text: string; options: string[] };
  answered: boolean;
  sessionId: string | null;
  report: QuestionReport | null;
  onChange: (report: QuestionReport) => void;
  /** "icon": the flag beside the bookmark while practising. "button": beside Mark on a card. */
  variant: "icon" | "button";
};

/**
 * The one report control (§10.21), wherever a bank question is shown: while
 * practising, on the session's review and in the Mistake Book.
 */
export function ReportQuestionButton({ questionId, question, answered, sessionId, report, onChange, variant }: Props) {
  const [open, setOpen] = useState(false);
  const label = report ? "Your report" : "Report a problem with this question";
  return (
    <>
      {variant === "icon" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label={label}
          title={label}
          className={cn(
            "flex h-7 w-7 items-center justify-center rounded-lg transition-all",
            report ? "bg-warning/15 text-warning" : "text-muted-foreground hover:bg-muted hover:text-foreground",
          )}
        >
          <Flag className="h-3.5 w-3.5" aria-hidden />
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
        >
          <Flag className="h-3.5 w-3.5" aria-hidden />
          {report ? "Your report" : "Report"}
        </button>
      )}
      <ReportQuestionDialog
        open={open}
        onOpenChange={setOpen}
        questionId={questionId}
        question={question}
        answered={answered}
        sessionId={sessionId}
        report={report}
        onSaved={onChange}
      />
    </>
  );
}
