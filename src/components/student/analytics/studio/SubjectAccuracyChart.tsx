import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SubjectChartPoint } from "@/hooks/useStudentPerformanceCharts";

type Props = {
  subjects: SubjectChartPoint[];
};

export function SubjectAccuracyChart({ subjects }: Props) {
  if (subjects.length === 0) return null;

  const data = subjects.map((s) => ({
    name: s.name.length > 10 ? `${s.name.slice(0, 9)}…` : s.name,
    accuracy: Math.round(s.accuracy),
  }));

  return (
    <section>
      <h2 className="as-section-title">Subject accuracy comparison</h2>
      <div className="as-card">
        <div className="h-[220px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" vertical={false} />
              <XAxis dataKey="name" tick={{ fill: "#8b9bb8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis domain={[0, 100]} tick={{ fill: "#8b9bb8", fontSize: 11 }} axisLine={false} tickLine={false} />
              <Tooltip
                contentStyle={{
                  background: "#121a2e",
                  border: "1px solid rgba(99,130,191,0.18)",
                  borderRadius: 8,
                  color: "#e8edf7",
                }}
                formatter={(value: number) => [`${value}%`, "Accuracy"]}
              />
              <Bar dataKey="accuracy" fill="#4f8cff" radius={[6, 6, 0, 0]} maxBarSize={48} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </section>
  );
}
