import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sparkles, Loader2, Brain, Lightbulb, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { buildRuleExplanation } from "@/lib/ruleExplanation";
import { invokeEdgeFunction, isAiUnavailableError } from "@/lib/edgeFunction";

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
  const [offline, setOffline] = useState(false);
  const [open, setOpen] = useState(autoLoad);
  const fetched = useRef(false);

  const applyRuleFallback = () => {
    setData(buildRuleExplanation({
      question, options, correctIndex, selectedIndex, correctText, selectedText, wasCorrect, subject, chapter,
    }));
    setOffline(true);
    setError(null);
  };

  const load = async () => {
    if (loading || data || fetched.current) return;
    fetched.current = true;
    setLoading(true);
    setError(null);
    setOffline(false);
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
        setLoading(false);
        return;
      }

      // 2) Ask the AI
      const { data: res, error: fnErr } = await invokeEdgeFunction<Explanation>("ai-explain", {
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

        // 3) Cache for everyone else
        (supabase as any).from("ai_explanations").insert({
          cache_key: cacheKey, subject: subject || null, topic: topic || null, payload,
        }).then(() => {}, () => {});
        return;
      }

      if (isAiUnavailableError(fnErr) || fnErr) {
        applyRuleFallback();
        return;
      }

      applyRuleFallback();
    } catch (e: unknown) {
      const msg = (e as Error)?.message ?? "";
      if (isAiUnavailableError(msg)) {
        applyRuleFallback();
      } else {
        setError(msg || "Could not load explanation");
        fetched.current = false;
      }
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
          {wasCorrect ? "Go deeper with AI" : "Explain my mistake"}
        </Button>
      ) : (
        <div className="rounded-xl border border-border/70 bg-muted/30 p-4 animate-rise">
          <div className="flex items-center gap-2 mb-3">
            <div className="icon-tile w-8 h-8">
              <Sparkles className="w-4 h-4" />
            </div>
            <span className="section-label text-primary">Learning insight</span>
            {offline && (
              <Badge variant="outline" className="text-[10px] border-warning/40 text-warning">Offline</Badge>
            )}
            {!autoLoad && (
              <button onClick={() => setOpen(false)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
                Hide
              </button>
            )}
          </div>

          {loading && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-3">
              <Loader2 className="w-4 h-4 animate-spin" /> Analysing your answer…
            </div>
          )}

          {error && (
            <div className="text-sm text-destructive flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" /> {error}
              <button onClick={() => { setError(null); setData(null); fetched.current = false; load(); }} className="underline ml-1">Retry</button>
            </div>
          )}

          {data && !loading && (
            <div className="space-y-3 text-sm">
              {data.summary && (
                <p className="font-medium text-foreground">{data.summary}</p>
              )}
              {data.why_wrong && (
                <Row icon={<AlertTriangle className="w-4 h-4 text-warning" />} label={wasCorrect ? "Why it's right" : "Where it went wrong"} text={data.why_wrong} />
              )}
              {data.concept && (
                <Row icon={<Brain className="w-4 h-4 text-primary" />} label="Core concept" text={data.concept} />
              )}
              {data.how_to_improve && (
                <Row icon={<Lightbulb className="w-4 h-4 text-accent" />} label="How to improve" text={data.how_to_improve} />
              )}
            </div>
          )}
        </div>
      )}
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
