import { ChevronLeft, Lightbulb, Loader2, Mic, RotateCcw, Wand2 } from "lucide-react";
import { cn } from "@/gurukul/components/shared";
import type { RevisionGist, RevisionStyle } from "./novaRevisionClient";

/**
 * Step 1 of revision mode: the gist. Its key ideas are exactly what the
 * Feynman test that follows is judged against, and the screen says so.
 */
export function RevisionGistView({
  gist,
  style,
  reloading,
  onBack,
  onRegenerate,
  onStartTest,
}: {
  gist: RevisionGist;
  style: RevisionStyle;
  /** A regenerate or simpler request is in flight. */
  reloading: boolean;
  onBack: () => void;
  onRegenerate: (style: RevisionStyle) => void;
  onStartTest: () => void;
}) {
  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
        <button
          type="button"
          onClick={onBack}
          aria-label="Choose another topic"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-all hover:bg-muted hover:text-foreground"
        >
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="flex-1" />
        {style === "standard" && (
          <button
            type="button"
            disabled={reloading}
            onClick={() => onRegenerate("simpler")}
            className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground disabled:opacity-50"
          >
            <Wand2 className="h-3.5 w-3.5" /> Explain it simpler
          </button>
        )}
        <button
          type="button"
          disabled={reloading}
          onClick={() => onRegenerate(style)}
          className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-muted-foreground transition-all hover:bg-muted hover:text-foreground disabled:opacity-50"
        >
          {reloading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <RotateCcw className="h-3.5 w-3.5" />}
          Regenerate
        </button>
      </div>

      <div className={cn("flex-1 overflow-y-auto transition-opacity", reloading && "opacity-50")}>
        <article className="mx-auto w-full max-w-3xl space-y-7 px-4 py-6">
          <div className="space-y-3">
            <h2 className="text-2xl font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              {gist.title}
            </h2>
            <p className="flex items-start gap-2 rounded-xl border border-warning/25 bg-warning/10 px-3 py-2.5 text-sm text-foreground">
              <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
              <span>{gist.one_liner}</span>
            </p>
          </div>

          <section className="space-y-2">
            <h3 className="text-base font-bold text-foreground">
              <span className="text-primary">1.</span> What is {gist.title}?
            </h3>
            <p className="text-sm leading-relaxed text-muted-foreground">{gist.what_is_it}</p>
          </section>

          <section className="space-y-3">
            <div>
              <h3 className="text-base font-bold text-foreground">
                <span className="text-primary">2.</span> Key ideas
              </h3>
              <p className="text-xs text-muted-foreground">
                These {gist.key_points.length} are what you'll explain back to Nova.
              </p>
            </div>
            <ol className="space-y-3">
              {gist.key_points.map((p, i) => (
                <li key={i} className="flex gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/15 text-[11px] font-bold text-primary">
                    {i + 1}
                  </span>
                  <div>
                    <div className="text-sm font-semibold text-foreground">{p.heading}</div>
                    <p className="text-sm leading-relaxed text-muted-foreground">{p.detail}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {gist.examples.length > 0 && (
            <section className="space-y-2">
              <h3 className="text-base font-bold text-foreground">
                <span className="text-primary">3.</span> Examples
              </h3>
              <ul className="list-disc space-y-1.5 pl-5 text-sm leading-relaxed text-muted-foreground">
                {gist.examples.map((e, i) => (
                  <li key={i}>{e}</li>
                ))}
              </ul>
            </section>
          )}
        </article>
      </div>

      <div className="shrink-0 border-t border-border px-4 pb-4 pt-3">
        <div className="mx-auto w-full max-w-3xl">
          <button
            type="button"
            onClick={onStartTest}
            disabled={reloading}
            className="flex w-full items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3.5 text-sm font-bold text-primary-foreground shadow-card transition-all hover:bg-primary/90 disabled:opacity-50"
          >
            <Mic className="h-4 w-4" /> Start Feynman Test
          </button>
          <p className="mt-1.5 text-center text-[11px] text-muted-foreground">
            Explain it back out loud, in your own words — Nova will cross-question you.
          </p>
        </div>
      </div>
    </div>
  );
}
