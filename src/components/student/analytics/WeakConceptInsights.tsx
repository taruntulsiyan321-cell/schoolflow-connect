import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import type { AnalyticsInsights, MistakeConceptAggregate } from "@/lib/analyticsInsights";
import { AlertTriangle, BookMarked, Brain, CheckCircle2, Loader2, Sparkles, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const severityStyle: Record<string, string> = {
  critical: "bg-destructive/15 text-destructive border-destructive/30",
  moderate: "bg-warning/15 text-warning border-warning/30",
  mild: "bg-muted text-muted-foreground border-border",
};

const severityLabel: Record<string, string> = {
  critical: "Urgent",
  moderate: "Needs work",
  mild: "Watch",
};

type Props = {
  insights: AnalyticsInsights | null;
  aggregates: MistakeConceptAggregate[];
  mistakeCount: number;
  loading: boolean;
  compact?: boolean;
};

export function WeakConceptInsights({ insights, aggregates, mistakeCount, loading, compact = false }: Props) {
  if (loading) {
    return (
      <Card className="p-5 shadow-card border-primary/15">
        <div className="flex items-center gap-2 text-muted-foreground mb-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span className="text-sm">Analysing your mistake book for concept gaps…</span>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-3/4" />
          <Skeleton className="h-16 w-full" />
          <Skeleton className="h-16 w-full" />
        </div>
      </Card>
    );
  }

  const weak = insights?.weak_concepts ?? [];
  const strong = insights?.strong_concepts ?? [];
  const hasMistakes = mistakeCount > 0 || aggregates.length > 0;

  return (
    <Card className="p-5 sm:p-6 shadow-card border-primary/20 bg-gradient-to-br from-primary/[0.06] via-transparent to-accent/[0.04] overflow-hidden relative">
      <div className="absolute top-0 right-0 w-32 h-32 bg-primary/5 rounded-full blur-3xl pointer-events-none" />

      <div className="flex flex-wrap items-start justify-between gap-3 mb-4 relative">
        <div>
          <h3 className="font-semibold flex items-center gap-2 text-base">
            <Brain className="w-4 h-4 text-primary" />
            Weak concepts from your mistakes
          </h3>
          <p className="text-xs text-muted-foreground mt-1 max-w-lg">
            NCERT concept-level gaps derived from questions you got wrong in Practice — not just chapter names.
          </p>
        </div>
        {hasMistakes && (
          <Badge variant="outline" className="shrink-0">
            <BookMarked className="w-3 h-3 mr-1" />
            {mistakeCount} mistake{mistakeCount === 1 ? "" : "s"} analysed
          </Badge>
        )}
      </div>

      {insights && (
        <div className="mb-5 p-4 rounded-xl bg-background/80 border border-border/60 relative">
          <div className="flex items-start gap-2">
            <Sparkles className="w-4 h-4 text-primary shrink-0 mt-0.5" />
            <div>
              <p className="font-medium text-sm">{insights.headline}</p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{insights.summary}</p>
            </div>
          </div>
        </div>
      )}

      {!hasMistakes && (
        <div className="text-center py-6 px-4 rounded-xl border border-dashed border-border/80 bg-muted/30">
          <AlertTriangle className="w-8 h-8 mx-auto text-muted-foreground mb-2 opacity-60" />
          <p className="text-sm font-medium">No practice mistakes yet</p>
          <p className="text-xs text-muted-foreground mt-1 max-w-sm mx-auto">
            Wrong answers from Practice are saved to your mistake book. Concept gaps will appear here automatically.
          </p>
          <Button size="sm" className="mt-4" asChild>
            <Link to="/student/practice/math12">Start practice</Link>
          </Button>
        </div>
      )}

      {weak.length > 0 && (
        <div className={cn("space-y-3", compact && "max-h-80 overflow-y-auto pr-1")}>
          {weak.slice(0, compact ? 4 : 8).map((w, i) => (
            <div
              key={`${w.subject}-${w.concept}-${i}`}
              className="p-4 rounded-xl border border-warning/25 bg-warning/[0.06] hover:bg-warning/[0.09] transition-colors"
            >
              <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
                <div className="min-w-0">
                  <div className="font-semibold text-sm">{w.concept}</div>
                  <div className="text-xs text-muted-foreground mt-0.5">
                    {w.subject}
                    {w.chapter ? ` · ${w.chapter}` : ""}
                  </div>
                </div>
                <div className="flex gap-1.5 shrink-0">
                  <Badge variant="outline" className={cn("text-[10px]", severityStyle[w.severity] ?? severityStyle.mild)}>
                    {severityLabel[w.severity] ?? w.severity}
                  </Badge>
                  <Badge variant="outline" className="text-[10px]">
                    ×{w.mistake_count}
                  </Badge>
                </div>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                <span className="font-medium text-foreground/80">Why: </span>
                {w.why_weak}
              </p>
              <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">
                <span className="font-medium text-primary">Fix: </span>
                {w.fix_hint}
              </p>
            </div>
          ))}
        </div>
      )}

      {strong.length > 0 && !compact && (
        <div className="mt-5 pt-4 border-t border-border/60">
          <h4 className="text-sm font-medium flex items-center gap-1.5 mb-3 text-accent">
            <CheckCircle2 className="w-3.5 h-3.5" /> Concepts you&apos;re handling well
          </h4>
          <div className="flex flex-wrap gap-2">
            {strong.map((s, i) => (
              <Badge key={i} className="bg-accent/15 text-accent border-0 font-normal py-1.5 px-2.5 max-w-full">
                <span className="font-semibold">{s.concept}</span>
                <span className="opacity-80 ml-1">· {s.subject}</span>
              </Badge>
            ))}
          </div>
        </div>
      )}

      {insights && insights.next_steps.length > 0 && !compact && (
        <div className="mt-5 pt-4 border-t border-border/60">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-2">Recommended plan</p>
          <ol className="space-y-2">
            {insights.next_steps.slice(0, 3).map((step, i) => (
              <li key={i} className="flex gap-2 text-sm text-muted-foreground">
                <span className="font-bold text-primary shrink-0">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
        </div>
      )}

      {hasMistakes && (
        <div className="flex flex-wrap gap-2 mt-5">
          <Button size="sm" asChild>
            <Link to="/student/recovery"><Wrench className="w-4 h-4 mr-1" /> Fix my mistakes</Link>
          </Button>
          <Button size="sm" variant="outline" asChild>
            <Link to="/student/mistakes">Mistake book</Link>
          </Button>
        </div>
      )}
    </Card>
  );
}
