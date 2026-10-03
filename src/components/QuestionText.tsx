import { MathText } from "@/components/MathText";
import { cn } from "@/lib/utils";
import {
  FORM_LABELS,
  formOf,
  type LayoutBlock,
  questionOneLine,
  readQuestionLayout,
} from "../../supabase/functions/_shared/questionForms.ts";

type Props = {
  /** The question's stored text. Untyped jsonb reaches here; anything else shows as nothing. */
  text: unknown;
  /** Its options: a trailing A–D list that only repeats them is not shown twice. */
  options?: ReadonlyArray<unknown> | null;
  className?: string;
  /** One line, for a card, a list or a dialog's heading. */
  compact?: boolean;
};

const asText = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * Every question the app shows, laid out by its form (owner, 2026-10-03):
 * Assertion and Reason as two statements with space between them, numbered
 * statements as a list, the two lists of a match side by side, a case in its
 * own box above its question. The layout is read from the question's text
 * (supabase/functions/_shared/questionForms.ts), so a question shown from an
 * attempt, a mistake or a report is laid out the same as from the bank.
 */
export function QuestionText({ text, options, className, compact = false }: Props) {
  const opts = Array.isArray(options) ? options.map(asText) : null;
  if (compact) return <MathText className={className} text={questionOneLine(asText(text), opts)} />;
  const blocks = readQuestionLayout(asText(text), opts);
  if (blocks.length === 0) return null;
  return (
    <div className={cn("space-y-3", className)} data-testid="question-text">
      {blocks.map((b, i) => <Block key={i} block={b} />)}
    </div>
  );
}

/**
 * The question's form as a chip beside its subject and difficulty —
 * "Assertion–reason", "Match the following" — read from its text by the same
 * rule the database files it under. Nothing for a direct question.
 */
export function QuestionFormBadge({ text, options }: { text: unknown; options?: ReadonlyArray<unknown> | null }) {
  const form = formOf(asText(text), Array.isArray(options) ? options.map(asText) : null);
  if (form === "mcq") return null;
  return (
    <span className="inline-flex items-center rounded-full border border-border bg-muted px-2.5 py-1 text-[10px] font-semibold text-foreground" data-testid="question-form">
      {FORM_LABELS[form]}
    </span>
  );
}

function Block({ block }: { block: LayoutBlock }) {
  switch (block.kind) {
    case "case":
      return (
        <div className="rounded-xl border border-border bg-muted/40 p-4 text-sm font-normal leading-relaxed text-foreground" data-testid="question-case">
          <div className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Case</div>
          <div className="space-y-2">
            {block.paragraphs.map((p, i) => <p key={i}><MathText text={p} /></p>)}
          </div>
        </div>
      );
    case "paragraph":
      return (
        <p>
          {block.lines.map((l, i) => <span key={i} className="block"><MathText text={l} /></span>)}
        </p>
      );
    case "assertion_reason":
      return (
        <div className="space-y-3" data-testid="question-assertion-reason">
          <p><span className="font-bold">Assertion (A):</span> <MathText text={block.assertion} /></p>
          <p><span className="font-bold">Reason (R):</span> <MathText text={block.reason} /></p>
        </div>
      );
    case "list":
      return (
        <ol className="space-y-1.5" data-testid="question-list">
          {block.items.map((it) => (
            <li key={it.label} className="flex gap-2">
              <span className="w-8 shrink-0 font-bold">{it.label}.</span>
              <span className="min-w-0 flex-1"><MathText text={it.text} /></span>
            </li>
          ))}
        </ol>
      );
    case "match": {
      const rows = Math.max(block.list1.length, block.list2.length);
      return (
        <div className="overflow-x-auto" data-testid="question-match">
          <table className="w-full border-collapse text-sm font-normal">
            <thead>
              <tr className="text-left">
                <th className="border border-border bg-muted/50 px-3 py-2 font-semibold">List I{block.list1Title ? ` (${block.list1Title})` : ""}</th>
                <th className="border border-border bg-muted/50 px-3 py-2 font-semibold">List II{block.list2Title ? ` (${block.list2Title})` : ""}</th>
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: rows }, (_, i) => (
                <tr key={i} className="align-top">
                  {[block.list1[i], block.list2[i]].map((it, k) => (
                    <td key={k} className="border border-border px-3 py-2">
                      {it && (
                        <span className="flex gap-2">
                          <span className="w-7 shrink-0 font-bold">{it.label}.</span>
                          <span className="min-w-0 flex-1"><MathText text={it.text} /></span>
                        </span>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    }
  }
}
