import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { PageHeader } from "@/components/ui-bits";
import {
  Users, ClipboardCheck, Wallet, AlertCircle, BadgeDollarSign, FileText,
  TrendingUp, UserPlus, CalendarDays, Bell, Download, BookOpen, MessageSquare,
  IndianRupee, ArrowUpRight, RefreshCw, Search, Sparkles,
} from "lucide-react";
import FinancialReportsPage from "./FinancialReportsPage";

type TabKey =
  | "financial"
  | "students" | "attendance" | "fees" | "dues" | "salary" | "exams"
  | "performance" | "admissions" | "leaves" | "notices" | "inquiries" | "complaints";

const TABS: { key: TabKey; label: string; icon: React.ReactNode; live: boolean }[] = [
  { key: "financial", label: "Financial Overview", icon: <IndianRupee className="w-4 h-4" />, live: true },
  { key: "students", label: "Students", icon: <Users className="w-4 h-4" />, live: true },
  { key: "attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" />, live: true },
  { key: "fees", label: "Fees", icon: <Wallet className="w-4 h-4" />, live: true },
  { key: "dues", label: "Pending Dues", icon: <AlertCircle className="w-4 h-4" />, live: true },
  { key: "salary", label: "Teacher Salary", icon: <BadgeDollarSign className="w-4 h-4" />, live: true },
  { key: "exams", label: "Exams & Marks", icon: <FileText className="w-4 h-4" />, live: true },
  { key: "performance", label: "Class Performance", icon: <TrendingUp className="w-4 h-4" />, live: true },
  { key: "admissions", label: "Admissions", icon: <UserPlus className="w-4 h-4" />, live: true },
  { key: "leaves", label: "Leave Requests", icon: <CalendarDays className="w-4 h-4" />, live: true },
  { key: "notices", label: "Notices", icon: <Bell className="w-4 h-4" />, live: true },
  { key: "inquiries", label: "Inquiries", icon: <BookOpen className="w-4 h-4" />, live: false },
  { key: "complaints", label: "Complaints", icon: <MessageSquare className="w-4 h-4" />, live: false },
];

const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);

function downloadCSV(filename: string, rows: any[]) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const escape = (v: any) => {
    const s = v == null ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...rows.map(r => cols.map(c => escape(r[c])).join(","))].join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

const PRESETS: { key: string; label: string; days: number }[] = [
  { key: "7d", label: "7D", days: 7 },
  { key: "30d", label: "30D", days: 30 },
  { key: "90d", label: "90D", days: 90 },
  { key: "365d", label: "1Y", days: 365 },
];

export default function ReportsAdmin() {
  const [tab, setTab] = useState<TabKey>("financial");
  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const [from, setFrom] = useState(monthAgo);
  const [to, setTo] = useState(today);
  const [preset, setPreset] = useState<string>("30d");
  const [nonce, setNonce] = useState(0);
  const activeTab = TABS.find(t => t.key === tab)!;

  const applyPreset = (days: number, key: string) => {
    const t = new Date();
    const f = new Date(Date.now() - days * 86400000);
    setFrom(f.toISOString().slice(0, 10));
    setTo(t.toISOString().slice(0, 10));
    setPreset(key);
  };

  return (
    <>
      <PageHeader
        title="Reports & Financials"
        subtitle="Live operational insights across your school"
        action={
          <Button
            size="sm"
            variant="outline"
            onClick={() => setNonce(n => n + 1)}
            className="rounded-full hover-scale"
          >
            <RefreshCw className="w-3.5 h-3.5 mr-1.5" /> Refresh
          </Button>
        }
      />

      {/* Horizontal pill tab bar — interactive, scrollable, animated */}
      <div className="relative -mx-1 mb-4 animate-fade-in">
        <div className="flex gap-2 overflow-x-auto px-1 pb-2 [&::-webkit-scrollbar]:h-1.5">
          {TABS.map(t => {
            const active = tab === t.key;
            return (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`group relative shrink-0 inline-flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium border transition-all duration-200 ${
                  active
                    ? "bg-primary text-primary-foreground border-primary shadow-elevated scale-[1.02]"
                    : "bg-card text-foreground border-border hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-card"
                }`}
              >
                <span className={`flex items-center justify-center w-5 h-5 rounded-full transition-colors ${active ? "bg-primary-foreground/15" : "text-primary"}`}>
                  {t.icon}
                </span>
                <span className="whitespace-nowrap">{t.label}</span>
                {!t.live && (
                  <Badge variant="outline" className={`text-[9px] ml-0.5 ${active ? "border-primary-foreground/40 text-primary-foreground" : ""}`}>
                    Soon
                  </Badge>
                )}
              </button>
            );
          })}
        </div>
      </div>

      {/* Context bar — active tab name + quick-range chips + custom dates */}
      {tab !== "financial" && (
        <Card className="p-3 sm:p-4 mb-4 rounded-2xl shadow-card flex flex-wrap items-center gap-3 animate-fade-in">
          <div className="flex items-center gap-2 min-w-0">
            <span className="w-9 h-9 rounded-full bg-primary/10 text-primary flex items-center justify-center">
              {activeTab.icon}
            </span>
            <div className="min-w-0">
              <div className="text-sm font-semibold leading-tight truncate">{activeTab.label}</div>
              <div className="text-[11px] text-muted-foreground">Showing {from} → {to}</div>
            </div>
          </div>

          <div className="flex items-center gap-1 ml-auto bg-muted rounded-full p-1">
            {PRESETS.map(p => (
              <button
                key={p.key}
                onClick={() => applyPreset(p.days, p.key)}
                className={`px-3 py-1 text-xs font-medium rounded-full transition-all ${
                  preset === p.key
                    ? "bg-card text-primary shadow-card"
                    : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {p.label}
              </button>
            ))}
          </div>

          <div className="flex items-center gap-1.5">
            <Input
              type="date"
              value={from}
              onChange={e => { setFrom(e.target.value); setPreset("custom"); }}
              className="h-9 w-[140px] rounded-full text-xs"
            />
            <span className="text-muted-foreground text-xs">to</span>
            <Input
              type="date"
              value={to}
              onChange={e => { setTo(e.target.value); setPreset("custom"); }}
              className="h-9 w-[140px] rounded-full text-xs"
            />
          </div>
        </Card>
      )}

      {/* Animated panel swap */}
      <div key={`${tab}-${nonce}`} className="animate-fade-in">
        <ReportPanel tab={tab} from={from} to={to} />
      </div>
    </>
  );
}

function ReportPanel({ tab, from, to }: { tab: TabKey; from: string; to: string }) {
  switch (tab) {
    case "financial": return <FinancialReportsPage />;
    case "students": return <StudentsReport />;
    case "attendance": return <AttendanceReport from={from} to={to} />;
    case "fees": return <FeesReport from={from} to={to} />;
    case "dues": return <DuesReport />;
    case "salary": return <SalaryReport />;
    case "exams": return <ExamsReport from={from} to={to} />;
    case "performance": return <PerformanceReport from={from} to={to} />;
    case "admissions": return <AdmissionsReport from={from} to={to} />;
    case "leaves": return <LeavesReport from={from} to={to} />;
    case "notices": return <NoticesReport from={from} to={to} />;
    default:
      return (
        <Card className="p-12 text-center rounded-2xl shadow-card border-dashed">
          <div className="mx-auto w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mb-3">
            <Sparkles className="w-5 h-5" />
          </div>
          <p className="text-sm font-medium">Coming soon</p>
          <p className="text-xs text-muted-foreground mt-1">This report unlocks once the matching workflow is enabled.</p>
        </Card>
      );
  }
}

const Section = ({ title, action, children }: { title: string; action?: React.ReactNode; children: React.ReactNode }) => (
  <Card className="p-0 rounded-2xl shadow-card hover:shadow-elevated transition-shadow overflow-hidden animate-fade-in">
    <div className="px-5 py-3.5 border-b border-border/70 flex items-center justify-between bg-gradient-to-r from-muted/40 to-transparent">
      <h3 className="font-semibold text-sm tracking-tight">{title}</h3>
      {action}
    </div>
    {children}
  </Card>
);

const Stat = ({ label, value, tone }: { label: string; value: string | number; tone?: string }) => (
  <Card className="group p-5 rounded-2xl shadow-card hover:shadow-elevated hover:-translate-y-0.5 transition-all duration-300 animate-fade-in">
    <div className="flex items-start justify-between gap-2">
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <span className="w-8 h-8 rounded-full bg-primary text-primary-foreground flex items-center justify-center group-hover:scale-110 transition-transform">
        <ArrowUpRight className="w-4 h-4" />
      </span>
    </div>
    <div className={`text-3xl font-bold mt-5 font-mono tabular-nums tracking-tight ${tone || ""}`}>{value}</div>
  </Card>
);

const ExportBtn = ({ rows, name }: { rows: any[]; name: string }) => (
  <Button size="sm" variant="outline" onClick={() => downloadCSV(name, rows)} disabled={!rows.length} className="rounded-full hover-scale">
    <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
  </Button>
);

const Empty = ({ msg = "No data for this range." }: { msg?: string }) => (
  <div className="py-12 text-center">
    <div className="mx-auto w-10 h-10 rounded-full bg-muted text-muted-foreground flex items-center justify-center mb-2">
      <Search className="w-4 h-4" />
    </div>
    <p className="text-sm text-muted-foreground">{msg}</p>
  </div>
);

/* ---------- Reports ---------- */

function StudentsReport() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("admission_number, full_name, roll_number, parent_mobile, user_id, classes(name,section,kind,display_name)")
        .order("created_at", { ascending: false });
      setRows((data ?? []).map((r: any) => ({
        admission: r.admission_number,
        name: r.full_name,
        roll: r.roll_number || "",
        class: r.classes ? (r.classes.kind === "batch" ? r.classes.display_name : `${r.classes.name}-${r.classes.section}`) : "Unassigned",
        parent_mobile: r.parent_mobile || "",
        account: r.user_id ? "Linked" : "Not linked",
      })));
    })();
  }, []);

  const linked = rows.filter(r => r.account === "Linked").length;
  const unassigned = rows.filter(r => r.class === "Unassigned").length;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Total students" value={rows.length} />
        <Stat label="Account linked" value={linked} tone="text-accent" />
        <Stat label="Unassigned to class" value={unassigned} tone="text-warning" />
      </div>
      <Section title="Student roster" action={<ExportBtn rows={rows} name="students.csv" />}>
        {rows.length === 0 ? <Empty /> : <SimpleTable rows={rows} />}
      </Section>
    </div>
  );
}

function AttendanceReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("attendance")
        .select("date, status, students(full_name, admission_number), classes(name, section, display_name, kind)")
        .gte("date", from).lte("date", to);
      setRows(data ?? []);
    })();
  }, [from, to]);

  const total = rows.length;
  const present = rows.filter(r => r.status === "present").length;
  const absent = rows.filter(r => r.status === "absent").length;
  const leave = rows.filter(r => r.status === "leave").length;
  const rate = total ? Math.round((present / total) * 100) : 0;

  const absentees = rows
    .filter(r => r.status === "absent")
    .map((r: any) => ({
      date: r.date,
      student: r.students?.full_name,
      admission: r.students?.admission_number,
      class: r.classes ? (r.classes.kind === "batch" ? r.classes.display_name : `${r.classes.name}-${r.classes.section}`) : "",
    }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-4 gap-3">
        <Stat label="Records" value={total} />
        <Stat label="Present" value={present} tone="text-accent" />
        <Stat label="Absent" value={absent} tone="text-destructive" />
        <Stat label="Attendance %" value={`${rate}%`} />
      </div>
      <div className="text-xs text-muted-foreground">{leave} marked on leave</div>
      <Section title="Absentees" action={<ExportBtn rows={absentees} name="absentees.csv" />}>
        {absentees.length === 0 ? <Empty msg="No absentees in range." /> : <SimpleTable rows={absentees} />}
      </Section>
    </div>
  );
}

function FeesReport({ from, to }: { from: string; to: string }) {
  const [collected, setCollected] = useState<any[]>([]);
  const [pending, setPending] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [c, p] = await Promise.all([
        supabase.from("fees").select("month, amount, paid_amount, updated_at, students(full_name, admission_number)")
          .eq("status", "paid").gte("updated_at", from).lte("updated_at", to + "T23:59:59"),
        supabase.from("fees").select("month, amount, paid_amount, due_date, status, students(full_name, admission_number)")
          .neq("status", "paid"),
      ]);
      setCollected(c.data ?? []); setPending(p.data ?? []);
    })();
  }, [from, to]);

  const collectedAmt = collected.reduce((a, r: any) => a + Number(r.paid_amount || 0), 0);
  const pendingAmt = pending.reduce((a, r: any) => a + (Number(r.amount) - Number(r.paid_amount || 0)), 0);

  const tableRows = pending.map((r: any) => ({
    student: r.students?.full_name,
    admission: r.students?.admission_number,
    month: r.month,
    due: Number(r.amount) - Number(r.paid_amount || 0),
    due_date: r.due_date || "",
    status: r.status,
  }));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Collected (range)" value={fmtMoney(collectedAmt)} tone="text-accent" />
        <Stat label="Pending total" value={fmtMoney(pendingAmt)} tone="text-warning" />
        <Stat label="Pending invoices" value={pending.length} />
      </div>
      <Section title="Pending invoices" action={<ExportBtn rows={tableRows} name="pending-fees.csv" />}>
        {tableRows.length === 0 ? <Empty msg="No pending invoices." /> : <SimpleTable rows={tableRows} />}
      </Section>
    </div>
  );
}

function DuesReport() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("fees")
        .select("amount, paid_amount, due_date, month, students(full_name, admission_number, parent_mobile)")
        .neq("status", "paid")
        .order("due_date", { ascending: true });
      setRows((data ?? []).map((r: any) => ({
        student: r.students?.full_name,
        admission: r.students?.admission_number,
        parent_mobile: r.students?.parent_mobile || "",
        month: r.month,
        due: Number(r.amount) - Number(r.paid_amount || 0),
        due_date: r.due_date || "",
      })));
    })();
  }, []);
  const total = rows.reduce((a, r) => a + r.due, 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Defaulters" value={new Set(rows.map(r => r.admission)).size} />
        <Stat label="Total dues" value={fmtMoney(total)} tone="text-warning" />
      </div>
      <Section title="Defaulter list" action={<ExportBtn rows={rows} name="dues.csv" />}>
        {rows.length === 0 ? <Empty msg="All clear — no pending dues." /> : <SimpleTable rows={rows} />}
      </Section>
    </div>
  );
}

function SalaryReport() {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase.from("teachers").select("full_name, employee_id, subject, salary, status").order("full_name");
      setRows((data ?? []).map((r: any) => ({
        teacher: r.full_name,
        employee_id: r.employee_id || "",
        subject: r.subject || "",
        salary: r.salary ? fmtMoney(Number(r.salary)) : "—",
        status: r.status || "active",
      })));
    })();
  }, []);
  const totalMonthly = rows.reduce((a, r: any) => a + (Number(String(r.salary).replace(/[^0-9.-]/g, "")) || 0), 0);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3">
        <Stat label="Active staff" value={rows.filter(r => r.status === "active").length} />
        <Stat label="Estimated monthly payroll" value={fmtMoney(totalMonthly)} />
      </div>
      <Section title="Staff salary register" action={<ExportBtn rows={rows} name="salary.csv" />}>
        {rows.length === 0 ? <Empty /> : <SimpleTable rows={rows} />}
      </Section>
      <p className="text-xs text-muted-foreground">Salary disbursement tracking will appear here once the payroll module is enabled.</p>
    </div>
  );
}

function ExamsReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("exams")
        .select("name, subject, exam_date, max_marks, classes(name, section, display_name, kind), marks(marks_obtained)")
        .gte("exam_date", from).lte("exam_date", to)
        .order("exam_date", { ascending: false });
      setRows((data ?? []).map((e: any) => {
        const ms = (e.marks ?? []).map((m: any) => Number(m.marks_obtained || 0));
        const avg = ms.length ? ms.reduce((a: number, b: number) => a + b, 0) / ms.length : 0;
        return {
          exam: e.name,
          subject: e.subject,
          class: e.classes ? (e.classes.kind === "batch" ? e.classes.display_name : `${e.classes.name}-${e.classes.section}`) : "",
          date: e.exam_date || "",
          max: e.max_marks,
          students: ms.length,
          average: ms.length ? avg.toFixed(1) : "—",
        };
      }));
    })();
  }, [from, to]);
  return (
    <Section title="Exam summary" action={<ExportBtn rows={rows} name="exams.csv" />}>
      {rows.length === 0 ? <Empty /> : <SimpleTable rows={rows} />}
    </Section>
  );
}

function PerformanceReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const [att, exams, classes] = await Promise.all([
        supabase.from("attendance").select("class_id, status").gte("date", from).lte("date", to),
        supabase.from("exams").select("class_id, max_marks, marks(marks_obtained)").gte("exam_date", from).lte("exam_date", to),
        supabase.from("classes").select("id, name, section, kind, display_name"),
      ]);
      const byClass: Record<string, { present: number; total: number; marks: number[]; max: number }> = {};
      (att.data ?? []).forEach((r: any) => {
        const k = r.class_id; if (!byClass[k]) byClass[k] = { present: 0, total: 0, marks: [], max: 0 };
        byClass[k].total++; if (r.status === "present") byClass[k].present++;
      });
      (exams.data ?? []).forEach((e: any) => {
        const k = e.class_id; if (!byClass[k]) byClass[k] = { present: 0, total: 0, marks: [], max: 0 };
        (e.marks ?? []).forEach((m: any) => byClass[k].marks.push((Number(m.marks_obtained || 0) / Number(e.max_marks || 1)) * 100));
      });
      setRows((classes.data ?? []).map((c: any) => {
        const b = byClass[c.id] || { present: 0, total: 0, marks: [] as number[], max: 0 };
        const att = b.total ? Math.round((b.present / b.total) * 100) : 0;
        const avg = b.marks.length ? b.marks.reduce((a, x) => a + x, 0) / b.marks.length : 0;
        return {
          class: c.kind === "batch" ? c.display_name : `Class ${c.name}-${c.section}`,
          attendance_pct: b.total ? `${att}%` : "—",
          exam_avg_pct: b.marks.length ? `${avg.toFixed(1)}%` : "—",
          records: b.total,
        };
      }));
    })();
  }, [from, to]);
  return (
    <Section title="Class performance rollup" action={<ExportBtn rows={rows} name="performance.csv" />}>
      {rows.length === 0 ? <Empty /> : <SimpleTable rows={rows} />}
    </Section>
  );
}

function AdmissionsReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("students")
        .select("created_at, admission_number, full_name, classes(name, section, display_name, kind)")
        .gte("created_at", from).lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false });
      setRows((data ?? []).map((r: any) => ({
        date: r.created_at?.slice(0, 10),
        admission: r.admission_number,
        name: r.full_name,
        class: r.classes ? (r.classes.kind === "batch" ? r.classes.display_name : `${r.classes.name}-${r.classes.section}`) : "",
      })));
    })();
  }, [from, to]);
  return (
    <div className="space-y-4">
      <Stat label="New admissions in range" value={rows.length} tone="text-accent" />
      <Section title="Admissions list" action={<ExportBtn rows={rows} name="admissions.csv" />}>
        {rows.length === 0 ? <Empty /> : <SimpleTable rows={rows} />}
      </Section>
    </div>
  );
}

function LeavesReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("leave_requests")
        .select("from_date, to_date, leave_type, status, applicant_kind, reason, created_at")
        .gte("created_at", from).lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false });
      setRows(data ?? []);
    })();
  }, [from, to]);
  const counts = useMemo(() => ({
    pending: rows.filter(r => r.status === "pending").length,
    approved: rows.filter(r => r.status === "approved").length,
    rejected: rows.filter(r => r.status === "rejected").length,
  }), [rows]);
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3">
        <Stat label="Pending" value={counts.pending} tone="text-warning" />
        <Stat label="Approved" value={counts.approved} tone="text-accent" />
        <Stat label="Rejected" value={counts.rejected} tone="text-destructive" />
      </div>
      <Section title="Leave requests" action={<ExportBtn rows={rows} name="leaves.csv" />}>
        {rows.length === 0 ? <Empty /> : <SimpleTable rows={rows} />}
      </Section>
    </div>
  );
}

function NoticesReport({ from, to }: { from: string; to: string }) {
  const [rows, setRows] = useState<any[]>([]);
  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("notices")
        .select("title, audience, created_at, expires_at, revoked_at")
        .gte("created_at", from).lte("created_at", to + "T23:59:59")
        .order("created_at", { ascending: false });
      setRows((data ?? []).map((r: any) => ({
        title: r.title,
        audience: r.audience,
        posted: r.created_at?.slice(0, 10),
        expires: r.expires_at?.slice(0, 10) || "",
        status: r.revoked_at ? "Revoked" : "Active",
      })));
    })();
  }, [from, to]);
  return (
    <Section title="Notices posted" action={<ExportBtn rows={rows} name="notices.csv" />}>
      {rows.length === 0 ? <Empty /> : <SimpleTable rows={rows} />}
    </Section>
  );
}

/* ---------- Shared table ---------- */
function SimpleTable({ rows }: { rows: any[] }) {
  const cols = Object.keys(rows[0]);
  return (
    <div className="overflow-x-auto max-h-[520px]">
      <table className="w-full text-sm">
        <thead className="sticky top-0 z-10">
          <tr className="bg-muted/80 backdrop-blur text-left text-[11px] uppercase tracking-wider text-muted-foreground">
            {cols.map(c => <th key={c} className="px-5 py-2.5 font-semibold whitespace-nowrap">{c.replace(/_/g, " ")}</th>)}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i} className={`border-t border-border/60 transition-colors hover:bg-primary/5 ${i % 2 ? "bg-muted/20" : ""}`}>
              {cols.map(c => <td key={c} className="px-5 py-2.5 truncate max-w-[240px]">{String(r[c] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
