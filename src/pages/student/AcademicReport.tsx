import { useRef } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { AcademicHeatmap } from "@/components/student/AcademicHeatmap";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { ArrowLeft, Printer } from "lucide-react";

const barConfig = { accuracy: { label: "Accuracy %", color: "hsl(var(--primary))" } };
const lineConfig = { total: { label: "Activity", color: "hsl(var(--accent))" } };
const areaConfig = { score_pct: { label: "DPP score %", color: "hsl(var(--primary))" } };

export default function AcademicReport() {
  const printRef = useRef<HTMLDivElement>(null);
  const { data: snap, loading: snapLoading } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading } = useStudentPerformanceCharts();

  const loading = snapLoading || chartsLoading;
  const generated = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  const handlePrint = () => window.print();

  return (
    <>
      <div className="print:hidden mb-2 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/student/analytics"><ArrowLeft className="w-4 h-4" /> Analytics</Link>
        </Button>
        <Button size="sm" onClick={handlePrint} disabled={loading}>
          <Printer className="w-4 h-4 mr-1" /> Print / Save PDF
        </Button>
      </div>

      <div ref={printRef} className="space-y-4 print:p-4">
        <PageHeader
          title="Academic progress report"
          subtitle={`${snap?.student?.full_name ?? "Student"} · Generated ${generated}`}
        />

        {loading ? (
          <p className="text-center text-muted-foreground py-8">Preparing report…</p>
        ) : (
          <>
            <Card className="p-5 shadow-card">
              <h2 className="font-semibold text-lg mb-2">Summary</h2>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <p>Exam readiness: <strong>{snap?.exam_readiness?.score ?? 0}%</strong> ({snap?.exam_readiness?.label})</p>
                <p>Attendance: <strong>{snap?.exam_readiness?.attendance_pct ?? 0}%</strong></p>
                <p>DPP accuracy: <strong>{snap?.exam_readiness?.accuracy_pct ?? 0}%</strong></p>
                <p>Open mistakes: <strong>{snap?.mistake_count ?? 0}</strong></p>
                <p>XP / Level: <strong>{snap?.xp?.xp ?? 0}</strong> / L{snap?.xp?.level ?? 1}</p>
                <p>Battle wins: <strong>{snap?.xp?.wins ?? 0}</strong> ({snap?.xp?.total_battles ?? 0} played)</p>
              </div>
            </Card>

            {(snap?.weak_topics?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card">
                <h2 className="font-semibold mb-2">Focus areas</h2>
                <ul className="text-sm space-y-1">
                  {(snap?.weak_topics ?? []).map((t, i) => (
                    <li key={i}>{t.subject}{t.chapter ? ` · ${t.chapter}` : ""} — {t.accuracy}% accuracy</li>
                  ))}
                </ul>
              </Card>
            )}

            {(snap?.strong_topics?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card">
                <h2 className="font-semibold mb-2">Strengths</h2>
                <ul className="text-sm space-y-1">
                  {(snap?.strong_topics ?? []).map((t, i) => (
                    <li key={i}>{t.subject}{t.chapter ? ` · ${t.chapter}` : ""} — {t.accuracy}% accuracy</li>
                  ))}
                </ul>
              </Card>
            )}

            <Card className="p-5 shadow-card">
              <h2 className="font-semibold mb-3">Activity (28 days)</h2>
              <AcademicHeatmap days={snap?.activity_heatmap ?? []} />
            </Card>

            {(charts?.subjects?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card break-inside-avoid">
                <h2 className="font-semibold mb-3">Subject accuracy</h2>
                <ChartContainer config={barConfig} className="h-[220px] w-full">
                  <BarChart data={charts?.subjects ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis dataKey="name" className="text-xs" tick={{ fontSize: 10 }} />
                    <YAxis domain={[0, 100]} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="accuracy" fill="var(--color-accuracy)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ChartContainer>
              </Card>
            )}

            {(charts?.weekly_activity?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card break-inside-avoid">
                <h2 className="font-semibold mb-3">Weekly activity</h2>
                <ChartContainer config={lineConfig} className="h-[220px] w-full">
                  <LineChart data={charts?.weekly_activity ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis dataKey="date" className="text-xs" tickFormatter={(d) => String(d).slice(5)} />
                    <YAxis className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Line type="monotone" dataKey="total" stroke="var(--color-total)" strokeWidth={2} dot={false} />
                  </LineChart>
                </ChartContainer>
              </Card>
            )}

            {(charts?.dpp_trend?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card break-inside-avoid">
                <h2 className="font-semibold mb-3">DPP score trend</h2>
                <ChartContainer config={areaConfig} className="h-[220px] w-full">
                  <AreaChart data={charts?.dpp_trend ?? []}>
                    <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                    <XAxis dataKey="date" className="text-xs" tickFormatter={(d) => String(d).slice(5)} />
                    <YAxis domain={[0, 100]} className="text-xs" />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Area type="monotone" dataKey="score_pct" fill="var(--color-score_pct)" fillOpacity={0.2} stroke="var(--color-score_pct)" />
                  </AreaChart>
                </ChartContainer>
              </Card>
            )}

            <p className="text-xs text-muted-foreground text-center print:mt-6">
              Wisdom Campus · Student academic report · For personal use
            </p>
          </>
        )}
      </div>
    </>
  );
}
