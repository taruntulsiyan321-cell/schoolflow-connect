import { useMemo } from "react";
import katex from "katex";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { fixUtf8Content } from "@/lib/utf8Text";
import { toDisplayText } from "@/lib/presentation";

/**
 * Renders text with inline math. Detection rules:
 *  - `$...$`, `\(...\)` -> inline math
 *  - `$$...$$`, `\[...\]` -> display math
 *  - bare expressions with math operators (^, _, \frac, sqrt, =) wrapped in a span with
 *    `katex`-rendered glyphs when they parse cleanly. Plain prose passes through unchanged.
 *
 * UTF-8 mojibake is repaired at the root via fixUtf8Content so π θ √ α β Σ ∞ ≤ ≥ ± × ÷
 * and vulgar fractions survive import/DB/API paths without page-level char maps.
 *
 * The output is rendered "on screen" (proper typeset glyphs), not as raw typed text.
 */
type Props = {
  /**
   * Deliberately `unknown`: question stems, options and correct answers come
   * from untyped `jsonb`, and AI output is not guaranteed to be a string.
   * This component screens whatever it is given through the presentation
   * boundary, so accepting `unknown` is the honest signature — it stops
   * callers from having to cast, which is how "[object Object]" got on screen.
   */
  text?: unknown;
  className?: string;
  block?: boolean;
};

type Seg = { kind: "text" | "inline" | "block"; value: string };

function tokenize(input: string): Seg[] {
  const segs: Seg[] = [];
  let i = 0;
  const push = (kind: Seg["kind"], v: string) => { if (v) segs.push({ kind, value: v }); };
  while (i < input.length) {
    // $$ ... $$
    if (input.startsWith("$$", i)) {
      const end = input.indexOf("$$", i + 2);
      if (end !== -1) { push("block", input.slice(i + 2, end)); i = end + 2; continue; }
    }
    // \[ ... \]
    if (input.startsWith("\\[", i)) {
      const end = input.indexOf("\\]", i + 2);
      if (end !== -1) { push("block", input.slice(i + 2, end)); i = end + 2; continue; }
    }
    // \( ... \)
    if (input.startsWith("\\(", i)) {
      const end = input.indexOf("\\)", i + 2);
      if (end !== -1) { push("inline", input.slice(i + 2, end)); i = end + 2; continue; }
    }
    // $ ... $
    if (input[i] === "$") {
      const end = input.indexOf("$", i + 1);
      if (end !== -1 && end - i > 1) { push("inline", input.slice(i + 1, end)); i = end + 1; continue; }
    }
    // plain text — accumulate until next delimiter
    let j = i;
    while (j < input.length) {
      const c = input[j];
      if (c === "$") break;
      if (c === "\\" && (input[j + 1] === "(" || input[j + 1] === "[")) break;
      j++;
    }
    push("text", input.slice(i, j));
    i = j;
  }
  return segs;
}

function render(html: string, kind: "inline" | "block") {
  return { __html: html };
}

export function MathText({ text, className, block }: Props) {
  // `text` is declared as string, but the values that actually reach it come
  // from `any`-typed question payloads (`options: any`, `correct: any`) and
  // from AI output. Handing a non-string to fixUtf8Content produced
  // "[object Object]" on screen, so the presentation boundary screens it first
  // and yields an intentional empty string instead of a stringified object.
  const cleaned = useMemo(
    () => fixUtf8Content(toDisplayText(text, { fallback: "", allowEmpty: true })),
    [text],
  );
  const segs = useMemo(() => tokenize(cleaned), [cleaned]);
  const Tag = block ? "div" : "span";
  return (
    <Tag className={cn("math-text", className)}>
      {segs.map((s, idx) => {
        if (s.kind === "text") return <span key={idx}>{s.value}</span>;
        try {
          const html = katex.renderToString(s.value, {
            throwOnError: false,
            output: "html",
            displayMode: s.kind === "block",
            strict: "ignore",
            trust: false,
          });
          return (
            <span
              key={idx}
              className={s.kind === "block" ? "block my-2" : "inline-block align-middle"}
              dangerouslySetInnerHTML={render(html, s.kind)}
            />
          );
        } catch {
          return <span key={idx}>{s.value}</span>;
        }
      })}
    </Tag>
  );
}

export default MathText;
