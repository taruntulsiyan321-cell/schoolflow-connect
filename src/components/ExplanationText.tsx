import { MathText } from "@/components/MathText";
import { readExplanation } from "@/lib/explanationText";
import { cn } from "@/lib/utils";

/**
 * Every explanation the app shows: the answer, the working step by step, and
 * why each other option is wrong — or, for one not yet rewritten, its
 * paragraphs with their line breaks kept. Math renders in each line.
 */
export function ExplanationText({ text, className }: { text: unknown; className?: string }) {
  const read = readExplanation(text);
  if (!read) return null;

  if (read.kind === "plain") {
    return (
      <div className={cn("space-y-2", className)} data-testid="explanation-plain">
        {read.paragraphs.map((lines, i) => (
          <p key={i} className="leading-relaxed">
            {lines.map((l, k) => (
              <span key={k} className="block"><MathText text={l} /></span>
            ))}
          </p>
        ))}
      </div>
    );
  }

  return (
    <div className={cn("space-y-3", className)} data-testid="explanation-structured">
      <p className="font-semibold text-foreground">
        Answer: ({read.answer.letter}) <MathText text={read.answer.text} />
      </p>
      {read.working.map((lines, i) => (
        <p key={i} className="leading-relaxed">
          {lines.map((l, k) => (
            <span key={k} className="block"><MathText text={l} /></span>
          ))}
        </p>
      ))}
      <div>
        <p className="mb-1 font-semibold text-foreground">Why the other options are wrong</p>
        <ul className="space-y-1">
          {read.wrong.map((w) => (
            <li key={w.letter} className="flex gap-2 leading-relaxed">
              <span className="shrink-0 font-semibold">({w.letter})</span>
              <span><MathText text={w.reason} /></span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
