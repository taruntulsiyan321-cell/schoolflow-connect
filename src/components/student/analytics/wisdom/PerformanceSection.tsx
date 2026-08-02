import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import {
  buildPersonalBests,
  peerBenchmarkSubjects,
} from "@/components/student/analytics/wisdom/analyticsDerived";
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
  const trendSource = rawTrend.length >= 2 ? rawTrend : [];
  const trendData = trendSource.slice(-14).map((p) => ({
    label: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    accuracy: p.score_pct,
  }));

  const benchmarks = peerBenchmarkSubjects(charts?.subjects ?? [], rank, classSize);
  const displayBenchmarks = benchmarks;
  const bests = buildPersonalBests(data, sessions, accuracy);
  const displayBests = bests;
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
    recentActivity.length > 0
      ? [
          { label: "Active days", value: activeDays, sub: "last 14 days" },
          { label: "Learning actions", value: totalActivity, sub: "practice, DPP & battles" },
          {
            label: "Best day",
            value: bestDay.total,
            sub: bestDay.date ? new Date(bestDay.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "—",
          },
        ]
      : [];

  return (
    <div className="space-y-6">
      <header className="text-center md:text-left">
        <h2 className="wa-display text-2xl md:text-3xl">Performance Trends</h2>
        <p className="wa-body mt-1">Tracking your momentum across the learning arena.</p>
      </header>

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="wa-card">
          <div className="flex items-center gap-2 mb-4">
            <TrendingUp className="w-4 h-4 text-[var(--wa-primary)]" />
            <h3 className="wa-headline">Practice accuracy</h3>
          </div>
          {trendData.length >= 2 ? (
            <div className="h-52">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <XAxis dataKey="label" tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} axisLine={false} tickLine={false} />
                  <Tooltip />
                  <Line type="monotone" dataKey="accuracy" stroke="#003324" strokeWidth={2} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <p className="wa-body py-10 text-center">Complete more practice sessions to unlock this trend.</p>
          )}
          {improvement != null && (
            <p className="text-xs text-[var(--wa-on-surface-variant)] mt-2">
              Period change: {improvement > 0 ? "+" : ""}{improvement}% · Overall accuracy {accuracy}%
            </p>
          )}
        </div>

        <div className="wa-card">
          <div className="flex items-center gap-2 mb-4">
            <Users className="w-4 h-4 text-[var(--wa-primary)]" />
            <h3 className="wa-headline">Subject standing</h3>
          </div>
          {displayBenchmarks.length > 0 ? (
            <div className="space-y-3">
              {displayBenchmarks.map((b) => (
                <div key={b.name} className="flex items-center justify-between gap-3">
                  <span className="text-sm font-medium">{b.name}</span>
                  <span className="text-xs text-[var(--wa-on-surface-variant)]">{b.label}</span>
                  <strong className="tabular-nums text-sm">{b.pct}%</strong>
                </div>
              ))}
            </div>
          ) : (
            <p className="wa-body py-6 text-center">Subject standing appears after practice attempts.</p>
          )}
          {rank != null && classSize > 0 && (
            <p className="text-xs text-[var(--wa-on-surface-variant)] mt-4">
              Class rank #{rank} of {classSize}
            </p>
          )}
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {displayBests.length > 0 ? displayBests.map((b) => {
          const Icon = b.icon === "timer" ? Timer : b.icon === "flame" ? Flame : Target;
          return (
            <div key={b.title} className="wa-card flex items-start gap-3">
              <Award className="w-4 h-4 mt-0.5 text-[var(--wa-primary)]" />
              <div>
                <p className="wa-label">{b.kind}</p>
                <p className="text-sm font-semibold mt-1 flex items-center gap-1">
                  <Icon className="w-3.5 h-3.5" /> {b.title}
                </p>
              </div>
            </div>
          );
        }) : (
          <p className="wa-body md:col-span-3 text-center py-4">Personal bests unlock as you practise.</p>
        )}
      </div>

      {rhythmStats.length > 0 && (
        <div className="grid sm:grid-cols-3 gap-4">
          {rhythmStats.map((s) => (
            <div key={s.label} className="wa-card">
              <div className="flex items-center gap-2 mb-2">
                <CalendarCheck className="w-4 h-4 text-[var(--wa-primary)]" />
                <p className="wa-label">{s.label}</p>
              </div>
              <p className="text-2xl font-bold tabular-nums">{s.value}</p>
              <p className="text-xs text-[var(--wa-on-surface-variant)] mt-1">{s.sub}</p>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
