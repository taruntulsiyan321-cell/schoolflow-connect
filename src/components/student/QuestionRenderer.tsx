import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { Check, X } from "lucide-react";
import { MathText } from "@/components/MathText";
import { toDisplayText } from "@/lib/presentation";

/**
 * `options` and `correct` arrive as untyped `jsonb` from the question bank and
 * from generated Tests, so they are modelled as `unknown` and narrowed below.
 * They were previously `any`, which is what allowed a non-string option to
 * reach the renderer and display as "[object Object]".
 */
export type TestCorrect = {
  indexes?: unknown;
  value?: unknown;
  tolerance?: unknown;
  text?: unknown;
};

export type TestQuestionShape = {
  id: string;
  order_index: number;
  kind: "mcq" | "multi" | "numerical" | "short";
  question: string;
  options: unknown;
  correct?: TestCorrect | null;
  marks: number;
  explanation?: string | null;
};

/** Options that are safe to render, in their original order. */
function readOptions(raw: unknown): unknown[] {
  return Array.isArray(raw) ? raw : [];
}

/** Correct-answer indexes, ignoring anything that is not a real index. */
function readCorrectIndexes(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter((n): n is number => Number.isInteger(n) && (n as number) >= 0);
}

export type Response = { indexes?: number[]; value?: number; text?: string };

type Props = {
  question: TestQuestionShape;
  mode: "attempt" | "review";
  value: Response;
  onChange?: (r: Response) => void;
  isCorrect?: boolean | null;
};

export function QuestionRenderer({ question, mode, value, onChange, isCorrect }: Props) {
  const q = question;
  const opts = readOptions(q.options);
  const correctIdx = readCorrectIndexes(q.correct?.indexes);
  const selected = value.indexes ?? [];

  const toggle = (i: number) => {
    if (mode !== "attempt" || !onChange) return;
    if (q.kind === "mcq") onChange({ indexes: [i] });
    else onChange({ indexes: selected.includes(i) ? selected.filter(x => x !== i) : [...selected, i] });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <MathText block className="text-base leading-relaxed font-medium flex-1" text={q.question} />
        <span className="text-xs text-muted-foreground whitespace-nowrap">+{q.marks}</span>
      </div>

      {(q.kind === "mcq" || q.kind === "multi") && (
        <div className="space-y-2">
          {opts.map((opt, i) => {
            const isSel = selected.includes(i);
            const isRight = correctIdx.includes(i);
            const showState = mode === "review";
            return (
              <button
                key={i}
                type="button"
                onClick={() => toggle(i)}
                disabled={mode !== "attempt"}
                className={cn(
                  "w-full text-left px-4 py-3 rounded-lg border transition-all flex items-center gap-3",
                  mode === "attempt" && "hover:border-primary",
                  isSel && mode === "attempt" && "border-primary bg-primary/5",
                  showState && isRight && "border-accent bg-accent/10",
                  showState && isSel && !isRight && "border-destructive bg-destructive/10",
                )}
              >
                <span className="w-6 h-6 rounded-full border flex items-center justify-center text-xs font-semibold shrink-0">
                  {String.fromCharCode(65 + i)}
                </span>
                <MathText className="flex-1 text-sm" text={opt} />
                {showState && isRight && <Check className="w-4 h-4 text-accent" />}
                {showState && isSel && !isRight && <X className="w-4 h-4 text-destructive" />}
              </button>
            );
          })}
        </div>
      )}

      {q.kind === "numerical" && (
        <Input
          type="number"
          inputMode="decimal"
          placeholder="Enter a number"
          value={value.value ?? ""}
          disabled={mode !== "attempt"}
          onChange={(e) => onChange?.({ value: e.target.value === "" ? undefined : Number(e.target.value) })}
        />
      )}

      {q.kind === "short" && (
        <Textarea
          placeholder="Type your answer"
          value={value.text ?? ""}
          disabled={mode !== "attempt"}
          onChange={(e) => onChange?.({ text: e.target.value })}
          rows={3}
        />
      )}

      {mode === "review" && (
        <div className="text-xs space-y-1 mt-2">
          {q.kind === "numerical" && q.correct?.value !== undefined && (
            <div>
              Correct answer:{" "}
              <span className="font-semibold">
                {toDisplayText(q.correct.value, { kind: "label" })}
              </span>
              {q.correct.tolerance != null
                ? ` (±${toDisplayText(q.correct.tolerance, { kind: "label", fallback: "" })})`
                : ""}
            </div>
          )}
          {/* CHUNK 10.7 — Boolean(): q.correct.text is `unknown`, so the && chain
              could evaluate TO that unknown value and React would be asked to
              render it. The guard keeps the chain boolean. */}
          {q.kind === "short" && q.correct != null && Boolean(q.correct.text) && (
            /* Expected answers come from the bank and carry the same encoding
               risk as the stem, so they go through MathText like everything
               else the student reads. */
            <div>
              {/* CHUNK 10.7 — q.correct.text is `unknown`; through the same
                  presentation boundary the tolerance line above already uses. */}
              Expected: <MathText className="font-semibold" text={toDisplayText(q.correct.text, { kind: "label", fallback: "" })} />
            </div>
          )}
          {q.explanation && (
            <div className="rounded-md bg-muted p-3 text-muted-foreground mt-2">
              <span className="font-semibold text-foreground">Explanation: </span>
              <MathText text={q.explanation} />
            </div>
          )}
          {isCorrect != null && (
            <div className={isCorrect ? "text-accent font-medium" : "text-destructive font-medium"}>
              {isCorrect ? "Correct" : "Incorrect"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
