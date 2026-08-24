import { useMemo } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import rehypeKatex from "rehype-katex";
import "katex/dist/katex.min.css";
import { cn } from "@/lib/utils";
import { fixUtf8Content } from "@/lib/utf8Text";
import { toAssistantMarkdown } from "@/lib/presentation";

/**
 * Renders an AI assistant reply as properly typeset markdown + math, instead of
 * leaking raw "**bold**", "\n", "\[ \]", "$$ $$" syntax to the student.
 *
 * remark-math only recognizes $...$ / $$...$$ delimiters, but models (and the
 * user's own pasted examples) also emit \( \) / \[ \] — so those are normalized
 * to dollar-delimited form first, matching what MathText.tsx already tokenizes.
 */
type Props = {
  /**
   * `unknown` on purpose — model output is not guaranteed to be a string, and
   * this component screens it through the presentation boundary before it is
   * treated as markdown. See MathText for the same reasoning.
   */
  text?: unknown;
  className?: string;
};

function normalizeMathDelimiters(input: string): string {
  return input
    .replace(/\\\[([\s\S]*?)\\\]/g, (_m, inner) => `$$${inner}$$`)
    .replace(/\\\(([\s\S]*?)\\\)/g, (_m, inner) => `$${inner}$`);
}

const components: Components = {
  p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
  strong: ({ children }) => <strong className="font-semibold text-foreground">{children}</strong>,
  em: ({ children }) => <em className="italic">{children}</em>,
  ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-0.5">{children}</li>,
  h1: ({ children }) => <h3 className="mb-1.5 mt-2 text-[15px] font-semibold text-white first:mt-0">{children}</h3>,
  h2: ({ children }) => <h4 className="mb-1.5 mt-2 text-[14px] font-semibold text-white first:mt-0">{children}</h4>,
  h3: ({ children }) => <h5 className="mb-1 mt-2 text-[13px] font-semibold text-white first:mt-0">{children}</h5>,
  h4: ({ children }) => <h6 className="mb-1 mt-2 text-[13px] font-semibold text-white first:mt-0">{children}</h6>,
  blockquote: ({ children }) => (
    <blockquote className="mb-2 border-l-2 border-border pl-3 italic text-[#9ca3c0] last:mb-0">{children}</blockquote>
  ),
  hr: () => <hr className="my-2 border-border" />,
  a: ({ children, href }) => (
    <a href={href} target="_blank" rel="noopener noreferrer" className="underline text-[#7aa2f7] hover:text-[#93b4ff]">
      {children}
    </a>
  ),
  code: ({ className, children, ...rest }) => {
    const isBlock = /language-/.test(className ?? "");
    if (isBlock) {
      return (
        <code className={cn("font-mono text-[12.5px]", className)} {...rest}>
          {children}
        </code>
      );
    }
    return (
      <code className="rounded bg-white/10 px-1 py-0.5 font-mono text-[12.5px]" {...rest}>
        {children}
      </code>
    );
  },
  pre: ({ children }) => (
    <pre className="mb-2 overflow-x-auto rounded-lg bg-black/30 p-2.5 last:mb-0">{children}</pre>
  ),
  table: ({ children }) => (
    <div className="mb-2 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-[12.5px]">{children}</table>
    </div>
  ),
  thead: ({ children }) => <thead className="border-b border-border">{children}</thead>,
  tr: ({ children }) => <tr className="border-b border-white/5 last:border-0">{children}</tr>,
  th: ({ children }) => <th className="px-2 py-1 text-left font-semibold text-foreground">{children}</th>,
  td: ({ children }) => <td className="px-2 py-1 align-top">{children}</td>,
};

export function NovaMarkdown({ text, className }: Props) {
  // Model output is screened before it is treated as prose: tool-call blocks,
  // internal markers, bare identifiers and whole-JSON replies never reach the
  // renderer. See src/lib/presentation/aiText.ts for why this lives here
  // rather than at each call site.
  const screened = useMemo(() => toAssistantMarkdown(text), [text]);
  const normalized = useMemo(
    () => (screened.unusable ? "" : normalizeMathDelimiters(fixUtf8Content(screened.markdown))),
    [screened],
  );

  if (screened.unusable) {
    // An intentional message beats rendering the machinery that produced it.
    return (
      <div className={cn("text-sm leading-relaxed text-[#9ca3c0] italic", className)}>
        This answer couldn&apos;t be displayed. Please ask again.
      </div>
    );
  }

  return (
    <div className={cn("math-text text-sm leading-relaxed", className)}>
      <ReactMarkdown
        remarkPlugins={[remarkGfm, remarkMath]}
        rehypePlugins={[[rehypeKatex, { throwOnError: false, strict: "ignore", trust: false }]]}
        components={components}
      >
        {normalized}
      </ReactMarkdown>
    </div>
  );
}

export default NovaMarkdown;
