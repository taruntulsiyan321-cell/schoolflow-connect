import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import {
  aggregatesToTopicGaps,
  type AnalyticsInsights,
  type MistakeTopicAggregate,
  type TopicGapInsight,
} from "@/lib/analyticsInsights";
import {
  AlertTriangle, BookMarked, Brain, CheckCircle2, ChevronRight,
  Loader2, Microscope, RefreshCw, Target, Wrench,
} from "lucide-react";
import { cn } from "@/lib/utils";
import "@/components/student/analytics/wisdom/wisdom-analytics.css";

const severityStyle: Record<string, { badge: string; stripe: string }> = {
  critical: { badge: "bg-destructive/15 text-destructive border-destructive/30", stripe: "bg-destructive" },
  moderate: { badge: "bg-warning/15 text-warning border-warning/30", stripe: "bg-warning" },
  mild: { badge: "bg-muted text-muted-foreground border-border", stripe: "bg-primary/40" },
};

const severityLabel: Record<string, string> = {
  critical: "Urgent",
  moderate: "Needs work",
  mild: "Watch",
};

function TopicGapCard({ gap }: { gap: TopicGapInsight }) {
  const style = severityStyle[gap.severity] ?? severityStyle.mild;

  return (
    <div className="relative flex rounded-xl border border-border/70 bg-card overflow-hidden hover:shadow-elevated transition-shadow">
      <div className={cn("w-1.5 shrink-0", style.stripe)} />
      <div className="flex-1 p-4 sm:p-5 min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-2 mb-3">
          <div className="min-w-0 flex-1">
            <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
              {gap.subject} · {gap.chapter}
            </div>
            <div className="font-bold text-base sm:text-lg leading-snug mt-1 text-foreground">
              {gap.topic}
            </div>
            {gap.concept && gap.concept !== gap.topic && (
              <Badge variant="outline" className="mt-2 text-[10px] font-normal">
                Skill: {gap.concept}
              </Badge>
            )}
          </div>
          <div className="flex gap-1.5 shrink-0">
            <Badge variant="outline" className={cn("text-[10px] font-semibold", style.badge)}>
              {severityLabel[gap.severity]}
            </Badge>
            <Badge variant="secondary" className="text-[10px] tabular-nums">×{gap.mistake_count}</Badge>
          </div>
        </div>

        {gap.ncert_ref && (
          <div className="text-[11px] text-primary font-medium mb-2">{gap.ncert_ref}</div>
        )}

        <div className="space-y-2.5 text-xs sm:text-sm">
          <div className="p-3 rounded-lg bg-muted/50 border border-border/40">
            <span className="font-semibold text-foreground/90">What went wrong · </span>
            <span className="text-muted-foreground leading-relaxed">{gap.why_weak}</span>
          </div>
          <div className="p-3 rounded-lg bg-destructive/5 border border-destructive/15">
            <span className="font-semibold text-destructive/90">Root cause · </span>
            <span className="text-muted-foreground leading-relaxed">{gap.root_cause}</span>
          </div>
          {gap.error_pattern && (
            <div className="p-3 rounded-lg bg-warning/5 border border-warning/15">
              <span className="font-semibold text-warning">Pattern · </span>
              <span className="text-muted-foreground">{gap.error_pattern}</span>
            </div>
          )}
          <div className="p-3 rounded-lg bg-primary/5 border border-primary/15">
            <span className="font-semibold text-primary">Fix · </span>
            <span className="text-muted-foreground leading-relaxed">{gap.fix_hint}</span>
          </div>
        </div>
      </div>
    </div>
  );
}

type Props = {
  insights: AnalyticsInsights | null;
  aggregates: MistakeTopicAggregate[];
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
  limit = 10,
}: Props) {
  if (loading) {
    return (
      <Card className="p-6 shadow-card">
        <div className="flex items-center gap-2 text-muted-foreground mb-5">
          <Loader2 className="w-4 h-4 animate-spin text-primary" />
          <span className="text-sm">Running deep topic analysis on your mistake book…</span>
        </div>
        <div className="space-y-3">
          <Skeleton className="h-5 w-2/3" />
          <Skeleton className="h-32 w-full rounded-xl" />
          <Skeleton className="h-32 w-full rounded-xl" />
        </div>
      </Card>
    );
  }

  const weakFromInsights = insights?.weak_topics ?? [];
  const displayGaps = weakFromInsights.length > 0 ? weakFromInsights : aggregatesToTopicGaps(aggregates);
  const strong = insights?.strong_concepts ?? [];
  const hasMistakes = mistakeCount > 0 || aggregates.length > 0;

  return (
    <Card className="wisdom-analytics wa-card overflow-hidden p-0">
      <div className="p-5 sm:p-6 border-b border-[var(--wa-outline-variant)] bg-[radial-gradient(circle_at_100%_0%,rgba(255,223,151,0.24),transparent_36%),linear-gradient(135deg,#ffffff_0%,#f4fff8_100%)]">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="wa-label text-[var(--wa-primary)]">Diagnostic intelligence</p>
            <h3 className="wa-headline flex items-center gap-2 text-lg mt-1">
              <span className="wa-ai-orb small"><Microscope className="w-4 h-4" /></span>
              Deep topic analysis
            </h3>
            <p className="wa-body text-sm mt-1 max-w-2xl">
              Exact NCERT <strong className="text-foreground/80">topics</strong> within each chapter — what you got wrong, why, and how to fix it.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {enhancing && (
              <Badge variant="outline" className="text-xs gap-1">
                <Loader2 className="w-3 h-3 animate-spin" />
                Deep analysis…
              </Badge>
            )}
            {insights?.source === "gemini" && !enhancing && (
              <Badge className="text-xs bg-primary/10 text-primary border-0">Personalised</Badge>
            )}
            {hasMistakes && (
              <Badge variant="secondary" className="text-xs gap-1">
                <BookMarked className="w-3 h-3" />
                {mistakeCount} mistakes
              </Badge>
            )}
          </div>
        </div>

        {insights && (
          <div className="mt-4 space-y-3">
            <div className="wa-insight-panel p-4 rounded-2xl">
              <p className="font-semibold">{insights.headline}</p>
              <p className="text-sm text-muted-foreground mt-1 leading-relaxed">{insights.summary}</p>
            </div>

            {insights.diagnosis && (
              <div className="p-4 rounded-2xl bg-primary/5 border border-primary/15">
                <div className="flex items-center gap-2 mb-1.5">
                  <Brain className="w-4 h-4 text-primary" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-primary">Diagnosis</span>
                </div>
                <p className="text-sm leading-relaxed text-foreground/90">{insights.diagnosis}</p>
              </div>
            )}

            {(insights.error_patterns?.length ?? 0) > 0 && (
              <div className="flex flex-wrap gap-2">
                {insights.error_patterns.map((p, i) => (
                  <Badge key={i} variant="outline" className="text-xs font-normal py-1.5 px-2.5 bg-warning/5 border-warning/20">
                    <AlertTriangle className="w-3 h-3 mr-1 text-warning" />
                    {p}
                  </Badge>
                ))}
              </div>
            )}
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
            <Target className="w-10 h-10 mx-auto text-muted-foreground/50 mb-3" />
            <p className="font-medium">No mistakes to analyse yet</p>
            <p className="text-sm text-muted-foreground mt-1 max-w-md mx-auto">
              Each wrong answer is analysed for the exact topic, root cause, and fix — not just &quot;weak in Integrals&quot;.
            </p>
            <Button size="sm" className="mt-5" asChild>
              <Link to="/student/practice/math12">Start practice</Link>
            </Button>
          </div>
        )}

        {displayGaps.length > 0 && (
          <>
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">
              Weak topics ({displayGaps.length})
            </p>
            <div className="space-y-4">
              {displayGaps.slice(0, limit).map((gap, i) => (
                <TopicGapCard key={`${gap.subject}-${gap.chapter}-${gap.topic}-${i}`} gap={gap} />
              ))}
            </div>
          </>
        )}

        {(insights?.study_priority?.length ?? 0) > 0 && (
          <div className="mt-6 pt-5 border-t border-border/60">
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3 flex items-center gap-1.5">
              <Target className="w-3.5 h-3.5" /> This week&apos;s priority order
            </p>
            <ol className="space-y-2">
              {insights!.study_priority.slice(0, 5).map((item, i) => (
                <li key={i} className="flex gap-3 text-sm p-3 rounded-lg bg-muted/40 border border-border/50">
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary text-primary-foreground text-xs font-bold">
                    {i + 1}
                  </span>
                  <span className="text-foreground/90 leading-relaxed pt-0.5">{item}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {strong.length > 0 && (
          <div className="mt-6 pt-5 border-t border-border/60">
            <h4 className="text-sm font-semibold flex items-center gap-1.5 mb-3 text-accent">
              <CheckCircle2 className="w-4 h-4" /> Topics you&apos;re handling well
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
            <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-3">Action plan</p>
            <ol className="space-y-2.5">
              {insights.next_steps.slice(0, 4).map((step, i) => (
                <li key={i} className="flex gap-3 text-sm">
                  <span className="font-bold text-primary shrink-0">{i + 1}.</span>
                  <span className="text-muted-foreground leading-relaxed">{step}</span>
                </li>
              ))}
            </ol>
          </div>
        )}

        {hasMistakes && (
          <div className="flex flex-wrap gap-2 mt-6">
            <Button asChild>
              <Link to="/student/recovery"><Wrench className="w-4 h-4 mr-1" /> Fix my mistakes</Link>
            </Button>
            <Button variant="outline" asChild>
              <Link to="/student/mistakes">Mistake book <ChevronRight className="w-4 h-4 ml-0.5" /></Link>
            </Button>
          </div>
        )}
      </div>
    </Card>
  );
}
