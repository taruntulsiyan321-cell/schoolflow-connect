import { Check, Timer, X } from "lucide-react";
import { Card } from "@/components/ui/card";
import { MathText } from "@/components/MathText";
import { QuestionFormBadge, QuestionText } from "@/components/QuestionText";
import { ExplainPanel } from "@/components/learn/ExplainPanel";
import { QuestionMarkBar } from "@/components/student/questionMarks/QuestionMarkBar";
import { ReportQuestionButton } from "@/components/student/questionReports/ReportQuestionButton";
import { ReportStatusLine } from "@/components/student/questionReports/ReportOutcome";
import { cn } from "@/lib/utils";
import { formatSessionDuration } from "@/lib/practiceSessionStats";
import { markRefFromAttempt, type MarkTag, type QuestionMark } from "@/lib/questionMarks";
import type { QuestionReport } from "@/lib/questionReports";
import type { AttemptRow } from "./types";

type Props = {
  attempt: AttemptRow;
  /** Position in the session, from 0. */
  order: number;
  /** Why this answer stands out, from the session's analysis: "Rushed", "Fixed since last time"… */
  notes: string[];
  subjectRaw: string;
  chapterRaw: string;
  sessionId: string | null;
  userId: string | null;
  mark: QuestionMark | null;
  markTags: MarkTag[];
  onMark: (questionId: string, mark: QuestionMark | null) => void;
  report: QuestionReport | null;
  onReport: (report: QuestionReport) => void;
  onAskNova: (context: { question: string; options: string[]; correctIndex: number | null; selectedText: string; selectedIndex: number | null }) => void;
};

/**
 * One question of the session under review: what was asked, the right answer
 * and the student's, what the analysis noticed about it, and the student's
 * own tools — explain it, mark why it went wrong, report it.
 */
export function SessionQuestionCard({
  attempt: a, order, notes, subjectRaw, chapterRaw, sessionId, userId, mark, markTags, onMark, report, onReport, onAskNova,
}: Props) {
  const gq = a.generated_question ?? {};
  const opts: string[] = Array.isArray(gq.options) ? gq.options : [];
  const correctIdx = typeof a.correct_answer?.index === "number" ? a.correct_answer.index : null;
  const selectedIdx = typeof a.selected_answer?.index === "number" ? a.selected_answer.index : null;
  const correctText = a.correct_answer?.text ?? (correctIdx != null ? opts[correctIdx] ?? "" : "");
  const selectedText = a.selected_answer?.text ?? (selectedIdx != null ? opts[selectedIdx] ?? "" : "");
  const questionText = gq.question ?? "";
  const markRef = markRefFromAttempt(a);

  return (
    <Card id={`question-${order + 1}`} className="scroll-mt-24 p-5 transition-shadow hover:shadow-sm" data-testid="session-question">
      <div className="mb-2 flex items-center justify-between gap-3 text-xs text-muted-foreground">
        <span className="flex flex-wrap items-center gap-2">
          Q{order + 1}{a.skipped ? " · Skipped" : ""}
          <QuestionFormBadge text={questionText} options={opts} />
          {notes.map((n) => (
            <span key={n} className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] font-semibold text-foreground">{n}</span>
          ))}
        </span>
        {/* Time on this question alone. Nothing when it was not timed — a blank is not a zero. */}
        {typeof a.time_taken_ms === "number" && a.time_taken_ms > 0 && (
          <span className="inline-flex items-center gap-1 tabular-nums" data-testid="question-time">
            <Timer className="h-3.5 w-3.5" aria-hidden />
            {formatSessionDuration(a.time_taken_ms)}
          </span>
        )}
      </div>
      <QuestionText className="mb-4 text-base font-medium leading-relaxed" text={questionText} options={opts} />
      <div className="mb-4 space-y-2">
        {opts.map((opt, oi) => {
          const isSel = oi === selectedIdx;
          const isRight = oi === correctIdx;
          return (
            <div
              key={oi}
              data-testid={isRight ? "option-right" : isSel ? "option-chosen-wrong" : "option"}
              className={cn(
                // The fill, the border and the mark say which is right; the text
                // stays the foreground, as on the practice screen (text on its own
                // tint measured 4.13:1). The right answer is never the accent — in
                // this panel the accent is rose, the wrong answer's family.
                "flex w-full items-center gap-3 rounded-lg border px-4 py-3 text-left text-sm text-foreground",
                isRight && "border-success/50 bg-success/10",
                isSel && !isRight && "border-destructive/50 bg-destructive/10",
                !isSel && !isRight && "border-border",
              )}
            >
              <span className="shrink-0 font-semibold">{String.fromCharCode(65 + oi)}.</span>
              <MathText className="flex-1" text={opt} />
              {isRight && <Check className="h-4 w-4 shrink-0 text-success" aria-label="The right answer" />}
              {isSel && !isRight && <X className="h-4 w-4 shrink-0 text-destructive" aria-label="Your answer" />}
            </div>
          );
        })}
      </div>
      <ExplainPanel
        question={questionText}
        options={opts}
        correctIndex={correctIdx}
        selectedIndex={selectedIdx}
        correctText={correctText}
        selectedText={selectedText}
        subject={subjectRaw}
        chapter={chapterRaw}
        wasCorrect={a.is_correct}
        onAskNova={() => onAskNova({ question: questionText, options: opts, correctIndex: correctIdx, selectedText, selectedIndex: selectedIdx })}
      />
      {userId && markRef && questionText && (
        <QuestionMarkBar
          className="mt-4"
          userId={userId}
          questionRef={markRef}
          question={{
            text: questionText,
            subject: a.subject || gq.subject || subjectRaw || null,
            chapter: a.chapter || gq.chapter || chapterRaw || null,
          }}
          mark={mark}
          tags={markTags}
          onChange={(m) => onMark(markRef.id, m)}
          actions={markRef.kind === "bank" ? (
            <ReportQuestionButton
              variant="button"
              questionId={markRef.id}
              question={{ text: questionText, options: opts }}
              answered
              sessionId={sessionId}
              report={report}
              onChange={onReport}
            />
          ) : undefined}
        />
      )}
      {report && <div className="mt-2"><ReportStatusLine report={report} /></div>}
    </Card>
  );
}
