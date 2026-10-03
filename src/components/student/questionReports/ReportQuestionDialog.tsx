import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { QuestionText } from "@/components/QuestionText";
import { PlanLimitNotice } from "@/gurukul/components/PlanLimitNotice";
import { cn } from "@/lib/utils";
import { toErrorMessage } from "@/lib/presentation";
import { PlanLimitError, type PlanLimit } from "@/lib/premium";
import {
  REPORT_NOTE_MAX_CHARS, clampReportNote, reasonsFor, reportNoteLength, reportQuestion,
  type QuestionReport, type ReportReason,
} from "@/lib/questionReports";
import { ReportOutcome } from "./ReportOutcome";

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  questionId: string;
  question: { text: string; options: string[] };
  /** Whether the answer has been shown: before it, there is no answer to dispute. */
  answered: boolean;
  sessionId: string | null;
  report: QuestionReport | null;
  onSaved: (report: QuestionReport) => void;
};

/**
 * Report one question. While the report waits it can be changed; once the
 * check has it, this shows where it stands and, when settled, what was found.
 */
export function ReportQuestionDialog({ open, onOpenChange, questionId, question, answered, sessionId, report, onSaved }: Props) {
  const reasons = reasonsFor(answered);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [claimed, setClaimed] = useState<number | null>(null);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);
  const [planLimit, setPlanLimit] = useState<PlanLimit | null>(null);

  // Every opening starts from what is stored.
  useEffect(() => {
    if (!open) return;
    setReason(report && reasons.some((r) => r.key === report.reason) ? report.reason : null);
    setClaimed(report?.claimedIndex ?? null);
    setNote(report?.note ?? "");
    setPlanLimit(null);
    // reasons follows `answered`; re-reading it on every render would reset the form.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, report]);

  const editable = !report || report.status === "open";
  const chosen = reasons.find((r) => r.key === reason) ?? null;
  const noteCount = reportNoteLength(note);
  const missingNote = chosen?.needsNote === true && note.trim() === "";

  async function send() {
    if (!chosen) return;
    setSaving(true);
    try {
      const { report: saved, created } = await reportQuestion({
        questionId, reason: chosen.key, claimedIndex: chosen.key === "wrong_answer" ? claimed : null, note, sessionId,
      });
      onSaved(saved);
      toast.success(created ? "Reported — it's checked within a few minutes, and you'll be told what was found." : "Report updated");
      onOpenChange(false);
    } catch (e) {
      if (e instanceof PlanLimitError) setPlanLimit(e.planLimit);
      else toast.error(toErrorMessage(e, "We couldn't send your report. Please try again."));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !saving && onOpenChange(o)}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{editable ? "Report this question" : "Your report"}</DialogTitle>
          <DialogDescription asChild>
            <div className="line-clamp-3 text-sm text-muted-foreground">
              <QuestionText compact text={question.text} options={question.options} />
            </div>
          </DialogDescription>
        </DialogHeader>

        {!editable && report ? (
          <ReportOutcome report={report} />
        ) : (
          <>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-sm font-semibold">What's wrong?</legend>
              {reasons.map((r) => (
                <label
                  key={r.key}
                  className={cn(
                    "flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-sm transition-colors",
                    reason === r.key ? "border-primary bg-primary/10 text-foreground" : "border-border hover:bg-muted",
                  )}
                >
                  <input
                    type="radio"
                    name="report-reason"
                    value={r.key}
                    checked={reason === r.key}
                    onChange={() => setReason(r.key)}
                    className="accent-primary"
                  />
                  {r.label}
                </label>
              ))}
              {!answered && (
                <p className="text-[11px] text-muted-foreground">
                  Once you've answered, you can also report the marked answer or the explanation.
                </p>
              )}
            </fieldset>

            {reason === "wrong_answer" && question.options.length > 0 && (
              <section className="space-y-1.5" aria-labelledby="report-claim-heading">
                <h3 id="report-claim-heading" className="text-sm font-semibold">
                  Which option is right? <span className="font-normal text-muted-foreground">(if you know)</span>
                </h3>
                <div className="flex flex-wrap gap-1.5">
                  {question.options.map((opt, i) => (
                    <button
                      key={i}
                      type="button"
                      aria-pressed={claimed === i}
                      title={opt}
                      onClick={() => setClaimed(claimed === i ? null : i)}
                      className={cn(
                        "h-9 w-9 rounded-lg border text-sm font-bold transition-colors",
                        claimed === i ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted hover:bg-secondary",
                      )}
                    >
                      {String.fromCharCode(65 + i)}
                    </button>
                  ))}
                </div>
              </section>
            )}

            <section className="space-y-1.5">
              <label htmlFor="report-note" className="text-sm font-semibold">
                Note {chosen?.needsNote ? "" : <span className="font-normal text-muted-foreground">(optional)</span>}
              </label>
              <Textarea
                id="report-note"
                value={note}
                onChange={(e) => setNote(clampReportNote(e.target.value))}
                placeholder="What exactly is wrong? For example: the data for the case is missing."
                rows={3}
              />
              <div className={cn("text-right text-[11px] tabular-nums", noteCount >= REPORT_NOTE_MAX_CHARS ? "text-destructive" : "text-muted-foreground")}>
                {noteCount}/{REPORT_NOTE_MAX_CHARS}
              </div>
            </section>

            {planLimit && <PlanLimitNotice limit={planLimit} />}
          </>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" disabled={saving} onClick={() => onOpenChange(false)}>
            {editable ? "Cancel" : "Close"}
          </Button>
          {editable && (
            <Button type="button" disabled={saving || !chosen || missingNote} onClick={() => void send()}>
              {saving && <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" aria-hidden />}
              {saving ? "Sending…" : report ? "Update report" : "Send report"}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
