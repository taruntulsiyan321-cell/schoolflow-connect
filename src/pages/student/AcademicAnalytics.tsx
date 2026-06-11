import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts, type WeeklyActivityPoint } from "@/hooks/useStudentPerformanceCharts";
import { AnalyticsEmptyState } from "@/components/student/AnalyticsEmptyState";
import { StudentAnalyticsSkeleton } from "@/components/student/StudentPanelStates";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import {
  BarChart3, ArrowLeft, FileText, Target, ClipboardCheck, Flame, AlertTriangle,
  TrendingUp, TrendingDown, Sword, CalendarDays, Lightbulb, BookOpen,
} from "lucide-react";

const barConfig = { accuracy: { label: "Accuracy %", color: "hsl(var(--primary))" } };
const lineConfig = {
  total: { label: "Total", color: "hsl(var(--primary))" },
  dpp: { label: "DPP", color: "hsl(var(--accent))" },
  battles: { label: "Battles", color: "hsl(var(--warning))" },
  self_practice: { label: "Self-practice", color: "hsl(var(--chart-4))" },
};
const areaConfig = { score_pct: { label: "Score %", color: "hsl(var(--primary))" } };
const practiceAreaConfig = { score_pct: { label: "Practice score %", color: "hsl(var(--accent))" } };

function ErrorCard({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <Card className="p-6 text-center mb-4">
      <p className="text-sm text-muted-foreground mb-2">Part of analytics could not be loaded. Apply pending Supabase migrations if this is a new environment.</p>
      <p className="text-xs text-destructive mb-3">{message}</p>
      <Button size="sm" variant="outline" onClick={onRetry}>Try again</Button>
    </Card>
  );
}

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

function buildInsights(data: ReturnType<typeof useStudentAcademicSnapshot>["data"], weekly: ReturnType<typeof computeWeeklySummary>) {
  const steps: { text: string; to: string; label: string }[] = [];
  const mistakes = data?.mistake_count ?? 0;
  const recovery = data?.recovery_pending ?? 0;
  const accuracy = data?.exam_readiness?.accuracy_pct ?? 0;
  const attendance = data?.exam_readiness?.attendance_pct ?? 0;

  if (mistakes > 0 || recovery > 0) {
    steps.push({
      text: `${mistakes} open mistake${mistakes === 1 ? "" : "s"}${recovery > 0 ? ` · ${recovery} recovery question${recovery === 1 ? "" : "s"} waiting` : ""}`,
      to: "/student/recovery",
      label: "Go to Recovery zone",
    });
  }
  if (accuracy > 0 && accuracy < 65) {
    steps.push({
      text: `Practice accuracy is ${accuracy}% — targeted sessions can lift your readiness score`,
      to: "/student/practice/math12",
      label: "Start practice",
    });
  }
  if (attendance > 0 && attendance < 75) {
    steps.push({
      text: `Attendance is ${attendance}% — consistent class presence supports exam readiness`,
      to: "/student",
      label: "View dashboard",
    });
  }
  if ((data?.weak_topics?.length ?? 0) > 0) {
    steps.push({
      text: `Revise weak topics in ${data!.weak_topics!.slice(0, 2).map((w) => w.subject).join(", ")} before your next DPP`,
      to: "/student/revision",
      label: "Open revision queue",
    });
  }
  if (weekly.activeDays === 0 && weekly.daysTracked > 0) {
    steps.push({
      text: "No practice logged this week — a short DPP or battle keeps your streak alive",
      to: "/student/dpp",
      label: "Start a DPP",
    });
  }
  if (steps.length === 0) {
    steps.push({
      text: "You're on track — keep mixing DPP, battles, and self-practice for balanced growth",
      to: "/student/analytics",
      label: "View printable report",
    });
  }
  return steps.slice(0, 3);
}

export default function AcademicAnalytics() {
  const { data, loading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();

  const busy = loading || chartsLoading;

  const hasChartData =
    (charts?.subjects?.length ?? 0) > 0 ||
    (charts?.weekly_activity?.length ?? 0) > 0 ||
    (charts?.dpp_trend?.length ?? 0) > 0 ||
    (charts?.practice_trend?.length ?? 0) > 0;

  const hasSnapshotActivity =
    (data?.exam_readiness?.score ?? 0) > 0 ||
    (data?.xp?.total_battles ?? 0) > 0 ||
    (data?.self_practice?.sessions_completed ?? 0) > 0 ||
    (data?.weak_topics?.length ?? 0) > 0 ||
    (data?.strong_topics?.length ?? 0) > 0 ||
    (data?.mistake_count ?? 0) > 0;

  const showEmpty = !busy && !snapError && !chartsError && !hasChartData && !hasSnapshotActivity;

  const readiness = data?.exam_readiness;
  const toneClass =
    readiness?.tone === "ready" ? "text-accent" : readiness?.tone === "risk" ? "text-destructive" : "text-warning";
  const weekly = computeWeeklySummary(charts?.weekly_activity);
  const insights = buildInsights(data, weekly);
  const firstName = data?.student?.full_name?.split(" ")[0] ?? "Student";

  return (
    <>
      <Button variant="ghost" size="sm" asChild className="mb-2">
        <Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link>
      </Button>

      <PageHeader
        eyebrow="Performance"
        title="Analytics"
        subtitle={`Trends, topic strengths, and weekly momentum for ${firstName}`}
      />

      <div className="flex justify-end mb-4">
        <Button size="sm" variant="outline" asChild>
          <Link to="/student/report"><FileText className="w-4 h-4 mr-1" /> Printable report</Link>
        </Button>
      </div>

      {busy && <StudentAnalyticsSkeleton />}

      {!busy && snapError && <ErrorCard message={snapError} onRetry={reloadSnap} />}
      {!busy && chartsError && <ErrorCard message={chartsError} onRetry={reloadCharts} />}
      {!busy && showEmpty && <AnalyticsEmptyState />}

      {!busy && !showEmpty && (
        <div className="space-y-6">
          {!snapError && (
            <>
              <Card className="hero-panel p-5">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <div>
                    <div className="text-[11px] uppercase tracking-wide text-white/70">Exam readiness</div>
                    <div className={`text-3xl font-bold mt-1 ${toneClass}`}>{readiness?.score ?? 0}%</div>
                    <div className="text-sm text-white/80 mt-1">{readiness?.label ?? "Building profile"}</div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button size="sm" asChild><Link to="/student/practice/math12">Practice</Link></Button>
                    <Button size="sm" variant="secondary" asChild><Link to="/student/recovery">Recovery</Link></Button>
                    <Button size="sm" variant="secondary" asChild><Link to="/student/dpp">Daily DPP</Link></Button>
                  </div>
                </div>
                <Progress value={readiness?.score ?? 0} className="mt-4 h-2" />
              </Card>

              <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
                <StatCard
                  icon={<Target className="w-5 h-5" />}
                  label="Readiness"
                  value={`${readiness?.score ?? 0}%`}
                  tone={readiness?.tone === "ready" ? "accent" : readiness?.tone === "risk" ? "destructive" : "warning"}
                />
                <StatCard
                  icon={<BarChart3 className="w-5 h-5" />}
                  label="Practice accuracy"
                  value={`${readiness?.accuracy_pct ?? 0}%`}
                  hint="DPP + self-practice"
                />
                <StatCard
                  icon={<ClipboardCheck className="w-5 h-5" />}
                  label="Attendance"
                  value={`${readiness?.attendance_pct ?? 0}%`}
                  tone={(readiness?.attendance_pct ?? 0) >= 75 ? "accent" : "warning"}
                />
                <StatCard
                  icon={<AlertTriangle className="w-5 h-5" />}
                  label="Open mistakes"
                  value={data?.mistake_count ?? 0}
                  tone={(data?.mistake_count ?? 0) > 0 ? "warning" : "accent"}
                />
                <StatCard
                  icon={<Flame className="w-5 h-5" />}
                  label="Streak"
                  value={`${data?.xp?.current_streak ?? 0}d`}
                  tone="accent"
                />
                <StatCard
                  icon={<Sword className="w-5 h-5" />}
                  label="Battles / XP"
                  value={`${data?.xp?.wins ?? 0}W`}
                  hint={`${data?.xp?.xp ?? 0} XP · L${data?.xp?.level ?? 1}`}
                />
              </div>
            </>
          )}

          {!chartsError && (charts?.weekly_activity?.length ?? 0) > 0 && (
            <Card className="p-5 shadow-card">
              <div className="flex items-center gap-2 mb-4">
                <CalendarDays className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">This week at a glance</h3>
                <Badge variant="outline" className="ml-auto text-xs">
                  Last {weekly.daysTracked} days
                </Badge>
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 text-sm">
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-muted-foreground text-xs">Questions attempted</div>
                  <div className="text-2xl font-bold mt-1">{weekly.totalQuestions}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-muted-foreground text-xs">Active days</div>
                  <div className="text-2xl font-bold mt-1">{weekly.activeDays}<span className="text-sm font-normal text-muted-foreground">/{weekly.daysTracked}</span></div>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-muted-foreground text-xs">Avg per active day</div>
                  <div className="text-2xl font-bold mt-1">{weekly.avgPerActiveDay}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-muted-foreground text-xs">DPP sessions</div>
                  <div className="text-2xl font-bold mt-1">{weekly.dppCount}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-muted-foreground text-xs">Battles</div>
                  <div className="text-2xl font-bold mt-1">{weekly.battleCount}</div>
                </div>
                <div className="p-3 rounded-lg bg-muted">
                  <div className="text-muted-foreground text-xs">Self-practice</div>
                  <div className="text-2xl font-bold mt-1">{weekly.practiceCount}</div>
                </div>
              </div>
              {weekly.activeDays === 0 && (
                <p className="text-sm text-muted-foreground mt-3">No activity recorded this week. Complete a DPP or practice session to start building momentum.</p>
              )}
            </Card>
          )}

          {!snapError && (
            <div className="grid lg:grid-cols-2 gap-4">
              <Card className="p-5 shadow-card">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingDown className="w-4 h-4 text-warning" />
                  <h3 className="font-semibold">Weak topics — revise first</h3>
                </div>
                <div className="space-y-2">
                  {(data?.weak_topics ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">Complete DPPs, battles, or self-practice to unlock weakness detection.</p>
                  )}
                  {(data?.weak_topics ?? []).map((w, i) => (
                    <div key={i} className="flex justify-between items-center p-2.5 rounded-lg bg-warning/10 border border-warning/20">
                      <div>
                        <div className="font-medium text-sm">{w.subject}</div>
                        <div className="text-xs text-muted-foreground">{[w.chapter, w.topic].filter(Boolean).join(" · ") || "General"}</div>
                      </div>
                      <Badge variant="outline">{w.accuracy}%</Badge>
                    </div>
                  ))}
                </div>
                {(data?.weak_topics?.length ?? 0) > 0 && (
                  <Button size="sm" variant="outline" className="mt-3" asChild>
                    <Link to="/student/revision"><BookOpen className="w-4 h-4 mr-1" /> Revision queue</Link>
                  </Button>
                )}
              </Card>

              <Card className="p-5 shadow-card">
                <div className="flex items-center gap-2 mb-3">
                  <TrendingUp className="w-4 h-4 text-accent" />
                  <h3 className="font-semibold">Strong topics</h3>
                </div>
                <div className="space-y-2">
                  {(data?.strong_topics ?? []).map((w, i) => (
                    <div key={i} className="flex justify-between items-center p-2.5 rounded-lg bg-accent/10">
                      <div>
                        <div className="font-medium text-sm">{w.subject}</div>
                        {(w.chapter || w.topic) && (
                          <div className="text-xs text-muted-foreground">{[w.chapter, w.topic].filter(Boolean).join(" · ")}</div>
                        )}
                      </div>
                      <Badge className="bg-accent/20 text-accent border-0">{w.accuracy}%</Badge>
                    </div>
                  ))}
                  {(data?.strong_topics ?? []).length === 0 && (
                    <p className="text-sm text-muted-foreground">Your strengths will appear as you practice more.</p>
                  )}
                </div>
              </Card>
            </div>
          )}

          {!snapError && insights.length > 0 && (
            <Card className="p-5 shadow-card border-primary/20 bg-primary/5">
              <div className="flex items-center gap-2 mb-3">
                <Lightbulb className="w-4 h-4 text-primary" />
                <h3 className="font-semibold">Recommended next steps</h3>
              </div>
              <ul className="space-y-3">
                {insights.map((step, i) => (
                  <li key={i} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                    <span className="text-muted-foreground">{step.text}</span>
                    <Button size="sm" variant={i === 0 ? "default" : "outline"} asChild>
                      <Link to={step.to === "/student/analytics" ? "/student/report" : step.to}>{step.label}</Link>
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {!chartsError && hasChartData && (
            <div className="grid lg:grid-cols-2 gap-4">
              {(charts?.subjects?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card">
                  <h3 className="font-semibold mb-3">Subject accuracy</h3>
                  <p className="text-xs text-muted-foreground mb-3">DPP + battles + self-practice combined</p>
                  <ChartContainer config={barConfig} className="h-[260px] w-full">
                    <BarChart data={charts?.subjects ?? []} barCategoryGap="18%">
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="name" className="text-xs" />
                      <YAxis domain={[0, 100]} className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Bar dataKey="accuracy" fill="var(--color-accuracy)" radius={[6, 6, 0, 0]} />
                    </BarChart>
                  </ChartContainer>
                </Card>
              )}

              {(charts?.weekly_activity?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card">
                  <h3 className="font-semibold mb-3">Weekly activity</h3>
                  <ChartContainer config={lineConfig} className="h-[260px] w-full">
                    <LineChart data={charts?.weekly_activity ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="date" className="text-xs" tickFormatter={(d) => String(d).slice(5)} />
                      <YAxis className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Line type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} dot={false} />
                      <Line type="monotone" dataKey="dpp" stroke="var(--color-dpp)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="battles" stroke="var(--color-battles)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                      <Line type="monotone" dataKey="self_practice" stroke="var(--color-self_practice)" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
                    </LineChart>
                  </ChartContainer>
                </Card>
              )}

              {(charts?.dpp_trend?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card">
                  <h3 className="font-semibold mb-3">DPP score trend</h3>
                  <p className="text-xs text-muted-foreground mb-3">Last 30 days</p>
                  <ChartContainer config={areaConfig} className="h-[260px] w-full">
                    <AreaChart data={charts?.dpp_trend ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="date" className="text-xs" tickFormatter={(d) => String(d).slice(5)} />
                      <YAxis domain={[0, 100]} className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="score_pct" fill="var(--color-score_pct)" fillOpacity={0.2} stroke="var(--color-score_pct)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </Card>
              )}

              {(charts?.practice_trend?.length ?? 0) > 0 && (
                <Card className="p-5 shadow-card">
                  <h3 className="font-semibold mb-3">Self-practice score trend</h3>
                  <p className="text-xs text-muted-foreground mb-3">Last 30 days</p>
                  <ChartContainer config={practiceAreaConfig} className="h-[260px] w-full">
                    <AreaChart data={charts?.practice_trend ?? []}>
                      <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                      <XAxis dataKey="date" className="text-xs" tickFormatter={(d) => String(d).slice(5)} />
                      <YAxis domain={[0, 100]} className="text-xs" />
                      <ChartTooltip content={<ChartTooltipContent />} />
                      <Area type="monotone" dataKey="score_pct" fill="var(--color-score_pct)" fillOpacity={0.2} stroke="var(--color-score_pct)" strokeWidth={2} />
                    </AreaChart>
                  </ChartContainer>
                </Card>
              )}
            </div>
          )}

          {!snapError && (data?.self_practice?.sessions_completed ?? 0) > 0 && (
            <p className="text-xs text-muted-foreground text-center">
              {data!.self_practice!.sessions_completed} self-practice session{data!.self_practice!.sessions_completed === 1 ? "" : "s"} completed · {data?.xp?.total_battles ?? 0} battles played
            </p>
          )}
        </div>
      )}
    </>
  );
}
