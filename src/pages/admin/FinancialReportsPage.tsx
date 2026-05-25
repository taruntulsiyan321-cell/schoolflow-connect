import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PageHeader, StatCard } from "@/components/ui-bits";
import { ChartContainer, ChartTooltip, ChartTooltipContent, ChartLegend, ChartLegendContent } from "@/components/ui/chart";
import {
  BarChart, Bar, AreaChart, Area, PieChart, Pie, Cell, LineChart, Line,
  XAxis, YAxis, CartesianGrid, ResponsiveContainer,
} from "recharts";
import {
  Wallet, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  Download, PieChart as PieIcon, BarChart3, IndianRupee, FileSpreadsheet,
} from "lucide-react";

/* ── helpers ─────────────────────────────────────────────────── */
const fmt = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const CHART_COLORS = [
  "hsl(221, 83%, 53%)", "hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)",
  "hsl(0, 84%, 60%)", "hsl(199, 89%, 48%)", "hsl(262, 83%, 58%)",
  "hsl(175, 70%, 41%)", "hsl(330, 70%, 55%)",
];
const PIE_COLORS = ["hsl(142, 71%, 45%)", "hsl(38, 92%, 50%)", "hsl(0, 84%, 60%)"];

/* ── component ───────────────────────────────────────────────── */
export default function FinancialReportsPage() {
  const [fees, setFees] = useState<any[]>([]);
  const [students, setStudents] = useState<any[]>([]);
  const [classes, setClasses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [year, setYear] = useState(String(new Date().getFullYear()));

  // ── load data ──
  useEffect(() => {
    (async () => {
      setLoading(true);
      const [f, s, c] = await Promise.all([
        supabase.from("fees").select("*"),
        supabase.from("students").select("id,full_name,class_id,admission_number"),
        supabase.from("classes").select("id,name,section"),
      ]);
      setFees(f.data ?? []);
      setStudents(s.data ?? []);
      setClasses(c.data ?? []);
      setLoading(false);
    })();
  }, []);

  // ── available years ──
  const years = useMemo(() => {
    const s = new Set<string>();
    fees.forEach((f) => { if (f.month) s.add(f.month.slice(0, 4)); });
    if (s.size === 0) s.add(String(new Date().getFullYear()));
    return Array.from(s).sort().reverse();
  }, [fees]);

  // ── filtered by year ──
  const filtered = useMemo(() => fees.filter((f) => f.month?.startsWith(year)), [fees, year]);

  // ── KPIs ──
  const kpis = useMemo(() => {
    const totalInflow = filtered.reduce((a, f) => a + Number(f.paid_amount || 0), 0);
    const totalDue = filtered.reduce((a, f) => a + Number(f.amount || 0), 0);
    const outstanding = Math.max(0, totalDue - totalInflow);
    const collectionRate = totalDue > 0 ? Math.round((totalInflow / totalDue) * 100) : 0;
    const paid = filtered.filter((f) => f.status === "paid").length;
    const partial = filtered.filter((f) => f.status === "partial").length;
    const unpaid = filtered.filter((f) => f.status === "unpaid").length;
    return { totalInflow, totalDue, outstanding, collectionRate, paid, partial, unpaid, total: filtered.length };
  }, [filtered]);

  // ── monthly trend ──
  const monthlyTrend = useMemo(() => {
    const map: Record<string, { inflow: number; due: number }> = {};
    MONTHS.forEach((_, i) => {
      const key = `${year}-${String(i + 1).padStart(2, "0")}`;
      map[key] = { inflow: 0, due: 0 };
    });
    filtered.forEach((f) => {
      const key = f.month?.slice(0, 7);
      if (key && map[key]) {
        map[key].inflow += Number(f.paid_amount || 0);
        map[key].due += Number(f.amount || 0);
      }
    });
    return Object.entries(map).map(([month, v]) => ({
      month: MONTHS[Number(month.slice(5, 7)) - 1],
      inflow: v.inflow,
      outflow: v.due - v.inflow,
      due: v.due,
    }));
  }, [filtered, year]);

  // ── class-wise breakdown ──
  const classBreakdown = useMemo(() => {
    const stuMap = new Map(students.map((s) => [s.id, s.class_id]));
    const classMap = new Map(classes.map((c) => [c.id, `${c.name}-${c.section}`]));
    const agg: Record<string, { name: string; collected: number; due: number }> = {};
    filtered.forEach((f) => {
      const cid = stuMap.get(f.student_id) || "unknown";
      const name = classMap.get(cid) || "Unassigned";
      if (!agg[cid]) agg[cid] = { name, collected: 0, due: 0 };
      agg[cid].collected += Number(f.paid_amount || 0);
      agg[cid].due += Number(f.amount || 0);
    });
    return Object.values(agg).sort((a, b) => a.name.localeCompare(b.name));
  }, [filtered, students, classes]);

  // ── pie data ──
  const pieData = useMemo(() => [
    { name: "Paid", value: kpis.paid, fill: PIE_COLORS[0] },
    { name: "Partial", value: kpis.partial, fill: PIE_COLORS[1] },
    { name: "Unpaid", value: kpis.unpaid, fill: PIE_COLORS[2] },
  ], [kpis]);

  // ── cumulative line ──
  const cumulativeData = useMemo(() => {
    let cum = 0;
    return monthlyTrend.map((m) => {
      cum += m.inflow;
      return { month: m.month, cumulative: cum };
    });
  }, [monthlyTrend]);

  // ── defaulters ──
  const defaulters = useMemo(() => {
    const stuMap = new Map(students.map((s) => [s.id, s]));
    const classMap = new Map(classes.map((c) => [c.id, `${c.name}-${c.section}`]));
    const agg: Record<string, { name: string; admission: string; cls: string; owed: number }> = {};
    filtered.filter((f) => f.status !== "paid").forEach((f) => {
      const s = stuMap.get(f.student_id);
      if (!s) return;
      if (!agg[f.student_id]) {
        agg[f.student_id] = {
          name: s.full_name, admission: s.admission_number || "—",
          cls: classMap.get(s.class_id) || "—", owed: 0,
        };
      }
      agg[f.student_id].owed += Number(f.amount || 0) - Number(f.paid_amount || 0);
    });
    return Object.values(agg).sort((a, b) => b.owed - a.owed).slice(0, 15);
  }, [filtered, students, classes]);

  // ── chart configs ──
  const barConfig = { inflow: { label: "Inflow", color: "hsl(142, 71%, 45%)" }, outflow: { label: "Outstanding", color: "hsl(0, 84%, 60%)" } };
  const areaConfig = { inflow: { label: "Collected", color: "hsl(221, 83%, 53%)" }, due: { label: "Total Due", color: "hsl(199, 89%, 48%)" } };
  const lineConfig = { cumulative: { label: "Cumulative Collection", color: "hsl(262, 83%, 58%)" } };
  const pieConfig = { Paid: { label: "Paid", color: PIE_COLORS[0] }, Partial: { label: "Partial", color: PIE_COLORS[1] }, Unpaid: { label: "Unpaid", color: PIE_COLORS[2] } };
  const classBarConfig = { collected: { label: "Collected", color: "hsl(142, 71%, 45%)" }, due: { label: "Total Due", color: "hsl(221, 83%, 53%)" } };

  // ── export ──
  const exportCSV = () => {
    const header = "Month,Inflow,Outstanding,Total Due";
    const rows = monthlyTrend.map((m) => `${m.month},${m.inflow},${m.outflow},${m.due}`);
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `financial-report-${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  const exportDefaultersCSV = () => {
    const header = "Name,Admission#,Class,Outstanding";
    const rows = defaulters.map((d) => `${d.name},${d.admission},${d.cls},${d.owed}`);
    const blob = new Blob([header + "\n" + rows.join("\n")], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a"); a.href = url; a.download = `fee-defaulters-${year}.csv`; a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) return <p className="text-muted-foreground text-center py-12">Loading financial data…</p>;

  return (
    <>
      <PageHeader
        title="Financial Reports"
        subtitle="Complete inflow & outflow analytics — presentation ready"
        action={
          <div className="flex items-center gap-2">
            <Select value={year} onValueChange={setYear}>
              <SelectTrigger className="w-[120px]"><SelectValue /></SelectTrigger>
              <SelectContent>{years.map((y) => <SelectItem key={y} value={y}>{y}</SelectItem>)}</SelectContent>
            </Select>
            <Button onClick={exportCSV} className="bg-gradient-primary text-primary-foreground">
              <Download className="w-4 h-4 mr-1" /> Export
            </Button>
          </div>
        }
      />

      {/* ── KPI Cards ──────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <StatCard icon={<TrendingUp className="w-5 h-5" />} label="Total Inflow" value={fmt(kpis.totalInflow)} tone="accent" />
        <StatCard icon={<TrendingDown className="w-5 h-5" />} label="Outstanding" value={fmt(kpis.outstanding)} tone="warning" />
        <StatCard icon={<IndianRupee className="w-5 h-5" />} label="Total Due" value={fmt(kpis.totalDue)} tone="secondary" />
        <StatCard icon={<Wallet className="w-5 h-5" />} label="Collection Rate" value={`${kpis.collectionRate}%`} tone="primary" />
      </div>

      {/* ── Quick Stats Strip ─────────────────────────────── */}
      <div className="grid grid-cols-3 gap-3 mb-6">
        <Card className="p-4 text-center border-l-4 border-l-accent">
          <div className="text-2xl font-bold text-accent">{kpis.paid}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Fully Paid</div>
        </Card>
        <Card className="p-4 text-center border-l-4 border-l-warning">
          <div className="text-2xl font-bold text-warning">{kpis.partial}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Partial</div>
        </Card>
        <Card className="p-4 text-center border-l-4 border-l-destructive">
          <div className="text-2xl font-bold text-destructive">{kpis.unpaid}</div>
          <div className="text-xs text-muted-foreground uppercase tracking-wide">Unpaid</div>
        </Card>
      </div>

      {/* ── Charts Tabs ───────────────────────────────────── */}
      <Tabs defaultValue="overview" className="mb-6">
        <TabsList className="grid w-full grid-cols-4 mb-4">
          <TabsTrigger value="overview"><BarChart3 className="w-3.5 h-3.5 mr-1.5" />Overview</TabsTrigger>
          <TabsTrigger value="trends"><TrendingUp className="w-3.5 h-3.5 mr-1.5" />Trends</TabsTrigger>
          <TabsTrigger value="classwise"><PieIcon className="w-3.5 h-3.5 mr-1.5" />Class-wise</TabsTrigger>
          <TabsTrigger value="defaulters"><FileSpreadsheet className="w-3.5 h-3.5 mr-1.5" />Defaulters</TabsTrigger>
        </TabsList>

        {/* ── Tab 1: Overview ── */}
        <TabsContent value="overview">
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Bar: Inflow vs Outstanding */}
            <Card className="p-5">
              <h3 className="font-semibold mb-1 flex items-center gap-2">
                <BarChart3 className="w-4 h-4 text-primary" /> Monthly Inflow vs Outstanding
              </h3>
              <p className="text-xs text-muted-foreground mb-3">Side-by-side comparison per month</p>
              <ChartContainer config={barConfig} className="h-[280px] w-full">
                <BarChart data={monthlyTrend} barCategoryGap="20%">
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar dataKey="inflow" fill="var(--color-inflow)" radius={[6, 6, 0, 0]} />
                  <Bar dataKey="outflow" fill="var(--color-outflow)" radius={[6, 6, 0, 0]} />
                </BarChart>
              </ChartContainer>
            </Card>

            {/* Pie: Status Distribution */}
            <Card className="p-5">
              <h3 className="font-semibold mb-1 flex items-center gap-2">
                <PieIcon className="w-4 h-4 text-primary" /> Payment Status Distribution
              </h3>
              <p className="text-xs text-muted-foreground mb-3">Paid vs Partial vs Unpaid records</p>
              <ChartContainer config={pieConfig} className="h-[280px] w-full">
                <PieChart>
                  <ChartTooltip content={<ChartTooltipContent nameKey="name" />} />
                  <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={100} innerRadius={55} strokeWidth={3} stroke="hsl(var(--card))">
                    {pieData.map((entry, i) => <Cell key={i} fill={entry.fill} />)}
                  </Pie>
                  <ChartLegend content={<ChartLegendContent nameKey="name" />} />
                </PieChart>
              </ChartContainer>
            </Card>
          </div>
        </TabsContent>

        {/* ── Tab 2: Trends ── */}
        <TabsContent value="trends">
          <div className="grid lg:grid-cols-2 gap-4">
            {/* Area: Collection vs Due */}
            <Card className="p-5">
              <h3 className="font-semibold mb-1 flex items-center gap-2">
                <ArrowUpRight className="w-4 h-4 text-accent" /> Collection vs Due Trend
              </h3>
              <p className="text-xs text-muted-foreground mb-3">Monthly area chart showing collection efficiency</p>
              <ChartContainer config={areaConfig} className="h-[280px] w-full">
                <AreaChart data={monthlyTrend}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area type="monotone" dataKey="due" fill="var(--color-due)" fillOpacity={0.15} stroke="var(--color-due)" strokeWidth={2} />
                  <Area type="monotone" dataKey="inflow" fill="var(--color-inflow)" fillOpacity={0.25} stroke="var(--color-inflow)" strokeWidth={2} />
                </AreaChart>
              </ChartContainer>
            </Card>

            {/* Line: Cumulative */}
            <Card className="p-5">
              <h3 className="font-semibold mb-1 flex items-center gap-2">
                <TrendingUp className="w-4 h-4 text-primary" /> Cumulative Collection
              </h3>
              <p className="text-xs text-muted-foreground mb-3">Running total of fee collection through the year</p>
              <ChartContainer config={lineConfig} className="h-[280px] w-full">
                <LineChart data={cumulativeData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                  <XAxis dataKey="month" className="text-xs" />
                  <YAxis className="text-xs" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Line type="monotone" dataKey="cumulative" stroke="var(--color-cumulative)" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 6 }} />
                </LineChart>
              </ChartContainer>
            </Card>
          </div>
        </TabsContent>

        {/* ── Tab 3: Class-wise ── */}
        <TabsContent value="classwise">
          <Card className="p-5 mb-4">
            <h3 className="font-semibold mb-1 flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-primary" /> Class-wise Fee Breakdown
            </h3>
            <p className="text-xs text-muted-foreground mb-3">Collected vs Total Due per class</p>
            <ChartContainer config={classBarConfig} className="h-[320px] w-full">
              <BarChart data={classBreakdown} layout="vertical" barCategoryGap="18%">
                <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
                <XAxis type="number" className="text-xs" tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
                <YAxis type="category" dataKey="name" className="text-xs" width={80} />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar dataKey="collected" fill="var(--color-collected)" radius={[0, 6, 6, 0]} />
                <Bar dataKey="due" fill="var(--color-due)" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ChartContainer>
          </Card>

          {/* Class-wise table */}
          <Card className="p-4">
            <h3 className="font-semibold mb-3">Detailed Class Breakdown</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border">
                    <th className="text-left p-2 font-medium text-muted-foreground">Class</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Total Due</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Collected</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Outstanding</th>
                    <th className="text-right p-2 font-medium text-muted-foreground">Rate</th>
                  </tr>
                </thead>
                <tbody>
                  {classBreakdown.map((c) => {
                    const out = Math.max(0, c.due - c.collected);
                    const rate = c.due > 0 ? Math.round((c.collected / c.due) * 100) : 0;
                    return (
                      <tr key={c.name} className="border-b border-border/50 hover:bg-muted/30 transition-colors">
                        <td className="p-2 font-medium">Class {c.name}</td>
                        <td className="p-2 text-right">{fmt(c.due)}</td>
                        <td className="p-2 text-right text-accent font-medium">{fmt(c.collected)}</td>
                        <td className="p-2 text-right text-destructive">{fmt(out)}</td>
                        <td className="p-2 text-right">
                          <Badge variant="outline" className={rate >= 80 ? "bg-accent/10 text-accent border-accent/30" : rate >= 50 ? "bg-warning/10 text-warning border-warning/30" : "bg-destructive/10 text-destructive border-destructive/30"}>
                            {rate}%
                          </Badge>
                        </td>
                      </tr>
                    );
                  })}
                  {classBreakdown.length === 0 && (
                    <tr><td colSpan={5} className="text-center py-6 text-muted-foreground">No class data available.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </TabsContent>

        {/* ── Tab 4: Defaulters ── */}
        <TabsContent value="defaulters">
          <Card className="p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="font-semibold flex items-center gap-2">
                  <ArrowDownRight className="w-4 h-4 text-destructive" /> Top Fee Defaulters
                </h3>
                <p className="text-xs text-muted-foreground">Students with highest outstanding balances</p>
              </div>
              {defaulters.length > 0 && (
                <Button variant="outline" size="sm" onClick={exportDefaultersCSV}>
                  <Download className="w-3.5 h-3.5 mr-1" /> Export
                </Button>
              )}
            </div>
            <div className="space-y-2">
              {defaulters.map((d, i) => (
                <div key={i} className="flex items-center justify-between p-3 rounded-lg bg-muted/40 hover:bg-muted/60 transition-colors">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="w-7 h-7 rounded-full bg-destructive/10 text-destructive text-xs font-bold flex items-center justify-center shrink-0">
                      {i + 1}
                    </span>
                    <div className="min-w-0">
                      <div className="font-medium text-sm truncate">{d.name}</div>
                      <div className="text-xs text-muted-foreground">Adm# {d.admission} · Class {d.cls}</div>
                    </div>
                  </div>
                  <Badge variant="outline" className="bg-destructive/10 text-destructive border-destructive/30 shrink-0">
                    {fmt(d.owed)}
                  </Badge>
                </div>
              ))}
              {defaulters.length === 0 && (
                <div className="text-center py-8 text-muted-foreground">
                  <Wallet className="w-8 h-8 mx-auto mb-2 opacity-40" />
                  No defaulters found — great job! 🎉
                </div>
              )}
            </div>
          </Card>
        </TabsContent>
      </Tabs>

      {/* ── Summary Card ──────────────────────────────────── */}
      <Card className="p-6 bg-gradient-primary text-primary-foreground">
        <h3 className="text-lg font-bold mb-2">💰 Financial Summary — {year}</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm">
          <div>
            <div className="text-primary-foreground/70 text-xs uppercase">Total Records</div>
            <div className="text-xl font-bold">{kpis.total}</div>
          </div>
          <div>
            <div className="text-primary-foreground/70 text-xs uppercase">Gross Due</div>
            <div className="text-xl font-bold">{fmt(kpis.totalDue)}</div>
          </div>
          <div>
            <div className="text-primary-foreground/70 text-xs uppercase">Net Collected</div>
            <div className="text-xl font-bold">{fmt(kpis.totalInflow)}</div>
          </div>
          <div>
            <div className="text-primary-foreground/70 text-xs uppercase">Balance Due</div>
            <div className="text-xl font-bold">{fmt(kpis.outstanding)}</div>
          </div>
        </div>
      </Card>
    </>
  );
}
