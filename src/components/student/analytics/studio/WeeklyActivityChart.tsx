import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WeeklyActivityPoint } from "@/hooks/useStudentPerformanceCharts";

type Props = {
  weeklyActivity: WeeklyActivityPoint[];
};

function formatDay(date: string) {
  const d = new Date(date);
  return d.toLocaleDateString(undefined, { weekday: "short" });
}

export function WeeklyActivityChart({ weeklyActivity }: Props) {
  if (weeklyActivity.length === 0) return null;

  const data = weeklyActivity.map((w) => ({
    day: formatDay(w.date),
    DPP: w.dpp ?? 0,
    Practice: w.self_practice ?? 0,
    Battles: w.battles ?? 0,
  }));

  return (
    <section>
      <h2 className="as-section-title">Weekly activity</h2>
      <div className="as-card">
        <div className="h-[240px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="day" tick={{ fill: "#8b9bb8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#8b9bb8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#121a2e",
                  border: "1px solid rgba(99,130,191,0.18)",
                  borderRadius: 8,
                  color: "#e8edf7",
                }}
              />
              <Legend wrapperStyle={{ fontSize: 11, color: "#8b9bb8" }} />
              <Bar dataKey="DPP" stackId="a" fill="#4f8cff" radius={[0, 0, 0, 0]} />
              <Bar dataKey="Practice" stackId="a" fill="#38d9f5" />
              <Bar dataKey="Battles" stackId="a" fill="#a78bfa" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
