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
import {
  Target, ClipboardCheck, Flame, AlertTriangle, TrendingUp, TrendingDown,
  BookOpen, Lightbulb, BarChart3, Sword, Layers,
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

function buildInsights(data: AcademicSnapshot | null, weekly: ReturnType<typeof computeWeeklySummary>) {
  const steps: { text: string; to: string; label: string; priority: number }[] = [];
  const mistakes = data?.mistake_count ?? 0;
  const recovery = data?.recovery_pending ?? 0;
  const accuracy = data?.exam_readiness?.accuracy_pct ?? 0;

  if (mistakes > 0 || recovery > 0) {
    steps.push({
      priority: 1,
      text: `You have ${mistakes} open mistake${mistakes === 1 ? "" : "s"}${recovery > 0 ? ` and ${recovery} recovery item${recovery === 1 ? "" : "s"} queued` : ""}. Fixing these lifts readiness fastest.`,
      to: "/student/recovery",
      label: "Fix mistakes",
    });
  }
  if (accuracy > 0 && accuracy < 65) {
    steps.push({
      priority: 2,
      text: `Practice accuracy is ${accuracy}%. Short targeted sessions on weak chapters will move your readiness score.`,
      to: "/student/practice/math12",
      label: "Practice now",
    });
  }
  if ((data?.weak_topics?.length ?? 0) > 0) {
    const names = data!.weak_topics!.slice(0, 2).map((w) => w.subject).join(" & ");
    steps.push({
      priority: 3,
      text: `Revise ${names} before your next DPP — these are your lowest-scoring areas.`,
      to: "/student/revision",
      label: "Revision queue",
    });
  }
  if (weekly.activeDays < 3 && weekly.daysTracked > 0) {
    steps.push({
      priority: 4,
      text: `Only ${weekly.activeDays} active day${weekly.activeDays === 1 ? "" : "s"} this week. A 15-minute DPP keeps momentum.`,
      to: "/student/dpp",
      label: "Start DPP",
    });
  }
  if (steps.length === 0) {
    steps.push({
      priority: 5,
      text: "Solid progress — mix DPP, battles, and self-practice to keep every subject green.",
      to: "/student/report",
      label: "View full report",
    });
  }
  return steps.sort((a, b) => a.priority - b.priority).slice(0, 3);
}

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
};

export function AcademicAnalyticsDashboard({ data, charts }: Props) {
  const readiness = data.exam_readiness;
  const weekly = computeWeeklySummary(charts?.weekly_activity);
  const insights = buildInsights(data, weekly);
  const firstName = data.student?.full_name?.split(" ")[0] ?? "Student";

  const subjects = [...(charts?.subjects ?? [])].sort((a, b) => b.accuracy - a.accuracy);
  const strongest = subjects[0];
  const weakest = subjects.length > 1 ? subjects[subjects.length - 1] : subjects[0];

  const weakTopic = data.weak_topics?.[0];
  const strongTopic = data.strong_topics?.[0];

  const dppTrendValues = (charts?.dpp_trend ?? []).map((d) => d.score_pct);
  const practiceTrendValues = (charts?.practice_trend ?? []).map((d) => d.score_pct);

  const hasCharts =
    (charts?.subjects?.length ?? 0) > 0 ||
    (charts?.weekly_activity?.length ?? 0) > 0 ||
    (charts?.dpp_trend?.length ?? 0) > 0 ||
    (charts?.practice_trend?.length ?? 0) > 0;

  return (
    <div className="space-y-6 animate-rise">
      <Card className="hero-panel p-5 sm:p-6 overflow-hidden relative">
        <div className="absolute -right-8 -top-8 w-40 h-40 rounded-full bg-white/5 blur-2xl pointer-events-none" />
        <div className="flex flex-col lg:flex-row gap-6 items-start lg:items-center">
          <ReadinessRing score={readiness?.score ?? 0} label="Readiness" />
          <div className="flex-1 min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-white/65">Performance overview</div>
            <h2 className="text-xl sm:text-2xl font-bold text-white mt-1">
              {firstName}&apos;s academic snapshot
            </h2>
            <p className="text-sm text-white/75 mt-1">{readiness?.label ?? "Building your profile"}</p>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mt-4">
              <MetricTile label="Accuracy" value={`${readiness?.accuracy_pct ?? 0}%`} sub="DPP + practice" accent="accent" />
              <MetricTile label="Attendance" value={`${readiness?.attendance_pct ?? 0}%`} accent={(readiness?.attendance_pct ?? 0) >= 75 ? "accent" : "warning"} />
              <MetricTile label="Streak" value={`${data.xp?.current_streak ?? 0}d`} sub={`Level ${data.xp?.level ?? 1}`} />
              <MetricTile
                label="Mistakes"
                value={data.mistake_count ?? 0}
                sub={data.recovery_pending ? `${data.recovery_pending} in recovery` : "Open in mistake book"}
                accent={(data.mistake_count ?? 0) > 0 ? "warning" : "accent"}
              />
            </div>
          </div>
          <div className="flex flex-col gap-2 w-full lg:w-auto shrink-0">
            <Button size="sm" className="bg-white text-primary hover:bg-white/90" asChild>
              <Link to="/student/practice/math12"><Target className="w-4 h-4 mr-1" /> Practice</Link>
            </Button>
            <Button size="sm" variant="secondary" asChild>
              <Link to="/student/recovery"><AlertTriangle className="w-4 h-4 mr-1" /> Recovery</Link>
            </Button>
            <Button size="sm" variant="outline" className="border-white/30 text-white hover:bg-white/10" asChild>
              <Link to="/student/dpp">Daily DPP</Link>
            </Button>
          </div>
        </div>
      </Card>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="p-4 shadow-card hover:shadow-elevated transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
            <ClipboardCheck className="w-3.5 h-3.5" /> DPP open
          </div>
          <div className="text-2xl font-bold">{data.dpp?.open ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-1">{data.dpp?.completed ?? 0} completed</div>
        </Card>
        <Card className="p-4 shadow-card hover:shadow-elevated transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
            <Sword className="w-3.5 h-3.5" /> Battles
          </div>
          <div className="text-2xl font-bold text-primary">{data.xp?.wins ?? 0}<span className="text-base font-normal text-muted-foreground"> wins</span></div>
          <div className="text-xs text-muted-foreground mt-1">{data.xp?.total_battles ?? 0} played · {data.xp?.xp ?? 0} XP</div>
        </Card>
        <Card className="p-4 shadow-card hover:shadow-elevated transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
            <Flame className="w-3.5 h-3.5" /> This week
          </div>
          <div className="text-2xl font-bold text-accent">{weekly.activeDays}<span className="text-base font-normal text-muted-foreground">/{weekly.daysTracked} days</span></div>
          <div className="text-xs text-muted-foreground mt-1">{weekly.totalQuestions} questions attempted</div>
        </Card>
        <Card className="p-4 shadow-card hover:shadow-elevated transition-shadow">
          <div className="flex items-center gap-2 text-muted-foreground text-xs uppercase tracking-wide mb-2">
            <Layers className="w-3.5 h-3.5" /> Self-practice
          </div>
          <div className="text-2xl font-bold">{data.self_practice?.sessions_completed ?? 0}</div>
          <div className="text-xs text-muted-foreground mt-1">sessions completed</div>
        </Card>
      </div>

      <Tabs defaultValue="overview" className="space-y-4">
        <TabsList className="grid w-full grid-cols-3 h-11 p-1 bg-muted/60">
          <TabsTrigger value="overview" className="text-sm">Overview</TabsTrigger>
          <TabsTrigger value="subjects" className="text-sm">Subjects & trends</TabsTrigger>
          <TabsTrigger value="topics" className="text-sm">Topics & plan</TabsTrigger>
        </TabsList>

        <TabsContent value="overview" className="space-y-4 mt-0">
          <div className="grid lg:grid-cols-5 gap-4">
            <Card className="p-5 shadow-card lg:col-span-3">
              <SectionTitle title="Weekly momentum" />
              <div className="flex flex-wrap gap-3 mb-4">
                <Badge variant="outline" className="gap-1.5"><span className="w-2 h-2 rounded-full bg-primary" /> DPP</Badge>
                <Badge variant="outline" className="gap-1.5"><span className="w-2 h-2 rounded-full bg-warning" /> Battles</Badge>
                <Badge variant="outline" className="gap-1.5"><span className="w-2 h-2 rounded-full bg-accent" /> Self-practice</Badge>
              </div>
              <WeekActivityBars days={charts?.weekly_activity ?? []} />
              <div className="grid grid-cols-3 gap-3 mt-5 pt-4 border-t border-border/60">
                <div>
                  <div className="text-xs text-muted-foreground">Avg / active day</div>
                  <div className="text-lg font-bold">{weekly.avgPerActiveDay}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">DPP this week</div>
                  <div className="text-lg font-bold">{weekly.dppCount}</div>
                </div>
                <div>
                  <div className="text-xs text-muted-foreground">Battles this week</div>
                  <div className="text-lg font-bold">{weekly.battleCount}</div>
                </div>
              </div>
            </Card>

            <div className="lg:col-span-2 space-y-4">
              {strongest && (
                <InsightHighlight
                  kind="strength"
                  title={strongest.name}
                  subtitle={`${strongest.attempts} attempts across DPP, battles & practice`}
                  value={`${strongest.accuracy}%`}
                />
              )}
              {weakest && weakest.name !== strongest?.name && (
                <InsightHighlight
                  kind="focus"
                  title={weakest.name}
                  subtitle={`${weakest.attempts} attempts — extra practice recommended`}
                  value={`${weakest.accuracy}%`}
                />
              )}
              {!strongest && weakTopic && (
                <InsightHighlight
                  kind="focus"
                  title={weakTopic.subject}
                  subtitle={[weakTopic.chapter, weakTopic.topic].filter(Boolean).join(" · ") || "General"}
                  value={`${weakTopic.accuracy}%`}
                />
              )}
              {!strongest && strongTopic && (
                <InsightHighlight
                  kind="strength"
                  title={strongTopic.subject}
                  subtitle={[strongTopic.chapter, strongTopic.topic].filter(Boolean).join(" · ") || "Strong area"}
                  value={`${strongTopic.accuracy}%`}
                />
              )}

              <Card className="p-5 shadow-card border-primary/20 bg-gradient-to-br from-primary/5 to-transparent">
                <div className="flex items-center gap-2 mb-3">
                  <Lightbulb className="w-4 h-4 text-primary" />
                  <h3 className="font-semibold">Your action plan</h3>
                </div>
                <ol className="space-y-3">
                  {insights.map((step, i) => (
                    <li key={i} className="flex gap-3 text-sm">
                      <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/15 text-primary text-xs font-bold">
                        {i + 1}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-muted-foreground leading-relaxed">{step.text}</p>
                        <Button size="sm" variant={i === 0 ? "default" : "ghost"} className="mt-2 h-8 px-0" asChild>
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
              <p className="text-xs text-muted-foreground mb-5">Ranked by accuracy — DPP, battles, and self-practice combined</p>
              <div className="space-y-5">
                {subjects.map((s, i) => (
                  <SubjectBar key={s.name} name={s.name} accuracy={s.accuracy} attempts={s.attempts} rank={i + 1} />
                ))}
              </div>
            </Card>
          )}

          <div className="grid md:grid-cols-2 gap-4">
            {(dppTrendValues.length > 0 || practiceTrendValues.length > 0) && (
              <Card className="p-5 shadow-card">
                <SectionTitle title="Score snapshots" />
                <p className="text-xs text-muted-foreground mb-4">Recent session scores (last 30 days)</p>
                <div className="grid sm:grid-cols-2 gap-6">
                  {dppTrendValues.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <BarChart3 className="w-4 h-4 text-primary" /> DPP trend
                      </div>
                      <TrendSparkline values={dppTrendValues.slice(-12)} tone="primary" />
                    </div>
                  )}
                  {practiceTrendValues.length > 0 && (
                    <div>
                      <div className="text-sm font-medium mb-2 flex items-center gap-2">
                        <Target className="w-4 h-4 text-accent" /> Practice trend
                      </div>
                      <TrendSparkline values={practiceTrendValues.slice(-12)} tone="accent" />
                    </div>
                  )}
                </div>
              </Card>
            )}

            {(charts?.weekly_activity?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card">
                <SectionTitle title="Activity over time" />
                <ChartContainer config={lineConfig} className="h-[220px] w-full mt-2">
                  <LineChart data={charts?.weekly_activity ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} className="text-[10px]" />
                    <YAxis className="text-[10px]" width={28} />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <Line type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="dpp" stroke="var(--color-dpp)" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="battles" stroke="var(--color-battles)" strokeWidth={1.5} dot={false} />
                    <Line type="monotone" dataKey="self_practice" stroke="var(--color-self_practice)" strokeWidth={1.5} dot={false} />
                  </LineChart>
                </ChartContainer>
              </Card>
            )}
          </div>

          {hasCharts && (
            <div className="grid lg:grid-cols-2 gap-4">
              {(charts?.subjects?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card">
                  <SectionTitle title="Subject comparison" />
                  <ChartContainer config={barConfig} className="h-[240px] w-full mt-2">
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
                  <SectionTitle title="DPP score trend" />
                  <ChartContainer config={areaConfig} className="h-[240px] w-full mt-2">
                    <AreaChart data={charts?.dpp_trend ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} className="text-[10px]" />
                      <YAxis domain={[0, 100]} className="text-[10px]" width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="score_pct" fill="var(--color-score_pct)" fillOpacity={0.15} stroke="var(--color-score_pct)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </Card>
              )}

              {(charts?.practice_trend?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card lg:col-span-2">
                  <SectionTitle title="Self-practice score trend" />
                  <ChartContainer config={practiceAreaConfig} className="h-[220px] w-full mt-2">
                    <AreaChart data={charts?.practice_trend ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="date" tickFormatter={(d) => String(d).slice(5)} className="text-[10px]" />
                      <YAxis domain={[0, 100]} className="text-[10px]" width={32} />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="score_pct" fill="var(--color-score_pct)" fillOpacity={0.15} stroke="var(--color-score_pct)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </Card>
              )}
            </div>
          )}

          {!hasCharts && (
            <Card className="p-8 text-center shadow-card border-dashed">
              <BarChart3 className="w-8 h-8 mx-auto text-muted-foreground mb-2" />
              <p className="text-sm text-muted-foreground">Complete a DPP or practice session to unlock trend charts.</p>
            </Card>
          )}
        </TabsContent>

        <TabsContent value="topics" className="space-y-4 mt-0">
          <div className="grid lg:grid-cols-2 gap-4">
            <Card className="p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <TrendingDown className="w-4 h-4 text-warning" />
                <h3 className="font-semibold">Weak topics</h3>
                <Badge variant="outline" className="ml-auto">{data.weak_topics?.length ?? 0}</Badge>
              </div>
              <div className="space-y-2">
                {(data.weak_topics ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">No weak topics detected yet — keep practicing.</p>
                )}
                {(data.weak_topics ?? []).map((w, i) => (
                  <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-warning/8 border border-warning/20">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{w.subject}</div>
                      <div className="text-xs text-muted-foreground truncate">{[w.chapter, w.topic].filter(Boolean).join(" · ") || "General"}</div>
                    </div>
                    <Badge variant="outline" className="shrink-0 ml-2">{w.accuracy}%</Badge>
                  </div>
                ))}
              </div>
              {(data.weak_topics?.length ?? 0) > 0 && (
                <Button size="sm" className="mt-4 w-full" variant="outline" asChild>
                  <Link to="/student/revision"><BookOpen className="w-4 h-4 mr-1" /> Open revision queue</Link>
                </Button>
              )}
            </Card>

            <Card className="p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <TrendingUp className="w-4 h-4 text-accent" />
                <h3 className="font-semibold">Strong topics</h3>
                <Badge variant="outline" className="ml-auto">{data.strong_topics?.length ?? 0}</Badge>
              </div>
              <div className="space-y-2">
                {(data.strong_topics ?? []).length === 0 && (
                  <p className="text-sm text-muted-foreground py-4 text-center">Strengths appear as you score well across subjects.</p>
                )}
                {(data.strong_topics ?? []).map((w, i) => (
                  <div key={i} className="flex justify-between items-center p-3 rounded-xl bg-accent/10 border border-accent/20">
                    <div className="min-w-0">
                      <div className="font-medium text-sm">{w.subject}</div>
                      {(w.chapter || w.topic) && (
                        <div className="text-xs text-muted-foreground truncate">{[w.chapter, w.topic].filter(Boolean).join(" · ")}</div>
                      )}
                    </div>
                    <Badge className="bg-accent/20 text-accent border-0 shrink-0 ml-2">{w.accuracy}%</Badge>
                  </div>
                ))}
              </div>
            </Card>
          </div>

          <ConceptMastery limit={6} />
        </TabsContent>
      </Tabs>
    </div>
  );
}
