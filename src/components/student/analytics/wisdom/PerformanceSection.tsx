import type { AcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import type { PracticeSessionSummary } from "@/hooks/useAnalysisPageData";
import type { StudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import {
  buildPersonalBests,
  consistencyGrid,
  consistencyLevel,
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
import { Award, Calendar, Flame, Target, Timer, TrendingUp, Users } from "lucide-react";

type Props = {
  data: AcademicSnapshot;
  charts: StudentPerformanceCharts | null;
  sessions: PracticeSessionSummary[];
  accuracy: number;
  rank: number | null;
  classSize: number;
  improvement: number | null;
};

const CONSISTENCY_COLORS = [
  "bg-[var(--wa-surface-variant)]",
  "bg-[var(--wa-primary-fixed)]",
  "bg-[var(--wa-primary-fixed-dim)]",
  "bg-[var(--wa-surface-tint)]",
  "bg-[var(--wa-primary)]",
];

export function PerformanceSection({
  data,
  charts,
  sessions,
  accuracy,
  rank,
  classSize,
  improvement,
}: Props) {
  const trendData = (charts?.practice_trend ?? []).slice(-14).map((p) => ({
    label: new Date(p.date).toLocaleDateString(undefined, { month: "short", day: "numeric" }),
    accuracy: p.score_pct,
  }));

  const benchmarks = peerBenchmarkSubjects(charts?.subjects ?? [], rank, classSize);
  const bests = buildPersonalBests(data, sessions, accuracy);
  const grid = consistencyGrid(data.activity_heatmap);

  return (
    <div className="space-y-6">
      <header>
        <h2 className="wa-display text-2xl">Performance trends</h2>
        <p className="wa-body mt-1">Momentum, class context, and study consistency.</p>
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
            {benchmarks.length > 0 ? (
              benchmarks.map((b) => (
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
            {bests.length > 0 ? (
              bests.map((b, i) => (
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

      <section className="wa-card">
        <h3 className="wa-headline flex items-center gap-2 text-[var(--wa-primary)] mb-4">
          <Calendar className="w-4 h-4" />
          Consistency tracker
        </h3>
        {grid.length > 0 ? (
          <>
            <div className="overflow-x-auto pb-2">
              <div className="flex flex-wrap gap-1 min-w-[280px]">
                {grid.map((c) => (
                  <div
                    key={c.date}
                    className={`wa-consistency-cell ${CONSISTENCY_COLORS[consistencyLevel(c.total)]}`}
                    title={`${c.date}: ${c.total} activities`}
                  />
                ))}
              </div>
            </div>
            <div className="flex justify-end items-center mt-3 gap-2 text-[10px] font-mono text-[var(--wa-on-surface-variant)]">
              <span>Less</span>
              {CONSISTENCY_COLORS.map((c, i) => (
                <div key={i} className={`w-3 h-3 rounded-sm ${c}`} />
              ))}
              <span>More</span>
            </div>
          </>
        ) : (
          <p className="wa-body">Daily activity blocks appear when you use DPP, practice, or battles.</p>
        )}
      </section>
    </div>
  );
}
