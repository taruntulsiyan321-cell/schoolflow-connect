import { useRef } from "react";
import { Link } from "react-router-dom";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageHeader } from "@/components/ui-bits";
import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";
import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";
import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";
import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";
import { ArrowLeft, Printer } from "lucide-react";
import { ConceptMastery } from "@/components/student/ConceptMastery";
import { useConceptMastery } from "@/hooks/useConceptMastery";
import { buildRuleConceptReport } from "@/lib/conceptReportFallback";
import { displayChapter, displaySubject } from "@/lib/academicDisplay";
import {
  formatLearningProgressSummary,
  practiceAccuracyFromSnapshot,
  studyActiveDaysFromSnapshot,
} from "@/lib/learningMetrics";
import { toDisplayText } from "@/lib/presentation";

const barConfig = { accuracy: { label: "Accuracy %", color: "hsl(var(--primary))" } };
const lineConfig = { total: { label: "Activity", color: "hsl(var(--accent))" } };
const areaConfig = { score_pct: { label: "DPP score %", color: "hsl(var(--primary))" } };
const practiceAreaConfig = { score_pct: { label: "Practice score %", color: "hsl(var(--accent))" } };

export default function AcademicReport() {
  const printRef = useRef<HTMLDivElement>(null);
  const { data: snap, loading: snapLoading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();
  const { items: masteryItems } = useConceptMastery();
  const conceptInsights = masteryItems.length > 0
    ? buildRuleConceptReport({
        source_type: "report",
        source_id: "snapshot",
        accuracy_pct: practiceAccuracyFromSnapshot(snap),
        correct_count: 0,
        total_count: 0,
        time_minutes: 0,
        weak_concepts: masteryItems.filter((m) => m.mastery_score < 55).slice(0, 5).map((m) => ({
          subject: m.subject,
          chapter: m.chapter,
          concept: m.concept,
          accuracy: Math.round(m.mastery_score),
        })),
        strong_concepts: masteryItems.filter((m) => m.mastery_score >= 75).slice(0, 3).map((m) => ({
          subject: m.subject,
          concept: m.concept,
          accuracy: Math.round(m.mastery_score),
        })),
        recovery_assignments: [],
        improvement_areas: masteryItems.filter((m) => m.mastery_score < 55).map((m) => m.concept),
      })
    : null;

  const loading = snapLoading || chartsLoading;
  const loadError = snapError || chartsError;
  const generated = new Date().toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

  const handlePrint = () => window.print();

  return (
    <>
      <div className="print:hidden mb-2 flex flex-wrap gap-2">
        <Button variant="ghost" size="sm" asChild>
          <Link to="/student/analysis"><ArrowLeft className="w-4 h-4" /> Analysis</Link>
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
        ) : loadError ? (
          <Card className="p-6 text-center">
            <p className="text-sm text-muted-foreground mb-2">Report data could not be loaded. Apply pending Supabase migrations if this is a new environment.</p>
            <p className="text-xs text-destructive mb-3">{loadError}</p>
            <Button size="sm" variant="outline" onClick={() => { reloadSnap(); reloadCharts(); }}>Try again</Button>
          </Card>
        ) : (
          <>
            <Card className="p-5 shadow-card">
              <h2 className="font-semibold text-lg mb-2">Summary</h2>
              <div className="grid sm:grid-cols-2 gap-3 text-sm">
                <p>Practice accuracy: <strong>{practiceAccuracyFromSnapshot(snap)}%</strong></p>
                <p>Study consistency: <strong>{studyActiveDaysFromSnapshot(snap)}</strong> active days (14d)</p>
                <p>Attendance: <strong>{snap?.exam_readiness?.attendance_pct ?? 0}%</strong></p>
                <p>Open mistakes: <strong>{snap?.mistake_count ?? 0}</strong></p>
                <p>Recovery pending: <strong>{snap?.recovery_pending ?? 0}</strong></p>
                <p>XP / Level: <strong>{snap?.xp?.xp ?? 0}</strong> / L{snap?.xp?.level ?? 1}</p>
                <p>Battle wins: <strong>{snap?.xp?.wins ?? 0}</strong> ({snap?.xp?.total_battles ?? 0} played)</p>
                <p className="sm:col-span-2 text-muted-foreground text-xs">{formatLearningProgressSummary(snap)}</p>
              </div>
            </Card>

            <Card className="p-5 shadow-card">
              <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
                <h2 className="font-semibold text-lg">Concept mastery</h2>
                <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild>
                  <Link to="/student/analysis#mastery">View full skill tree</Link>
                </Button>
              </div>
              <ConceptMastery />
            </Card>

            {conceptInsights && (
              <Card className="p-5 shadow-card">
                <h2 className="font-semibold mb-2">Concept improvement insights</h2>
                <p className="font-medium text-sm">{conceptInsights.headline}</p>
                <ul className="text-sm text-muted-foreground mt-2 space-y-1 list-disc pl-4">
                  {conceptInsights.bullets.map((b, i) => <li key={i}>{b}</li>)}
                </ul>
                <p className="text-xs font-medium mt-3 mb-1">Recommended next steps</p>
                <ol className="text-sm text-muted-foreground space-y-1 list-decimal pl-4">
                  {conceptInsights.next_steps.map((s, i) => <li key={i}>{s}</li>)}
                </ol>
              </Card>
            )}

            {(snap?.weak_topics?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card">
                <h2 className="font-semibold mb-2">Focus areas</h2>
                <ul className="text-sm space-y-1">
                  {(snap?.weak_topics ?? []).map((t, i) => (
                    <li key={i}>{displaySubject(t.subject)}{t.chapter ? ` · ${displayChapter(t.chapter)}` : ""} — {t.accuracy}% accuracy</li>
                  ))}
                </ul>
              </Card>
            )}

            {(snap?.strong_topics?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card">
                <h2 className="font-semibold mb-2">Strengths</h2>
                <ul className="text-sm space-y-1">
                  {(snap?.strong_topics ?? []).map((t, i) => (
                    <li key={i}>{displaySubject(t.subject)}{t.chapter ? ` · ${displayChapter(t.chapter)}` : ""} — {t.accuracy}% accuracy</li>
                  ))}
                </ul>
              </Card>
            )}

            {(charts?.weekly_activity?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card">
                <h2 className="font-semibold mb-3">Weekly activity summary</h2>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b text-left text-muted-foreground">
                        <th className="py-2 pr-4 font-medium">Date</th>
                        <th className="py-2 pr-4 font-medium">Total</th>
                        <th className="py-2 pr-4 font-medium">DPP</th>
                        <th className="py-2 pr-4 font-medium">Battles</th>
                        <th className="py-2 font-medium">Self-practice</th>
                      </tr>
                    </thead>
                    <tbody>
                      {(charts?.weekly_activity ?? []).map((row) => (
                        <tr key={row.date} className="border-b border-border/50">
                          <td className="py-2 pr-4">{toDisplayText(row.date, { fallback: "" }).slice(5)}</td>
                          <td className="py-2 pr-4 font-medium">{row.total}</td>
                          <td className="py-2 pr-4">{row.dpp}</td>
                          <td className="py-2 pr-4">{row.battles}</td>
                          <td className="py-2">{row.self_practice ?? 0}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="text-xs text-muted-foreground mt-3">
                  {(() => {
                    const recent = (charts?.weekly_activity ?? []).slice(-7);
                    const total = recent.reduce((s, d) => s + d.total, 0);
                    const active = recent.filter((d) => d.total > 0).length;
                    return `${total} questions across ${active} active day${active === 1 ? "" : "s"} in the last week`;
                  })()}
                </p>
              </Card>
            )}

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

            {(charts?.practice_trend?.length ?? 0) > 0 && (
              <Card className="p-5 shadow-card break-inside-avoid">
                <h2 className="font-semibold mb-3">Self-practice score trend</h2>
                <ChartContainer config={practiceAreaConfig} className="h-[220px] w-full">
                  <AreaChart data={charts?.practice_trend ?? []}>
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
