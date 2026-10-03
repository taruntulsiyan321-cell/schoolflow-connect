import { useMemo, useState, type ReactNode } from "react";
import { Tag } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MarkTag, MarkedQuestion, QuestionMark, QuestionRef } from "@/lib/questionMarks";
import { QuestionMarkDialog } from "./QuestionMarkDialog";
import { VoiceNotePlayer } from "./VoiceNotePlayer";

type Props = {
  userId: string;
  questionRef: QuestionRef;
  question: MarkedQuestion;
  mark: QuestionMark | null;
  tags: MarkTag[];
  onChange: (mark: QuestionMark | null) => void;
  /** Beside the Mark button: the report control, on a bank question. */
  actions?: ReactNode;
  className?: string;
};

/**
 * Under a question: what the student has said about it, and the button to say
 * it. The same bar on the session result and in the Mistake Book.
 */
export function QuestionMarkBar({ userId, questionRef, question, mark, tags, onChange, actions, className }: Props) {
  const [open, setOpen] = useState(false);
  const labels = useMemo(() => new Map(tags.map((t) => [t.key, t.label])), [tags]);

  return (
    <div className={cn("space-y-2", className)} data-testid="question-mark-bar">
      {mark && (
        <div className="space-y-1.5">
          {mark.tags.length > 0 && (
            <div className="flex flex-wrap gap-1.5" aria-label="Your marks">
              {mark.tags.map((k) => (
                <span key={k} className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-semibold text-primary">
                  {labels.get(k) ?? k}
                </span>
              ))}
            </div>
          )}
          {mark.note && <p className="whitespace-pre-line text-xs italic text-muted-foreground">“{mark.note}”</p>}
          {mark.voicePath && <VoiceNotePlayer path={mark.voicePath} seconds={mark.voiceSeconds} />}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-border bg-muted px-3 py-1.5 text-xs font-semibold text-foreground hover:bg-secondary"
        >
          <Tag className="h-3.5 w-3.5" aria-hidden />
          {mark ? "Edit mark" : "Mark"}
        </button>
        {actions}
      </div>
      <QuestionMarkDialog
        open={open}
        onOpenChange={setOpen}
        userId={userId}
        questionRef={questionRef}
        question={question}
        tags={tags}
        mark={mark}
        onSaved={onChange}
      />
    </div>
  );
}
