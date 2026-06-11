import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  aggregatesToWeakConcepts,
  type AnalyticsInsights,
  type MistakeConceptAggregate,
  type WeakConceptInsight,
} from "@/lib/analyticsInsights";
import { AlertTriangle, BookMarked, Brain, CheckCircle2, ChevronRight, Loader2, RefreshCw, Wrench } from "lucide-react";
import { cn } from "@/lib/utils";

const severityStyle: Record<string, { badge: string; stripe: string }> = {
  critical: {
    badge: "bg-destructive/15 text-destructive border-destructive/30",
    stripe: "bg-destructive",
  },
  moderate: {
    badge: "bg-warning/15 text-warning border-warning/30",
    stripe: "bg-warning",
  },
  mild: {
    badge: "bg-muted text-muted-foreground border-border",
    stripe: "bg-primary/40",
  },
};

const severityLabel: Record<string, string> = {
  critical: "Urgent",
  moderate: "Needs work",
  mild: "Watch",
};

function ConceptGapCard({ w }: { w: WeakConceptInsight }) {
  const style = severityStyle[w.severity] ?? severityStyle.mild;

  return (
    <div className="group relative flex rounded-xl border border-border/70 bg-card overflow-hidden hover:shadow-elevated transition-shadow">
      <div className={cn("w-1 shrink-0", style.stripe)} />
      <div className="flex-1 p-4 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-2">
          <div className="min-w-0 flex-1">
            <div className="font-semibold text-sm leading-snug">{w.concept}</div>
            <div className="text-xs text-muted-foreground mt-1">
              {w.subject}
              {w.chapter ? ` · ${w.chapter}` : ""}
            </div>
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Badge variant="outline" className={cn("text-[10px] font-semibold", style.badge)}>
              {severityLabel[w.severity] ?? w.severity}
            </Badge>
            <Badge variant="secondary" className="text-[10px] tabular-nums">
              ×{w.mistake_count}
            </Badge>
          </div>
        </div>
        <p className="text-xs text-muted-foreground leading-relaxed">
          <span className="font-medium text-foreground/85">Why · </span>
          {w.why_weak}
        </p>
        <p className="text-xs mt-2 leading-relaxed">
          <span className="font-medium text-primary">Fix · </span>
          <span className="text-muted-foreground">{w.fix_hint}</span>
        </p>
      </div>
    </div>
  );
}

type Props = {
  insights: AnalyticsInsights | null;
  aggregates: MistakeConceptAggregate[];
  mistakeCount: number;
  loading: boolean;
  enhancing?: boolean;
  error?: string | null;
  onRetry?: () => void;
  limit?: number;
};

export function WeakConceptInsights({
  insights,
  aggregates,
  mistakeCount,
  loading,
  enhancing = false,
  error,
  onRetry,
  limit = 8,
}: Props) {
  if (loading) {
    return (
      <Card className="p-6 shadow-card">
        <div className="flex items-center gap-2 text-muted-foreground mb-5">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm">Loading concept gaps from your mistake book…</span>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-24 w-full rounded-xl" />
          <Skeleton className="h-24 w-full rounded-xl" />
        </div>
      </Card>
    );
  }

  const weakFromInsights = insights?.weak_concepts ?? [];
  const displayConcepts =
    weakFromInsights.length > 0 ? weakFromInsights : aggregatesToWeakConcepts(aggregates);
  const strong = insights?.strong_concepts ?? [];
  const hasMistakes = mistakeCount > 0 || aggregates.length > 0;

  return (
    <Card className="shadow-card overflow-hidden border-border/80">
      <div className="p-5 sm:p-6 border-b border-border/60 bg-gradient-to-r from-primary/[0.07] to-accent/[0.04]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="font-semibold flex items-center gap-2 text-lg">
              <Brain className="w-5 h-5 text-primary" />
              Concept gaps from mistakes
            </h3>
            <p className="text-sm text-muted-foreground mt-1 max-w-xl">
              NCERT skills you&apos;re missing — grouped from your mistake book, not just chapter names.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {enhancing && (
              <Badge variant="outline" className="text-xs gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Refining…
              </Badge>
            )}
            {hasMistakes && (
              <Badge variant="secondary" className="text-xs gap-1">
                <BookMarked className="w-3 h-3" />
                {mistakeCount} mistake{mistakeCount === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>

        {insights && (
          <div className="mt-4 p-4 rounded-xl bg-background/90 border border-border/50">
            <p className="font-semibold text-sm">{insights.headline}</p>
            <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{insights.summary}</p>
          </div>
        )}
      </div>

      <div className="p-5 sm:p-6">
        {error && (
          <div className="mb-4 p-3 rounded-lg bg-destructive/10 border border-destructive/20 text-sm flex flex-wrap items-center justify-between gap-2">
            <span className="text-destructive">{error}</span>
            {onRetry && (
              <Button size="sm" variant="outline" onClick={onRetry}>
                <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
              </Button>
            )}
          </div>
        )}

        {!hasMistakes && (
          <div className="text-center py-10 px-4 rounded-xl border border-dashed border-border bg-muted/20">
            <AlertTriangle className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No mistakes in your book yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Practice, DPP, or battles — wrong answers are saved automatically and analysed here by concept.
            </p>
            <Button size="sm" className="mt-5" asChild>
              <Link to="/student/practice/math12">Start practice</Link>
            </Button>
          </div>
        )}

        {displayConcepts.length > 0 && (
          <div className="space-y-3">
            {displayConcepts.slice(0, limit).map((w, i) => (
              <ConceptGapCard key={`${w.subject}-${w.concept}-${i}`} w={w} />
            ))}
          </div>
        )}

        {hasMistakes && displayConcepts.length === 0 && (
          <p className="text-sm text-muted-foreground text-center py-6">
            Mistakes are logged but concepts could not be grouped — try again shortly.
          </p>
        )}

        {strong.length > 0 && (
          <div className="mt-6 pt-5 border-t border-border/60">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3 text-accent">
              <CheckCircle2 className="w-4 h-4" /> Handling well
            </h4>
            <div className="flex flex-wrap gap-2">
              {strong.map((s, i) => (
                <Badge key={i} variant="outline" className="bg-accent/10 text-accent border-accent/25 py-1.5 px-3 font-normal">
                  <span className="font-semibold">{s.concept}</span>
                  <span className="opacity-75 ml-1.5">· {s.subject}</span>
                </Badge>
              ))}
            </div>
          </div>
        )}

        {insights && insights.next_steps.length > 0 && (
          <div className="mt-6 pt-5 border-t border-border/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Your plan
            </p>
            <ol className="space-y-2.5">
              {insights.next_steps.slice(0, 3).map((step, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="text-muted-foreground leading-relaxed pt-0.5">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {hasMistakes && (
          <div className="flex flex-wrap gap-2 mt-6 pt-2">
            <Button asChild>
              <Link to="/student/recovery">
                <Wrench className="w-4 h-4 mr-1" /> Fix my mistakes
              </Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/student/mistakes">
                Mistake book <ChevronRight className="w-4 h-4 ml-0.5" />
              </Link>
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
