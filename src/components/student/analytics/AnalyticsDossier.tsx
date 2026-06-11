import { Link } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid } from "recharts";
import { ConceptMastery } from "@/components/student/ConceptMastery";
import { ReadinessRing, WeekActivityBars } from "@/components/student/analytics/AnalyticsBits";
import {
  aggregatesToTopicGaps,
  linkForActionStep,
  type TopicGapInsight,
} from "@/lib/analyticsInsights";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts, WeeklyActivityPoint } from "@/hooks/useStudentPerformanceCharts";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { cn } from "@/lib/utils";
import {
  AlertTriangle, ArrowRight, Flame, Loader2, RefreshCw, Target, Zap,
} from "lucide-react";

const barConfig = { accuracy: { label: "Accuracy %", color: "hsl(var(--primary))" } };

function computeWeekly(weekly: WeeklyActivityPoint[] | undefined) {
  const recent = (weekly ?? []).slice(-7);
  const total = recent.reduce((s, d) => s + (d.total ?? 0), 0);
  const active = recent.filter((d) => (d.total ?? 0) > 0).length;
  return { total, active, days: recent.length };
}

function ThreatRankCard({ rank, gap }: { rank: number; gap: TopicGapInsight }) {
  const urgent = gap.severity === "critical";
  return (
    <article
      className={cn(
        "group relative grid md:grid-cols-[auto_1fr] gap-4 md:gap-8 p-5 sm:p-6 rounded-2xl border transition-all duration-300",
        urgent
          ? "border-destructive/40 bg-gradient-to-br from-destructive/[0.08] to-transparent shadow-[inset_0_1px_0_0_hsl(var(--destructive)/0.2)]"
          : "border-border/60 bg-card hover:border-primary/30 hover:shadow-elevated",
        rank % 2 === 0 && "md:translate-x-2",
      )}
    >
      <div className="flex md:flex-col items-center md:items-start gap-2">
        <span
          className={cn(
            "font-mono text-5xl sm:text-6xl font-bold leading-none tabular-nums",
            urgent ? "text-destructive/90" : "text-primary/25 group-hover:text-primary/40",
          )}
        >
          {String(rank).padStart(2, "0")}
        </span>
        {urgent && (
          <span className="text-[10px] uppercase tracking-widest font-bold text-destructive">Fix first</span>
        )}
      </div>
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">
          {gap.subject} · {gap.chapter}
        </p>
        <h3 className="text-xl sm:text-2xl font-bold mt-1 leading-tight text-balance">{gap.topic}</h3>
        {gap.ncert_ref && (
          <p className="text-xs text-accent font-medium mt-2">{gap.ncert_ref}</p>
        )}
        <div className="mt-4 grid sm:grid-cols-2 gap-3 text-sm">
          <div className="p-3 rounded-xl bg-muted/50 border border-border/50">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">Root cause</span>
            <p className="mt-1 text-foreground/85 leading-relaxed">{gap.root_cause}</p>
          </div>
          <div className="p-3 rounded-xl bg-primary/5 border border-primary/15">
            <span className="text-[10px] uppercase tracking-wider text-primary font-semibold">Your fix</span>
            <p className="mt-1 text-muted-foreground leading-relaxed">{gap.fix_hint}</p>
          </div>
        </div>
        <p className="text-xs text-muted-foreground mt-3 leading-relaxed border-l-2 border-warning/50 pl-3">
          {gap.why_weak}
        </p>
        {gap.error_pattern && (
          <p className="text-xs mt-2 text-warning/90 font-medium">Pattern: {gap.error_pattern}</p>
        )}
      </div>
    </article>
  );
}

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
};

export function AnalyticsDossier({ data, charts }: Props) {
  const {
    insights,
    aggregates,
    mistakeCount,
    loading,
    enhancing,
    error,
    reload,
  } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const firstName = data.student?.full_name?.split(" ")[0] ?? "Student";
  const weekly = computeWeekly(charts?.weekly_activity);
  const subjects = [...(charts?.subjects ?? [])].sort((a, b) => b.accuracy - a.accuracy);

  const gaps: TopicGapInsight[] =
    (insights?.weak_topics?.length ?? 0) > 0
      ? insights!.weak_topics
      : aggregatesToTopicGaps(aggregates);

  const topGap = gaps[0];
  const score = readiness?.score ?? 0;
  const steps = insights?.study_priority?.length
    ? insights.study_priority
    : insights?.next_steps ?? [];

  if (loading) {
    return (
      <div className="flex flex-col items-center justify-center py-24 gap-4">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
        <p className="text-sm text-muted-foreground">Building your performance dossier…</p>
      </div>
    );
  }

  return (
    <div className="analytics-dossier space-y-0 -mx-1 sm:mx-0">
      {/* ——— CINEMATIC HERO (the part you liked — amplified) ——— */}
      <section className="hero-panel relative min-h-[300px] sm:min-h-[340px] rounded-2xl mb-8 overflow-hidden">
        <div
          className="absolute inset-0 flex items-center justify-center pointer-events-none select-none overflow-hidden"
          aria-hidden
        >
          <span className="font-mono text-[9rem] sm:text-[14rem] font-bold text-white/[0.04] leading-none tabular-nums">
            {score}
          </span>
        </div>
        <div className="absolute inset-0 bg-[radial-gradient(ellipse_80%_60%_at_50%_-20%,hsl(var(--accent)/0.15),transparent)]" />
        <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-white/20 to-transparent" />

        <div className="relative z-10 p-6 sm:p-8 flex flex-col lg:flex-row gap-8 items-start lg:items-end justify-between">
          <div className="flex flex-col sm:flex-row gap-6 items-start sm:items-center">
            <ReadinessRing score={score} size={120} label="Ready" />
            <div>
              <p className="text-[11px] uppercase tracking-[0.25em] text-white/50 font-semibold">Performance dossier</p>
              <h1 className="text-3xl sm:text-4xl font-bold text-white mt-1 tracking-tight">{firstName}</h1>
              <p className="text-white/70 mt-2 max-w-md text-sm sm:text-base">
                {insights?.diagnosis || readiness?.label || "Your exam readiness profile"}
              </p>
              {enhancing && (
                <p className="text-xs text-accent mt-2 flex items-center gap-1.5">
                  <Loader2 className="w-3 h-3 animate-spin" /> Deep topic scan running…
                </p>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 w-full lg:w-auto lg:min-w-[420px]">
            {[
              { label: "Accuracy", value: `${readiness?.accuracy_pct ?? 0}%` },
              { label: "Attendance", value: `${readiness?.attendance_pct ?? 0}%` },
              { label: "Streak", value: `${data.xp?.current_streak ?? 0}d` },
              { label: "Mistakes", value: String(data.mistake_count ?? 0) },
            ].map((m) => (
              <div
                key={m.label}
                className="rounded-xl bg-white/10 backdrop-blur-md border border-white/15 px-3 py-2.5 text-center"
              >
                <div className="text-[9px] uppercase tracking-wider text-white/55">{m.label}</div>
                <div className="text-xl font-bold text-white tabular-nums mt-0.5">{m.value}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 px-6 sm:px-8 pb-6 flex flex-wrap gap-2">
          <Button size="sm" className="bg-white text-primary hover:bg-white/90" asChild>
            <Link to="/student/recovery"><AlertTriangle className="w-4 h-4 mr-1" /> Fix mistakes</Link>
          </Button>
          <Button size="sm" variant="secondary" className="bg-white/15 text-white border-0 hover:bg-white/25" asChild>
            <Link to="/student/practice/math12"><Target className="w-4 h-4 mr-1" /> Practice</Link>
          </Button>
        </div>
      </section>

      {/* ——— BENTO INTEL ——— */}
      <section className="grid grid-cols-12 gap-3 mb-10">
        <div className="col-span-12 lg:col-span-7 rounded-2xl border border-border/70 bg-card p-6 sm:p-8 relative overflow-hidden">
          <div className="absolute top-0 right-0 w-32 h-32 bg-accent/10 rounded-full blur-3xl" />
          <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Priority target</p>
          {topGap ? (
            <>
              <h2 className="text-2xl sm:text-3xl font-bold mt-2 leading-tight max-w-lg">{topGap.topic}</h2>
              <p className="text-sm text-muted-foreground mt-2">
                {topGap.chapter} · {topGap.subject} · {topGap.mistake_count} mistake{topGap.mistake_count === 1 ? "" : "s"}
              </p>
              <p className="text-sm mt-4 text-foreground/80 leading-relaxed border-l-4 border-accent pl-4 max-w-xl">
                {insights?.headline || topGap.why_weak}
              </p>
            </>
          ) : (
            <>
              <h2 className="text-2xl font-bold mt-2">No weak topics yet</h2>
              <p className="text-sm text-muted-foreground mt-2">Practice — mistakes unlock topic-level intel here.</p>
            </>
          )}
          <Button className="mt-5" size="sm" asChild>
            <Link to="/student/recovery">Open recovery <ArrowRight className="w-4 h-4 ml-1" /></Link>
          </Button>
        </div>

        <div className="col-span-6 lg:col-span-2 rounded-2xl border border-border/70 bg-gradient-to-br from-primary/10 to-transparent p-5 flex flex-col justify-end">
          <Flame className="w-5 h-5 text-accent mb-2" />
          <div className="text-3xl font-bold tabular-nums">{weekly.active}<span className="text-lg text-muted-foreground">/{weekly.days}</span></div>
          <p className="text-xs text-muted-foreground mt-1">Active days</p>
        </div>

        <div className="col-span-6 lg:col-span-3 rounded-2xl border border-border/70 bg-card p-5 flex flex-col justify-end">
          <Zap className="w-5 h-5 text-warning mb-2" />
          <div className="text-3xl font-bold tabular-nums">{weekly.total}</div>
          <p className="text-xs text-muted-foreground mt-1">Questions this week</p>
        </div>

        {(insights?.error_patterns?.length ?? 0) > 0 && (
          <div className="col-span-12 rounded-2xl border border-warning/25 bg-warning/[0.06] p-4 flex flex-wrap gap-2 items-center">
            <span className="text-xs font-semibold uppercase tracking-wider text-warning mr-2">Patterns detected</span>
            {insights!.error_patterns.map((p, i) => (
              <span key={i} className="text-xs px-3 py-1.5 rounded-full bg-background/80 border border-warning/20">
                {p}
              </span>
            ))}
          </div>
        )}
      </section>

      {/* ——— THREAT RANK (topic analysis — editorial) ——— */}
      <section id="threats" className="mb-12 scroll-mt-8">
        <div className="flex flex-wrap items-end justify-between gap-4 mb-6">
          <div>
            <p className="text-[11px] uppercase tracking-[0.25em] text-primary font-bold">Deep analysis</p>
            <h2 className="text-3xl sm:text-4xl font-bold mt-1">
              Topics to fix<span className="text-accent">.</span>
            </h2>
            <p className="text-sm text-muted-foreground mt-2 max-w-lg">
              {insights?.summary || "Exact NCERT topics from your mistake book — not chapter labels."}
            </p>
          </div>
          {error && (
            <Button size="sm" variant="outline" onClick={reload}>
              <RefreshCw className="w-3.5 h-3.5 mr-1" /> Retry
            </Button>
          )}
          {mistakeCount > 0 && (
            <span className="text-sm text-muted-foreground font-mono">{mistakeCount} mistakes analysed</span>
          )}
        </div>

        {gaps.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border p-12 text-center">
            <p className="font-medium">Your threat board is clear</p>
            <p className="text-sm text-muted-foreground mt-1">Wrong answers populate ranked topic fixes here.</p>
            <Button className="mt-4" asChild><Link to="/student/practice/math12">Start practice</Link></Button>
          </div>
        ) : (
          <div className="space-y-4">
            {gaps.slice(0, 8).map((gap, i) => (
              <ThreatRankCard key={`${gap.topic}-${i}`} rank={i + 1} gap={gap} />
            ))}
          </div>
        )}
      </section>

      {/* ——— WEEKLY PULSE ——— */}
      <section className="mb-12 rounded-2xl border border-border/70 bg-card overflow-hidden">
        <div className="p-5 sm:p-6 border-b border-border/50 flex flex-wrap justify-between gap-2">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Momentum</p>
            <h3 className="text-lg font-bold mt-0.5">Weekly pulse</h3>
          </div>
        </div>
        <div className="p-5 sm:p-6">
          <WeekActivityBars days={charts?.weekly_activity ?? []} />
        </div>
      </section>

      {/* ——— SUBJECTS + PLAN ——— */}
      <div className="grid lg:grid-cols-2 gap-6 mb-12">
        {subjects.length > 0 && (
          <section className="rounded-2xl border border-border/70 bg-card p-5 sm:p-6">
            <p className="text-[11px] uppercase tracking-[0.2em] text-muted-foreground font-semibold">Subjects</p>
            <h3 className="text-lg font-bold mt-0.5 mb-4">Accuracy spectrum</h3>
            <ChartContainer config={barConfig} className="h-[200px] w-full">
              <BarChart data={subjects} layout="vertical" margin={{ left: 4, right: 8 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" horizontal={false} />
                <XAxis type="number" domain={[0, 100]} className="text-[10px]" />
                <YAxis type="category" dataKey="name" width={72} className="text-[10px]" />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar dataKey="accuracy" fill="hsl(var(--primary))" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ChartContainer>
          </section>
        )}

        <section className="rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.06] to-transparent p-5 sm:p-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-primary font-semibold">Battle plan</p>
          <h3 className="text-lg font-bold mt-0.5 mb-4">This week</h3>
          <ol className="space-y-4">
            {(steps.length ? steps : ["Start practice to unlock your personalised plan."]).slice(0, 5).map((step, i) => {
              const link = typeof step === "string" ? linkForActionStep(step) : { to: "/student/practice/math12", label: "Go" };
              return (
                <li key={i} className="flex gap-4">
                  <span className="font-mono text-2xl font-bold text-primary/30 leading-none w-8">{String(i + 1).padStart(2, "0")}</span>
                  <div>
                    <p className="text-sm leading-relaxed text-foreground/90">{step}</p>
                    {steps.length > 0 && (
                      <Link to={link.to} className="text-xs text-primary font-medium mt-1 inline-flex items-center hover:underline">
                        {link.label} <ArrowRight className="w-3 h-3 ml-0.5" />
                      </Link>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <section className="mb-8">
        <ConceptMastery limit={5} />
      </section>
    </div>
  );
}
