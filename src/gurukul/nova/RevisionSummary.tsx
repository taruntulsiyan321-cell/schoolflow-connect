import { AlertCircle, BookOpen, Check, Circle, Mic, Search } from "lucide-react";
import { ProgressRing } from "@/gurukul/components/shared";
import type { RevisionGist } from "./novaRevisionClient";
import type { TestOutcome } from "./FeynmanTest";

/**
 * Step 3 of revision mode: what the student explained, what they didn't, and
 * what Nova had to correct. Every number here is counted from the session —
 * nothing is scored by the model.
 */
export function RevisionSummary({
  gist,
  outcome,
  onRetry,
  onReadGist,
  onNewTopic,
}: {
  gist: RevisionGist;
  outcome: TestOutcome;
  onRetry: () => void;
  onReadGist: () => void;
  onNewTopic: () => void;
}) {
  const total = gist.key_points.length;
  const explained = outcome.covered.length;
  const pct = Math.round((explained / total) * 100);
  const missed = gist.key_points.map((p, i) => ({ ...p, i })).filter((p) => !outcome.covered.includes(p.i));

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-3xl space-y-6 px-4 py-6">
        <div className="flex items-center gap-4">
          <ProgressRing value={pct} size={84} label={`${explained} of ${total} key ideas explained`}>
            <span className="text-lg font-black text-foreground">
              {explained}/{total}
            </span>
          </ProgressRing>
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{gist.title}</div>
            <h2 className="text-xl font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
              {explained === total
                ? "You explained every key idea"
                : explained === 0
                  ? "No key idea explained yet"
                  : `You explained ${explained} of ${total} key ideas`}
            </h2>
            <p className="text-xs text-muted-foreground">
              {outcome.answers === 0
                ? "You finished before answering."
                : `${outcome.answers} ${outcome.answers === 1 ? "answer" : "answers"} given`}
            </p>
          </div>
        </div>

        <section className="space-y-2">
          <h3 className="text-sm font-bold text-foreground">Key ideas</h3>
          <ul className="space-y-2">
            {gist.key_points.map((p, i) => {
              const done = outcome.covered.includes(i);
              return (
                <li key={i} data-testid={done ? "summary-done" : "summary-missed"} className="flex gap-2.5 rounded-xl border border-border/70 bg-surface p-3">
                  {done ? (
                    <Check className="mt-0.5 h-4 w-4 shrink-0 text-success" />
                  ) : (
                    <Circle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                  )}
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-foreground">{p.heading}</div>
                    {!done && <p className="text-sm leading-relaxed text-muted-foreground">Remember: {p.detail}</p>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>

        {outcome.corrections.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-sm font-bold text-foreground">What Nova corrected</h3>
            <ul className="space-y-2">
              {outcome.corrections.map((c, i) => (
                <li key={i} className="flex gap-2.5 rounded-xl bg-warning/10 p-3 text-sm text-foreground">
                  <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-warning" /> {c}
                </li>
              ))}
            </ul>
          </section>
        )}

        <div className="grid gap-2 sm:grid-cols-3">
          <button
            type="button"
            onClick={onRetry}
            className="flex items-center justify-center gap-2 rounded-2xl bg-primary px-4 py-3 text-sm font-bold text-primary-foreground transition-all hover:bg-primary/90"
          >
            <Mic className="h-4 w-4" /> {missed.length ? "Explain it again" : "Test me again"}
          </button>
          <button
            type="button"
            onClick={onReadGist}
            className="flex items-center justify-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted"
          >
            <BookOpen className="h-4 w-4" /> Read the gist
          </button>
          <button
            type="button"
            onClick={onNewTopic}
            className="flex items-center justify-center gap-2 rounded-2xl border border-border px-4 py-3 text-sm font-semibold text-foreground transition-all hover:bg-muted"
          >
            <Search className="h-4 w-4" /> Another topic
          </button>
        </div>
      </div>
    </div>
  );
}
