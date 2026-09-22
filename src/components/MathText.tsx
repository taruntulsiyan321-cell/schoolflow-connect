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

const isSpace = (c: string | undefined) => c === undefined || /\s/.test(c);
const isDigit = (c: string | undefined) => c !== undefined && c >= "0" && c <= "9";

/**
 * Where a single-dollar math span opened at `open` closes, or -1 if it does
 * not — the rule TeX-in-Markdown renderers use (pandoc): the opening `$` has a
 * non-space to its right, the closing `$` a non-space to its left and no digit
 * to its right. So "$x^2$" is math, while "$35 per ounce" and "between $10 and
 * $20" are prose: a price is not an equation.
 */
function closingDollar(s: string, open: number): number {
  if (isSpace(s[open + 1]) || s[open + 1] === "$") return -1;
  for (let k = open + 1; k < s.length; k++) {
    if (s[k] === "\\") { k++; continue; }
    if (s[k] === "$" && !isSpace(s[k - 1]) && !isDigit(s[k + 1])) return k;
  }
  return -1;
}

/**
 * Prose and math, in order.
 *
 * EVERY STEP CONSUMES INPUT. The tokenizer this replaced fell through to a
 * prose scanner whenever a delimiter had no partner, and that scanner stopped
 * on the very same character — so a lone `$`, `\(` or `\[` looped for ever and
 * froze the page until the renderer died. Measured 2026-09-22: a revision
 * check crashed the browser tab on the question "…convertible to gold at $35
 * per ounce", and four active bank questions carry a lone dollar sign. A
 * delimiter without its partner is prose, and `\$` is a literal dollar.
 */
function tokenize(input: string): Seg[] {
  const segs: Seg[] = [];
  let prose = "";
  const math = (kind: "inline" | "block", value: string) => {
    if (prose) segs.push({ kind: "text", value: prose });
    prose = "";
    segs.push({ kind, value });
  };
  let i = 0;
  while (i < input.length) {
    if (input.startsWith("\\$", i)) { prose += "$"; i += 2; continue; }
    if (input.startsWith("$$", i)) {
      const end = input.indexOf("$$", i + 2);
      if (end > i + 2) { math("block", input.slice(i + 2, end)); i = end + 2; continue; }
    } else if (input.startsWith("\\[", i) || input.startsWith("\\(", i)) {
      const close = input[i + 1] === "[" ? "\\]" : "\\)";
      const end = input.indexOf(close, i + 2);
      if (end > i + 2) { math(close === "\\]" ? "block" : "inline", input.slice(i + 2, end)); i = end + 2; continue; }
    } else if (input[i] === "$") {
      const end = closingDollar(input, i);
      if (end !== -1) { math("inline", input.slice(i + 1, end)); i = end + 1; continue; }
    }
    prose += input[i];
    i += 1;
  }
  if (prose) segs.push({ kind: "text", value: prose });
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
