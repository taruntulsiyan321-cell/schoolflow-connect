import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import {
  buildPersonalBests,
  peerBenchmarkSubjects,
} from "@/components/student/analytics/wisdom/analyticsDerived";
import { PRESENTATION_MODE } from "@/lib/presentationMode";
import { demoPracticeTrend } from "@/lib/presentationAnalytics";
import {
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Award, CalendarCheck, Flame, Target, Timer, TrendingUp, Users } from "lucide-react";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  sessions: PracticeSessionSummary[];
  accuracy: number;
  rank: number | null;
  classSize: number;
  improvement: number | null;
};

export function PerformanceSection({
  data,
  charts,
  sessions,
  accuracy,
  rank,
  classSize,
  improvement,
}: Props) {
  const rawTrend = charts?.practice_trend ?? [];
  const trendSource = rawTrend.length >= 2 ? rawTrend : PRESENTATION_MODE ? demoPracticeTrend() : [];
  const trendData = trendSource.slice(-14).map((p) => ({
    label: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    accuracy: p.score_pct,
  }));

  const benchmarks = peerBenchmarkSubjects(charts?.subjects ?? [], rank, classSize);
  const displayBenchmarks =
    benchmarks.length > 0
      ? benchmarks
      : PRESENTATION_MODE
        ? [
            { name: "Mathematics", pct: 74, label: "Above average" },
            { name: "Physics", pct: 68, label: "On track" },
            { name: "Chemistry", pct: 61, label: "Needs focus" },
          ]
        : [];
  const bests = buildPersonalBests(data, sessions, accuracy);
  const displayBests =
    bests.length > 0
      ? bests
      : PRESENTATION_MODE
        ? [
            { kind: "RECORD", title: "82% in Differentiation", icon: "target" as const },
            { kind: "PACE", title: "Fastest session: 14 min (6/8)", icon: "timer" as const },
            { kind: "STREAK", title: "5-day practice streak", icon: "flame" as const },
          ]
        : [];
  const activityRows = data.activity_heatmap ?? [];
  const recentActivity = activityRows.slice(-14);
  const activeDays = recentActivity.filter((d) => (d.dpp ?? 0) + (d.homework ?? 0) + (d.battles ?? 0) + (d.self_practice ?? 0) > 0).length;
  const totalActivity = recentActivity.reduce(
    (sum, d) => sum + (d.dpp ?? 0) + (d.homework ?? 0) + (d.battles ?? 0) + (d.self_practice ?? 0),
    0,
  );
  const bestDay = recentActivity.reduce(
    (best, d) => {
      const total = (d.dpp ?? 0) + (d.homework ?? 0) + (d.battles ?? 0) + (d.self_practice ?? 0);
      return total > best.total ? { date: d.date, total } : best;
    },
    { date: "", total: 0 },
  );
  const rhythmStats =
    recentActivity.length > 0 || PRESENTATION_MODE
      ? [
          { label: "Active days", value: activeDays || 9, sub: "last 14 days" },
          { label: "Learning actions", value: totalActivity || 42, sub: "practice, DPP & battles" },
          {
            label: "Best day",
            value: bestDay.total || 8,
            sub: bestDay.date ? new Date(bestDay.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "this week",
          },
        ]
      : [];

  return (
    <div className="space-y-6">
      <header className="text-center md:text-left">
        <h2 className="wa-display text-2xl md:text-3xl">Performance Trends</h2>
        <p className="wa-body mt-1">Tracking your momentum across the learning arena.</p>
      </header>

      <section className="wa-card">
        <div className="flex flex-wrap justify-between items-start gap-3 mb-4">
          <div>
            <h3 className="wa-headline flex items-center gap-2 text-[var(--wa-primary)]">
              <TrendingUp className="w-4 h-4" />
              Growth velocity
            </h3>
            <p className="wa-body text-sm mt-1">Practice accuracy over recent sessions</p>
          </div>
          {improvement != null && (
            <span
              className={`text-xs font-semibold px-2 py-1 rounded ${
                improvement >= 0 ? "bg-[var(--wa-primary-fixed)] text-[var(--wa-primary)]" : "bg-[var(--wa-error-container)] text-[var(--wa-error)]"
              }`}
            >
              {improvement >= 0 ? "+" : ""}
              {improvement}% vs last session
            </span>
          )}
        </div>
        {trendData.length >= 2 ? (
          <div className="h-52 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={trendData} margin={{ top: 8, right: 8, left: -20, bottom: 0 }}>
                <XAxis dataKey="label" tick={{ fontSize: 10, fill: "#707974" }} axisLine={false} tickLine={false} />
                <YAxis domain={[0, 100]} tick={{ fontSize: 10, fill: "#707974" }} axisLine={false} tickLine={false} />
                <Tooltip
                  contentStyle={{
                    background: "#fff",
                    border: "1px solid #bfc9c2",
                    borderRadius: 8,
                    fontSize: 12,
                  }}
                />
                <Line type="monotone" dataKey="accuracy" stroke="#003324" strokeWidth={2} dot={{ r: 3, fill: "#003324" }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="wa-body py-8 text-center">Finish two or more sessions to see your trend line.</p>
        )}
      </section>

      <div className="grid md:grid-cols-2 gap-6">
        <section className="wa-card">
          <h3 className="wa-headline flex items-center gap-2 text-[var(--wa-primary)] mb-4">
            <Users className="w-4 h-4 text-[var(--wa-secondary)]" />
            Peer benchmarking
          </h3>
          <div className="space-y-5">
            {displayBenchmarks.length > 0 ? (
              displayBenchmarks.map((b) => (
                <div key={b.name}>
                  <div className="flex justify-between text-sm font-medium mb-1">
                    <span>{b.name}</span>
                    <span className="text-[var(--wa-primary)] font-bold">{b.label}</span>
                  </div>
                  <div className="h-2.5 w-full bg-[var(--wa-surface-variant)] rounded-full overflow-hidden">
                    <div
                      className="h-full bg-[var(--wa-primary)] rounded-full"
                      style={{ width: `${b.pct}%` }}
                    />
                  </div>
                  <p className="text-[10px] text-[var(--wa-on-surface-variant)] mt-1 tabular-nums">{b.pct}% accuracy</p>
                </div>
              ))
            ) : (
              <p className="wa-body">Subject benchmarks appear after multi-subject practice.</p>
            )}
          </div>
        </section>

        <section className="wa-card bg-[var(--wa-surface-low)] relative overflow-hidden">
          <h3 className="wa-headline flex items-center gap-2 text-[var(--wa-primary)] mb-4">
            <Award className="w-4 h-4 text-[var(--wa-secondary)]" />
            Personal bests
          </h3>
          <div className="space-y-3">
            {displayBests.length > 0 ? (
              displayBests.map((b, i) => (
                <div key={i} className="flex items-center gap-3 bg-white p-3 rounded-lg border border-[var(--wa-outline-variant)]/50">
                  <div className="w-10 h-10 rounded-full bg-[var(--wa-secondary-container)]/30 flex items-center justify-center text-[var(--wa-secondary)]">
                    {b.icon === "timer" ? <Timer className="w-5 h-5" /> : b.icon === "flame" ? <Flame className="w-5 h-5" /> : <Target className="w-5 h-5" />}
                  </div>
                  <div>
                    <span className="wa-label block">{b.kind}</span>
                    <span className="text-sm font-semibold text-[var(--wa-on-surface)]">{b.title}</span>
                  </div>
                </div>
              ))
            ) : (
              <p className="wa-body">Records unlock as you complete sessions.</p>
            )}
          </div>
        </section>
      </div>

      <section className="wa-card wa-rhythm-card">
        <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
          <div>
            <h3 className="wa-headline flex items-center gap-2 text-[var(--wa-primary)]">
              <CalendarCheck className="w-4 h-4" />
              Learning rhythm
            </h3>
            <p className="wa-body text-sm mt-1">A simple consistency summary without the heat map.</p>
          </div>
          <span className="wa-label rounded-full bg-white/70 px-3 py-1 border border-[var(--wa-outline-variant)]">
            Last 14 days
          </span>
        </div>
        {rhythmStats.length > 0 ? (
          <div className="grid sm:grid-cols-3 gap-3">
            {rhythmStats.map((stat) => (
              <div key={stat.label} className="rounded-2xl bg-white/80 border border-[var(--wa-outline-variant)]/60 p-4">
                <p className="wa-label text-[10px]">{stat.label}</p>
                <p className="text-3xl font-bold tabular-nums text-[var(--wa-primary)] mt-1">{stat.value}</p>
                <p className="text-xs text-[var(--wa-on-surface-variant)] mt-1">{stat.sub}</p>
              </div>
            ))}
          </div>
        ) : (
          <p className="wa-body">Consistency insights appear when you use DPP, practice, or battles.</p>
        )}
      </section>
    </div>
  );
}
