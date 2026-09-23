import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { BookOpen, MessageSquare, Mic, MicOff, Sparkles, Target, X } from "lucide-react";
import { useAcademicContext } from "@/academic";
import { useGurukulStudent } from "@/gurukul/StudentContext";
import { useRevisionItems } from "@/gurukul/pages/useRevisionQueueV2";
import { displayChapter } from "@/lib/academicDisplay";
import { LoadingState, cn } from "@/gurukul/components/shared";
import { REVISION_LIMITS, fetchRevisionGist, type RevisionGist, type RevisionStyle } from "./novaRevisionClient";
import { RevisionGistView } from "./RevisionGistView";
import { FeynmanTest, type TestOutcome } from "./FeynmanTest";
import { RevisionSummary } from "./RevisionSummary";
import { getRecognitionCtor } from "./useSpeechCapture";

/**
 * Nova's Revision mode. Any topic → a gist → the Feynman test (explain it back
 * out loud, get cross-questioned) → what you explained and what you missed.
 */

export type NovaMode = "chat" | "revision";

export function NovaModeSwitch({ mode, onChange }: { mode: NovaMode; onChange: (m: NovaMode) => void }) {
  const tabs: { id: NovaMode; label: string; icon: JSX.Element }[] = [
    { id: "chat", label: "Chat", icon: <MessageSquare className="h-3.5 w-3.5" /> },
    { id: "revision", label: "Revision", icon: <Target className="h-3.5 w-3.5" /> },
  ];
  return (
    <div className="flex shrink-0 justify-center border-b border-border px-4 py-2">
      <div role="tablist" aria-label="Nova mode" className="flex rounded-xl bg-muted p-1">
        {tabs.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={mode === t.id}
            onClick={() => onChange(t.id)}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-4 py-1.5 text-xs font-semibold transition-all",
              mode === t.id ? "bg-background text-foreground shadow-card" : "text-muted-foreground hover:text-foreground",
            )}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Starting points for "any topic" — prompts, not data about the student. */
const TRY_ANYTHING = [
  "Photosynthesis",
  "How the internet works",
  "Compound interest",
  "Newton's laws of motion",
  "How vaccines work",
  "The French Revolution",
];

const LOADING_STEPS = ["Reading up on", "Picking the key ideas of", "Writing your gist of"];

type Active = { topic: string; subject: string; style: RevisionStyle; gist: RevisionGist };
type Screen = { kind: "pick" } | { kind: "gist" } | { kind: "test"; attempt: number } | { kind: "summary"; outcome: TestOutcome };

export function NovaRevisionMode({ weakConcepts }: { weakConcepts: string[] }) {
  const student = useGurukulStudent();
  const { ctx, ready } = useAcademicContext();
  const { items: revisionItems } = useRevisionItems(ctx, ready);

  const [input, setInput] = useState("");
  const [screen, setScreen] = useState<Screen>({ kind: "pick" });
  const [active, setActive] = useState<Active | null>(null);
  const [loading, setLoading] = useState<{ topic: string; reload: boolean } | null>(null);
  const [loadingStep, setLoadingStep] = useState(0);
  const [error, setError] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const grade = student.class;

  const dueChapters = useMemo(
    () =>
      [...revisionItems]
        .sort((a, b) => b.priority - a.priority)
        .slice(0, 6)
        .map((r) => ({ label: displayChapter(r.chapter), subject: r.subject, due: r.priority === 100 })),
    [revisionItems],
  );

  useEffect(() => () => abortRef.current?.abort(), []);

  useEffect(() => {
    if (!loading || loading.reload) return;
    setLoadingStep(0);
    const timers = [3000, 7000].map((ms, i) => setTimeout(() => setLoadingStep(i + 1), ms));
    return () => timers.forEach(clearTimeout);
  }, [loading]);

  async function loadGist(topic: string, subject: string, style: RevisionStyle, reload: boolean) {
    const clean = topic.replace(/\s+/g, " ").trim();
    if (!clean) return;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    setError("");
    setLoading({ topic: clean, reload });
    const result = await fetchRevisionGist({ topic: clean, subject, grade, style }, controller.signal);
    if (!result) return; // cancelled
    setLoading(null);
    if (!result.ok) {
      if (reload) toast.error(result.error);
      else setError(result.error);
      return;
    }
    setActive({ topic: clean, subject, style, gist: result.value });
    setScreen({ kind: "gist" });
  }

  function cancelLoading() {
    abortRef.current?.abort();
    setLoading(null);
  }

  if (loading && !loading.reload) {
    return (
      <div className="flex h-full flex-col items-center justify-center px-6 text-center">
        <LoadingState label={`${LOADING_STEPS[loadingStep]} ${loading.topic}…`} />
        <button
          type="button"
          onClick={cancelLoading}
          className="-mt-10 flex items-center gap-1 rounded-lg px-3 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <X className="h-3.5 w-3.5" /> Cancel
        </button>
      </div>
    );
  }

  if (active && screen.kind === "gist") {
    return (
      <RevisionGistView
        gist={active.gist}
        style={active.style}
        reloading={!!loading?.reload}
        onBack={() => setScreen({ kind: "pick" })}
        onRegenerate={(style) => void loadGist(active.topic, active.subject, style, true)}
        onStartTest={() => setScreen({ kind: "test", attempt: Date.now() })}
      />
    );
  }

  if (active && screen.kind === "test") {
    return (
      <FeynmanTest
        key={screen.attempt}
        gist={active.gist}
        subject={active.subject}
        grade={grade}
        onBack={() => setScreen({ kind: "gist" })}
        onFinish={(outcome) => setScreen({ kind: "summary", outcome })}
      />
    );
  }

  if (active && screen.kind === "summary") {
    return (
      <RevisionSummary
        gist={active.gist}
        outcome={screen.outcome}
        onRetry={() => setScreen({ kind: "test", attempt: Date.now() })}
        onReadGist={() => setScreen({ kind: "gist" })}
        onNewTopic={() => { setInput(""); setScreen({ kind: "pick" }); }}
      />
    );
  }

  const chip = "rounded-full border border-border/70 bg-surface/60 px-3 py-1.5 text-xs text-muted-foreground transition-all hover:border-primary/40 hover:text-foreground";

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-2xl space-y-7 px-4 py-8">
        <div className="space-y-1 text-center">
          <h2 className="text-2xl font-black text-foreground" style={{ fontFamily: "var(--font-display)" }}>
            Revise any topic
          </h2>
          <p className="text-sm text-muted-foreground">Nova gives you the gist — then you explain it back, out loud.</p>
        </div>

        {!getRecognitionCtor() && (
          <p role="alert" className="flex items-start gap-2 rounded-2xl border border-warning/30 bg-warning/10 p-3 text-sm text-foreground">
            <MicOff className="mt-0.5 h-4 w-4 shrink-0 text-warning" />
            <span>You answer Revision mode out loud, and this browser can't hear you. You can read a gist here, but open Gurukul in Chrome, Edge or Safari to take the Feynman test.</span>
          </p>
        )}

        <form
          className="space-y-3"
          onSubmit={(e) => { e.preventDefault(); void loadGist(input, "", "standard", false); }}
        >
          <label className="flex items-center gap-2 rounded-2xl border border-border bg-surface px-3 py-3 focus-within:border-primary/40">
            <Sparkles className="h-4 w-4 shrink-0 text-primary" />
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={REVISION_LIMITS.TOPIC_MAX}
              placeholder="Type any topic — a chapter, a concept, anything…"
              aria-label="Topic to revise"
              className="flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
          </label>
          <button
            type="submit"
            disabled={!input.trim()}
            className="w-full rounded-2xl bg-foreground px-4 py-3.5 text-sm font-bold text-background transition-all hover:opacity-90 disabled:opacity-40"
          >
            Start revising
          </button>
          {error && <p role="alert" className="text-center text-sm text-destructive">{error}</p>}
        </form>

        <ol className="grid grid-cols-3 gap-2 text-center text-[11px] text-muted-foreground">
          <li className="flex flex-col items-center gap-1"><BookOpen className="h-4 w-4 text-primary" /> Read the gist</li>
          <li className="flex flex-col items-center gap-1"><Mic className="h-4 w-4 text-primary" /> Explain it aloud</li>
          <li className="flex flex-col items-center gap-1"><MessageSquare className="h-4 w-4 text-primary" /> Answer Nova's questions</li>
        </ol>

        {dueChapters.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Your revision chapters</h3>
            <div className="flex flex-wrap gap-2">
              {dueChapters.map((c) => (
                <button key={`${c.subject}|${c.label}`} type="button" className={chip}
                  onClick={() => { setInput(c.label); void loadGist(c.label, c.subject, "standard", false); }}>
                  {c.label} <span className="text-muted-foreground/70">· {c.subject}{c.due ? " · due" : ""}</span>
                </button>
              ))}
            </div>
          </section>
        )}

        {weakConcepts.length > 0 && (
          <section className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Concepts you've got wrong</h3>
            <div className="flex flex-wrap gap-2">
              {weakConcepts.map((c) => (
                <button key={c} type="button" className={chip}
                  onClick={() => { setInput(c); void loadGist(c, "", "standard", false); }}>
                  {c}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wide text-muted-foreground">Or try anything</h3>
          <div className="flex flex-wrap gap-2">
            {TRY_ANYTHING.map((t) => (
              <button key={t} type="button" className={chip} onClick={() => { setInput(t); void loadGist(t, "", "standard", false); }}>
                {t}
              </button>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
