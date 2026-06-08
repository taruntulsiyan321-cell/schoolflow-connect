import { Link } from "react-router-dom";

import { Card } from "@/components/ui/card";

import { Button } from "@/components/ui/button";

import { PageHeader } from "@/components/ui-bits";

import { useStudentAcademicSnapshot } from "@/hooks/useStudentAcademicSnapshot";

import { useStudentPerformanceCharts } from "@/hooks/useStudentPerformanceCharts";

import { AcademicHeatmap } from "@/components/student/AcademicHeatmap";

import { ChartContainer, ChartTooltip, ChartTooltipContent } from "@/components/ui/chart";

import { BarChart, Bar, LineChart, Line, AreaChart, Area, XAxis, YAxis, CartesianGrid } from "recharts";

import { BarChart3, ArrowLeft, FileText } from "lucide-react";



const barConfig = { accuracy: { label: "Accuracy %", color: "hsl(var(--primary))" } };

const lineConfig = {

  total: { label: "Total", color: "hsl(var(--primary))" },

  dpp: { label: "DPP", color: "hsl(var(--accent))" },

  battles: { label: "Battles", color: "hsl(var(--warning))" },

};

const areaConfig = { score_pct: { label: "Score %", color: "hsl(var(--primary))" } };



export default function AcademicAnalytics() {

  const { data, loading, error: snapError, reload: reloadSnap } = useStudentAcademicSnapshot();
  const { data: charts, loading: chartsLoading, error: chartsError, reload: reloadCharts } = useStudentPerformanceCharts();

  const busy = loading || chartsLoading;
  const loadError = snapError || chartsError;



  return (

    <>

      <Button variant="ghost" size="sm" asChild className="mb-2">

        <Link to="/student"><ArrowLeft className="w-4 h-4" /> Dashboard</Link>

      </Button>

      <PageHeader title="Performance analytics" subtitle="Trends, consistency, and topic-level growth" />

      <div className="flex justify-end mb-4">

        <Button size="sm" variant="outline" asChild>

          <Link to="/student/report"><FileText className="w-4 h-4 mr-1" /> Printable report</Link>

        </Button>

      </div>

      {!busy && loadError && (
        <Card className="p-6 text-center mb-4">
          <p className="text-sm text-muted-foreground mb-2">Analytics could not be loaded. Run pending Supabase migrations if this is a new environment.</p>
          <p className="text-xs text-destructive mb-3">{loadError}</p>
          <Button size="sm" variant="outline" onClick={() => { reloadSnap(); reloadCharts(); }}>Try again</Button>
        </Card>
      )}

      {busy ? <p className="text-center text-muted-foreground py-8">Loading…</p> : !loadError && (

        <div className="space-y-4">

          <Card className="p-5 shadow-card">

            <h3 className="font-semibold flex items-center gap-2 mb-3"><BarChart3 className="w-4 h-4" /> Activity consistency (28 days)</h3>

            <AcademicHeatmap days={data?.activity_heatmap ?? []} />

          </Card>



          {(charts?.subjects?.length ?? 0) > 0 && (

            <Card className="p-5 shadow-card">

              <h3 className="font-semibold mb-3">Subject accuracy (DPP + battles + self-practice)</h3>

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

                </LineChart>

              </ChartContainer>

            </Card>

          )}



          {(charts?.dpp_trend?.length ?? 0) > 0 && (

            <Card className="p-5 shadow-card">

              <h3 className="font-semibold mb-3">DPP score trend (30 days)</h3>

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



          <Card className="p-5 shadow-card">

            <h3 className="font-semibold mb-2">Personal academic report</h3>

            <p className="text-sm text-muted-foreground mb-3">

              Exam readiness: <strong>{data?.exam_readiness?.score ?? 0}%</strong> — {data?.exam_readiness?.label}

            </p>

            <p className="text-sm text-muted-foreground">

              Battles played: {data?.xp?.total_battles ?? 0} · Wins: {data?.xp?.wins ?? 0} · XP: {data?.xp?.xp ?? 0}

            </p>

          </Card>

        </div>

      )}

    </>

  );

}

