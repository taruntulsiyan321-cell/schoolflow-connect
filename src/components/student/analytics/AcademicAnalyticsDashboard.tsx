import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SectionTitle } from "@/components/ui-bits";
import { ConceptMastery } from "@/components/student/ConceptMastery";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid, Legend } from "recharts";
import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { StudentPerformanceCharts, WeeklyActivityPoint } from "@/hooks/useStudentPerformanceCharts";
import {
  InsightHighlight,
  MetricTile,
  ReadinessRing,
  SubjectBar,
  TrendSparkline,
  WeekActivityBars,
} from "@/components/student/analytics/AnalyticsBits";
import { WeakConceptInsights } from "@/components/student/analytics/WeakConceptInsights";
import { useAnalyticsInsights } from "@/hooks/useAnalyticsInsights";
import { linkForActionStep, type AnalyticsInsights } from "@/lib/analyticsInsights";
import {
  Target, ClipboardCheck, Flame, AlertTriangle, TrendingUp,
  Lightbulb, BarChart3, Sword, Layers, Brain,
} from "lucide-react";

const barConfig = { accuracy: { label: "Accuracy %", color: "hsl(var(--primary))" } };
const lineConfig = {
  total: { label: "Total", color: "hsl(var(--primary))" },
  dpp: { label: "DPP", color: "hsl(var(--primary))" },
  battles: { label: "Battles", color: "hsl(var(--warning))" },
  self_practice: { label: "Self-practice", color: "hsl(var(--accent))" },
};
const areaConfig = { score_pct: { label: "Score %", color: "hsl(var(--primary))" } };
const practiceAreaConfig = { score_pct: { label: "Practice score %", color: "hsl(var(--accent))" } };

function computeWeeklySummary(weekly: WeeklyActivityPoint[] | undefined) {
  const recent = (weekly ?? []).slice(-7);
  const totalQuestions = recent.reduce((s, d) => s + (d.total ?? 0), 0);
  const activeDays = recent.filter((d) => (d.total ?? 0) > 0).length;
  const dppCount = recent.reduce((s, d) => s + (d.dpp ?? 0), 0);
  const battleCount = recent.reduce((s, d) => s + (d.battles ?? 0), 0);
  const practiceCount = recent.reduce((s, d) => s + (d.self_practice ?? 0), 0);
  const avgPerActiveDay = activeDays > 0 ? Math.round(totalQuestions / activeDays) : 0;
  return { totalQuestions, activeDays, dppCount, battleCount, practiceCount, avgPerActiveDay, daysTracked: recent.length };
}

function buildActionSteps(conceptInsights: AnalyticsInsights | null) {
  if (!conceptInsights?.next_steps?.length) {
    return [{ text: "Start practice to build your mistake profile.", to: "/student/practice/math12", label: "Practice" }];
  }
  return conceptInsights.next_steps.slice(0, 3).map((text) => {
    const link = linkForActionStep(text);
    return { text, to: link.to, label: link.label };
  });
}

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
};

export function AcademicAnalyticsDashboard({ data, charts }: Props) {
  const {
    insights: conceptInsights,
    aggregates,
    mistakeCount,
    loading: conceptLoading,
    enhancing,
    error: conceptError,
    reload: reloadConcepts,
  } = useAnalyticsInsights(data);

  const readiness = data.exam_readiness;
  const weekly = computeWeeklySummary(charts?.weekly_activity);
  const actionSteps = buildActionSteps(conceptInsights);
  const firstName = data.student?.full_name?.split(" ")[0] ?? "Student";

  const subjects = [...(charts?.subjects ?? [])].sort((a, b) => b.accuracy - a.accuracy);
  const strongest = subjects[0];
  const weakest = subjects.length > 1 ? subjects[subjects.length - 1] : subjects[0];

  const topWeakConcept = conceptInsights?.weak_concepts?.[0];
  const topWeakAggregate = aggregates[0];

  const dppTrendValues = (charts?.dpp_trend ?? []).map((d) => d.score_pct);
  const practiceTrendValues = (charts?.practice_trend ?? []).map((d) => d.score_pct);

  const hasCharts =
    (charts?.subjects?.length ?? 0) > 0 ||
    (charts?.weekly_activity?.length ?? 0) > 0 ||
    (charts?.dpp_trend?.length ?? 0) > 0 ||
    (charts?.practice_trend?.length ?? 0) > 0;

  const conceptGapCount = conceptInsights?.weak_concepts?.length ?? aggregates.length;

  return (
    <div className="space-y-5 animate-rise">
      {/* Hero */}
      <Card className="hero-panel p-5 sm:p-6 overflow-hidden relative">
        <div className="absolute -right-12 -top-12 w-48 h-48 rounded-full bg-white/5 blur-3xl pointer-events-none" />
        <div className="flex flex-col md:flex-row gap-5 items-start md:items-center relative">
          <ReadinessRing score={readiness?.score ?? 0} label="Readiness" />
          <div className="flex-1 min-w-0">
            <p className="text-[11px] uppercase tracking-wider text-white/60">Performance</p>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-0.5">{firstName}&apos;s analytics</h2>
            <p className="text-sm text-white/75 mt-1">{readiness?.label ?? "Building your profile"}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 mt-4">
              <MetricTile label="Accuracy" value={`${readiness?.accuracy_pct ?? 0}%`} accent="accent" />
              <MetricTile label="Attendance" value={`${readiness?.attendance_pct ?? 0}%`} accent={(readiness?.attendance_pct ?? 0) >= 75 ? "accent" : "warning"} />
              <MetricTile label="Streak" value={`${data.xp?.current_streak ?? 0}d`} sub={`L${data.xp?.level ?? 1}`} />
              <MetricTile
                label="Concept gaps"
                value={conceptGapCount}
                sub={`${data.mistake_count ?? 0} open mistakes`}
                accent={conceptGapCount > 0 ? "warning" : "accent"}
              />
            </div>
          </div>
          <div className="flex flex-row md:flex-col gap-2 w-full md:w-auto shrink-0">
            <Button size="sm" className="flex-1 md:flex-none bg-white text-primary hover:bg-white/90" asChild>
              <Link to="/student/recovery"><AlertTriangle className="w-4 h-4 mr-1" /> Fix mistakes</Link>
            </Button>
            <Button size="sm" variant="secondary" className="flex-1 md:flex-none" asChild>
              <Link to="/student/practice/math12"><Target className="w-4 h-4 mr-1" /> Practice</Link>
            </Button>
          </div>
        </div>
      </Card>

      {/* Quick stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { icon: ClipboardCheck, label: "DPP open", value: data.dpp?.open ?? 0, sub: `${data.dpp?.completed ?? 0} done` },
          { icon: Sword, label: "Battles", value: `${data.xp?.wins ?? 0}W`, sub: `${data.xp?.total_battles ?? 0} played` },
          { icon: Flame, label: "Active days", value: `${weekly.activeDays}/${weekly.daysTracked}`, sub: `${weekly.totalQuestions} Qs this week` },
          { icon: Layers, label: "Practice", value: data.self_practice?.sessions_completed ?? 0, sub: "sessions" },
        ].map(({ icon: Icon, label, value, sub }) => (
          <Card key={label} className="p-4 shadow-card">
            <div className="flex items-center gap-1.5 text-muted-foreground text-[10px] uppercase tracking-wide mb-1.5">
              <Icon className="w-3.5 h-3.5" /> {label}
            </div>
            <div className="text-xl font-bold tabular-nums">{value}</div>
            <div className="text-xs text-muted-foreground mt-0.5">{sub}</div>
          </Card>
        ))}
      </div>

      <Tabs defaultValue="concepts" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 h-auto p-1 bg-muted/50 rounded-xl">
          <TabsTrigger value="concepts" className="text-sm py-2.5 rounded-lg gap-1.5 data-[state=active]:shadow-sm">
            <Brain className="w-3.5 h-3.5 hidden sm:inline" />
            Concept gaps
            {conceptGapCount > 0 && (
              <Badge variant="secondary" className="ml-1 h-5 px-1.5 text-[10px]">{conceptGapCount}</Badge>
            )}
          </TabsTrigger>
          <TabsTrigger value="overview" className="text-sm py-2.5 rounded-lg data-[state=active]:shadow-sm">Overview</TabsTrigger>
          <TabsTrigger value="subjects" className="text-sm py-2.5 rounded-lg data-[state=active]:shadow-sm">Subjects</TabsTrigger>
        </TabsList>

        <TabsContent value="concepts" className="space-y-4 mt-0">
          <WeakConceptInsights
            insights={conceptInsights}
            aggregates={aggregates}
            mistakeCount={mistakeCount}
            loading={conceptLoading}
            enhancing={enhancing}
            error={conceptError}
            onRetry={reloadConcepts}
          />
          <ConceptMastery limit={6} />
        </TabsContent>

        <TabsContent value="overview" className="space-y-4 mt-0">
          <div className="grid lg:grid-cols-5 gap-4">
            <Card className="p-5 shadow-card lg:col-span-3">
              <SectionTitle title="Weekly momentum" />
              <div className="flex flex-wrap gap-2 mb-4">
                <Badge variant="outline" className="gap-1.5 text-xs"><span className="w-2 h-2 rounded-full bg-primary" /> DPP</Badge>
                <Badge variant="outline" className="gap-1.5 text-xs"><span className="w-2 h-2 rounded-full bg-warning" /> Battles</Badge>
                <Badge variant="outline" className="gap-1.5 text-xs"><span className="w-2 h-2 rounded-full bg-accent" /> Practice</Badge>
              </div>
              <WeekActivityBars days={charts?.weekly_activity ?? []} />
              <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t">
                <div><div className="text-xs text-muted-foreground">Avg / day</div><div className="text-lg font-bold">{weekly.avgPerActiveDay}</div></div>
                <div><div className="text-xs text-muted-foreground">DPP</div><div className="text-lg font-bold">{weekly.dppCount}</div></div>
                <div><div className="text-xs text-muted-foreground">Battles</div><div className="text-lg font-bold">{weekly.battleCount}</div></div>
              </div>
            </Card>

            <div className="lg:col-span-2 space-y-3">
              {topWeakConcept ? (
                <InsightHighlight
                  kind="focus"
                  title={topWeakConcept.concept}
                  subtitle={`${topWeakConcept.subject}${topWeakConcept.chapter ? ` · ${topWeakConcept.chapter}` : ""} — top concept gap`}
                  value={topWeakConcept.severity === "critical" ? "Urgent" : `×${topWeakConcept.mistake_count}`}
                />
              ) : topWeakAggregate ? (
                <InsightHighlight
                  kind="focus"
                  title={topWeakAggregate.concept}
                  subtitle={`${topWeakAggregate.subject}${topWeakAggregate.chapter ? ` · ${topWeakAggregate.chapter}` : ""} — from mistake book`}
                  value={`×${topWeakAggregate.mistake_count}`}
                />
              ) : null}
              {strongest && (
                <InsightHighlight
                  kind="strength"
                  title={strongest.name}
                  subtitle={`${strongest.attempts} attempts`}
                  value={`${strongest.accuracy}%`}
                />
              )}
              {weakest && weakest.name !== strongest?.name && (
                <InsightHighlight
                  kind="focus"
                  title={weakest.name}
                  subtitle="Lowest subject accuracy"
                  value={`${weakest.accuracy}%`}
                />
              )}

              <Card className="p-5 shadow-card">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold text-sm">Action plan</h3>
                </div>
                <ol className="space-y-3">
                  {actionSteps.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/12 text-primary text-xs font-bold">{i + 1}</span>
                      <div className="min-w-0">
                        <p className="text-muted-foreground leading-relaxed">{step.text}</p>
                        <Button size="sm" variant="link" className="h-auto p-0 mt-1 text-primary" asChild>
                          <Link to={step.to}>{step.label} →</Link>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="subjects" className="space-y-4 mt-0">
          {subjects.length > 0 && (
            <Card className="p-5 shadow-card">
              <SectionTitle title="Subject accuracy" />
              <p className="text-xs text-muted-foreground mb-4">DPP, battles, and practice combined</p>
              <div className="space-y-4">
                {subjects.map((s, i) => (
                  <SubjectBar key={s.name} name={s.name} accuracy={s.accuracy} attempts={s.attempts} rank={i + 1} />
                ))}
              </div>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {(dppTrendValues.length > 1 || practiceTrendValues.length > 1) && (
              <Card className="p-5 shadow-card">
                <SectionTitle title="Score trends" />
                <div className="grid sm:grid-cols-2 gap-5 mt-2">
                  {dppTrendValues.length > 1 && (
                    <div>
                      <p className="text-xs font-medium mb-2 flex items-center gap-1.5"><BarChart3 className="w-3.5 h-3.5" /> DPP</p>
                      <TrendSparkline values={dppTrendValues.slice(-12)} tone="primary" />
                    </div>
                  )}
                  {practiceTrendValues.length > 1 && (
                    <div>
                      <p className="text-xs font-medium mb-2 flex items-center gap-1.5"><Target className="w-3.5 h-3.5" /> Practice</p>
                      <TrendSparkline values={practiceTrendValues.slice(-12)} tone="accent" />
                    </div>
                  )}
                </div>
              </Card>
            )}

            {(charts?.weekly_activity?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card">
                <SectionTitle title="Activity over time" />
                <ChartContainer config={lineConfig} className="h-[200px] w-full mt-2">
                  <LineChart data={charts?.weekly_activity ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} className="text-[10px]" />
                    <YAxis className="text-[10px]" width={28} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Line type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="dpp" stroke="var(--color-dpp)" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="battles" stroke="var(--color-battles)" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="self_practice" stroke="var(--color-self_practice)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ChartContainer>
              </Card>
            )}
          </div>

          {hasCharts ? (
            <div className="grid lg:grid-cols-2 gap-4">
              {(charts?.subjects?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card">
                  <SectionTitle title="Subject comparison" />
                  <ChartContainer config={barConfig} className="h-[220px] w-full mt-2">
                    <BarChart data={charts?.subjects ?? []} barCategoryGap="20%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" vertical={false} />
                      <XAxis dataKey="name" className="text-[10px]" />
                      <YAxis domain={[0, 100]} className="text-[10px]" width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="accuracy" fill="var(--color-accuracy)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </Card>
              )}
              {(charts?.dpp_trend?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card">
                  <SectionTitle title="DPP scores" />
                  <ChartContainer config={areaConfig} className="h-[220px] w-full mt-2">
                    <AreaChart data={charts?.dpp_trend ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} className="text-[10px]" />
                      <YAxis domain={[0, 100]} className="text-[10px]" width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="score_pct" fill="var(--color-score_pct)" fillOpacity={0.12} stroke="var(--color-score_pct)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </Card>
              )}
            </div>
          ) : (
            <Card className="p-8 text-center shadow-card border-dashed">
              <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Complete a DPP or practice session to unlock charts.</p>
            </Card>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
