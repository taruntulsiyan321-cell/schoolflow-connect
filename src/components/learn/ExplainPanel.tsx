import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Brain, Lightbulb, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { invokeEdgeFunction } from "@/lib/edgeFunction";
import { displayConcept, fixMojibake } from "@/lib/academicDisplay";

export type Explanation = {
  summary: string;
  why_wrong: string;
  concept: string;
  how_to_improve: string;
};

type Props = {
  question: string;
  options?: string[];
  correctIndex?: number | null;
  selectedIndex?: number | null;
  correctText?: string;
  selectedText?: string;
  subject?: string;
  chapter?: string;
  topic?: string;
  grade?: string | number;
  wasCorrect?: boolean | null;
  /** Auto-fetch on mount (use sparingly — costs an AI call). */
  autoLoad?: boolean;
  className?: string;
};

function optionLabel(index: number | null | undefined, options: string[], fallback = ""): string {
  if (typeof index === "number" && index >= 0) {
    const text = options[index] ?? fallback;
    return `${String.fromCharCode(65 + index)}. ${text || "Option not available"}`;
  }
  return fallback || "";
}

function normalizeAnswerText(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function buildAnswerContext({
  options,
  correctIndex,
  selectedIndex,
  correctText,
  selectedText,
}: {
  options: string[];
  correctIndex: number | null;
  selectedIndex: number | null;
  correctText: string;
  selectedText: string;
}) {
  const correct = normalizeAnswerText(optionLabel(correctIndex, options, correctText) || correctText);
  const selected =
    selectedIndex === -1
      ? "Not answered / time ran out"
      : normalizeAnswerText(optionLabel(selectedIndex, options, selectedText) || selectedText || "No answer recorded");
  return { correct, selected };
}

function buildDeterministicExplanation({
  question,
  options,
  correctIndex,
  selectedIndex,
  correctText,
  selectedText,
  subject,
  chapter,
  topic,
  wasCorrect,
}: Required<Pick<Props, "question" | "options" | "subject" | "chapter" | "topic">> & {
  correctIndex: number | null;
  selectedIndex: number | null;
  correctText: string;
  selectedText: string;
  wasCorrect: boolean | null;
}): Explanation {
  const { correct, selected } = buildAnswerContext({ options, correctIndex, selectedIndex, correctText, selectedText });
  const area = [topic, chapter, subject].filter(Boolean).join(" · ") || "this concept";
  const questionHint = question.length > 120 ? `${question.slice(0, 117).trim()}...` : question;

  return {
    summary: correct
      ? `Correct answer: ${correct}.`
      : "Correct answer is not available in the saved question data.",
    why_wrong: wasCorrect
      ? `Your answer matches the correct option. The key is to connect the question statement to ${area} and choose the option that satisfies it exactly.`
      : `Your answer: ${selected}. Correct answer: ${correct || "not available"}. Re-check the question "${questionHint}" and compare each option against the rule or fact being tested; the correct option is the one that satisfies that condition, while the selected option does not.`,
    concept: area,
    how_to_improve: `Before selecting, write the rule/formula for ${area}, eliminate options that contradict it, and only then choose the matching answer.`,
  };
}

// Stable, short cache key so identical (question, chosen option) pairs reuse one AI call.
function hashKey(parts: (string | number | null | undefined)[]): string {
  const s = parts.map((p) => (p ?? "")).join("¦");
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0;
  return "ex_" + h.toString(36) + "_" + s.length.toString(36);
}

export function ExplainPanel(props: Props) {
  const {
    question, options = [], correctIndex = null, selectedIndex = null,
    correctText = "", selectedText = "", subject = "", chapter = "", topic = "",
    grade = "", wasCorrect = null, autoLoad = false, className,
  } = props;

  const [data, setData] = useState<Explanation | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [aiSource, setAiSource] = useState<"ai" | null>(null);
  const [open, setOpen] = useState(autoLoad);
  const fetched = useRef(false);
  const answerContext = buildAnswerContext({ options, correctIndex, selectedIndex, correctText, selectedText });
  const fallbackExplanation = buildDeterministicExplanation({
    question,
    options,
    correctIndex,
    selectedIndex,
    correctText,
    selectedText,
    subject,
    chapter,
    topic,
    wasCorrect,
  });

  const load = async () => {
    if (loading || data || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    setError(null);
    setAiSource(null);
    const cacheKey = hashKey([question, correctIndex, selectedIndex, correctText, selectedText]);
    try {
      // 1) Cache hit?
      const { data: cached } = await (supabase as any)
        .from("ai_explanations")
        .select("payload")
        .eq("cache_key", cacheKey)
        .maybeSingle();
      if (cached?.payload) {
        setData(cached.payload as Explanation);
        setAiSource("ai");
        setLoading(false);
        return;
      }

      // 2) Ask the AI
      const { data: res, error: fnErr } = await invokeEdgeFunction<Explanation & { source?: string }>("ai-explain", {
        question, options, correct_index: correctIndex, selected_index: selectedIndex,
        correct_text: correctText, selected_text: selectedText,
        subject, chapter, topic, grade: String(grade ?? ""),
      });

      if (res && !fnErr) {
        const payload: Explanation = {
          summary: res.summary ?? "",
          why_wrong: res.why_wrong ?? "",
          concept: res.concept ?? "",
          how_to_improve: res.how_to_improve ?? "",
        };
        setData(payload);
        setAiSource("ai");

        // 3) Cache for everyone else
        (supabase as any).from("ai_explanations").insert({
          cache_key: cacheKey, subject: subject || null, topic: topic || null, payload,
        }).then(() => {}, () => {});
        return;
      }

      setData(fallbackExplanation);
      setError(fnErr ? "Live explanation is unavailable, so this uses the saved correct answer." : null);
      fetched.current = false;
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? "";
      setData(fallbackExplanation);
      setError(msg ? `${msg}. Showing the saved correct answer instead.` : null);
      fetched.current = false;
    } finally {
      setLoading(false);
    }
  };

  const toggle = () => {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) load();
  };

  useEffect(() => {
    if (autoLoad) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoLoad]);

  return (
    <div className={cn("mt-3", className)}>
      {!open ? (
        <Button
          variant="outline"
          size="sm"
          onClick={toggle}
          className="gap-1.5 border-primary/30 text-primary hover:bg-primary/5"
        >
          <Sparkles className="w-3.5 h-3.5" />
          {wasCorrect ? "Go deeper" : "Explain my mistake"}
        </Button>
      ) : (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4 animate-rise">
          <div className="flex items-center gap-2 mb-3">
            <div className="icon-tile w-8 h-8">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="section-label text-primary">Learning insight</span>
            {!autoLoad && (
              <button onClick={() => setOpen(false)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
                Hide
              </button>
            )}
          </div>

          <div className="mb-3 grid gap-2 sm:grid-cols-2">
            <AnswerChip label="Correct answer" value={answerContext.correct || "Not available"} tone="correct" />
            <AnswerChip label="Your answer" value={answerContext.selected} tone={wasCorrect ? "correct" : "selected"} />
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Analysing your answer…
            </div>
          )}

          {error && !data && (
            <div className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
              <button onClick={() => { setError(null); setData(null); fetched.current = false; load(); }} className="underline ml-1">Retry</button>
            </div>
          )}

          {error && data && (
            <p className="mb-3 text-xs text-muted-foreground flex items-center gap-1.5">
              <AlertTriangle className="w-3.5 h-3.5 text-warning" /> {error}
            </p>
          )}

          {data && !loading && (
            <div className="space-y-3 text-sm">
              {data.summary && (
                <p className="font-medium text-foreground">{fixMojibake(data.summary)}</p>
              )}
              {data.why_wrong && (
                <Row icon={<AlertTriangle className="w-4 h-4 text-warning" />} label={wasCorrect ? "Why it's right" : "Where it went wrong"} text={fixMojibake(data.why_wrong)} />
              )}
              {data.concept && (
                <Row icon={<Brain className="w-4 h-4 text-primary" />} label="Core concept" text={displayConcept(data.concept) || fixMojibake(data.concept)} />
              )}
              {data.how_to_improve && (
                <Row icon={<Lightbulb className="w-4 h-4 text-accent" />} label="How to improve" text={fixMojibake(data.how_to_improve)} />
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function AnswerChip({ label, value, tone }: { label: string; value: string; tone: "correct" | "selected" }) {
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2",
      tone === "correct" ? "bg-accent/10 border-accent/25" : "bg-warning/10 border-warning/25",
    )}>
      <div className="text-[10px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
      <div className="mt-0.5 text-sm font-medium text-foreground">{value}</div>
    </div>
  );
}

function Row({ icon, label, text }: { icon: React.ReactNode; label: string; text: string }) {
  return (
    <div className="flex gap-2.5">
      <div className="mt-0.5 shrink-0">{icon}</div>
      <div>
        <div className="text-[11px] uppercase tracking-wide text-muted-foreground font-semibold">{label}</div>
        <div className="text-foreground/90 leading-relaxed">{text}</div>
      </div>
    </div>
  );
}
