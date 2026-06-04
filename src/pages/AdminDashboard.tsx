import { useEffect, useMemo, useState } from "react";
import { Routes, Route, Navigate, Link } from "react-router-dom";
import { AppLayout } from "@/components/AppLayout";
import { LayoutDashboard, Users, GraduationCap, Bell, BookOpen, Wallet, FileText, ClipboardCheck, CalendarDays, Settings, User, UserPlus, ArrowRight, Send, FilePlus, Shield, IndianRupee, Sparkles, Activity, Database, CalendarOff } from "lucide-react";
import QuestionBankPage from "./shared/QuestionBankPage";
import LeaveRequestsPage from "./shared/LeaveRequestsPage";
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, PieChart, Pie, Cell } from "recharts";

import { supabase } from "@/integrations/supabase/client";
import { StatCard, PageHeader } from "@/components/ui-bits";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import StudentsAdmin from "./admin/StudentsAdmin";
import TeacherProfile from "./admin/TeacherProfile";
import TeachersAdmin from "./admin/TeachersAdmin";
import ClassesAdmin from "./admin/ClassesAdmin";
import ClassDetail from "./admin/ClassDetail";
import FeesAdmin from "./admin/FeesAdmin";
import ReportsAdmin from "./admin/ReportsAdmin";
import RolesAdmin from "./admin/RolesAdmin";
import NoticesPage from "./shared/NoticesPage";
import ExamsPage from "./shared/ExamsPage";
import {
  UsersDirectory, AttendanceOverview, TimetablePage,
  AppSettingsPage, ProfilePage,
} from "./shared/SchoolFeatures";

const nav = [
  { to: "/admin", label: "Dashboard", icon: <LayoutDashboard className="w-4 h-4" /> },
  { to: "/admin/students", label: "Students", icon: <Users className="w-4 h-4" /> },
  { to: "/admin/teachers", label: "Teachers", icon: <GraduationCap className="w-4 h-4" /> },
  { to: "/admin/classes", label: "Classes & Batches", icon: <BookOpen className="w-4 h-4" /> },
  { to: "/admin/fees", label: "Fees", icon: <Wallet className="w-4 h-4" /> },
  { to: "/admin/attendance", label: "Attendance", icon: <ClipboardCheck className="w-4 h-4" /> },
  { to: "/admin/leave-requests", label: "Leaves", icon: <CalendarOff className="w-4 h-4" /> },
  { to: "/admin/exams", label: "Exams", icon: <FilePlus className="w-4 h-4" /> },
  { to: "/admin/reports", label: "Reports & Financials", icon: <FileText className="w-4 h-4" /> },
  { to: "/admin/timetable", label: "Timetable", icon: <CalendarDays className="w-4 h-4" /> },
  { to: "/admin/question-bank", label: "Question Bank", icon: <Database className="w-4 h-4" /> },
  { to: "/admin/notices", label: "Notifications", icon: <Bell className="w-4 h-4" /> },
  { to: "/admin/users", label: "Users", icon: <Users className="w-4 h-4" /> },
  { to: "/admin/roles", label: "Roles", icon: <Shield className="w-4 h-4" /> },
  { to: "/admin/settings", label: "App Settings", icon: <Settings className="w-4 h-4" /> },
  { to: "/admin/profile", label: "Profile", icon: <User className="w-4 h-4" /> },
];

const todayStr = () => new Date().toISOString().slice(0, 10);
const fmtMoney = (n: number) =>
  new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n || 0);
const timeAgo = (d: string) => {
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  if (diff < 60) return "just now";
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
};

const Overview = () => {
  const [stats, setStats] = useState({ students: 0, teachers: 0, classes: 0, notices: 0 });
  const [attendance, setAttendance] = useState({ present: 0, absent: 0, late: 0, total: 0 });
  const [fees, setFees] = useState({ unpaidCount: 0, dueAmount: 0, collectedThisMonth: 0 });
  const [pendingLeaves, setPendingLeaves] = useState(0);
  const [recentStudents, setRecentStudents] = useState<any[]>([]);
  const [recentTeachers, setRecentTeachers] = useState<any[]>([]);
  const [recentNotices, setRecentNotices] = useState<any[]>([]);
  const [trend, setTrend] = useState<{ day: string; present: number; absent: number }[]>([]);
  const [collectionTrend, setCollectionTrend] = useState<{ day: string; amount: number }[]>([]);

  useEffect(() => {
    (async () => {
      const today = todayStr();
      const monthStart = today.slice(0, 7) + "-01";
      const sevenAgo = new Date(Date.now() - 6 * 86400000).toISOString().slice(0, 10);

      const [s, t, c, n, att, unpaid, paidMonth, leaves, rs, rt, rn, att7, paid7] = await Promise.all([
        supabase.from("students").select("id", { count: "exact", head: true }),
        supabase.from("teachers").select("id", { count: "exact", head: true }),
        supabase.from("classes").select("id", { count: "exact", head: true }),
        supabase.from("notices").select("id", { count: "exact", head: true }).is("revoked_at", null),
        supabase.from("attendance").select("status").eq("date", today),
        supabase.from("fees").select("amount, paid_amount, status").neq("status", "paid"),
        supabase.from("fees").select("paid_amount").eq("status", "paid").gte("updated_at", monthStart),
        supabase.from("leave_requests").select("id", { count: "exact", head: true }).eq("status", "pending"),
        supabase.from("students").select("id, full_name, admission_number, created_at, classes(name,section)").order("created_at", { ascending: false }).limit(5),
        supabase.from("teachers").select("id, full_name, subject, created_at").order("created_at", { ascending: false }).limit(5),
        supabase.from("notices").select("id, title, audience, created_at").is("revoked_at", null).order("created_at", { ascending: false }).limit(5),
        supabase.from("attendance").select("date, status").gte("date", sevenAgo),
        supabase.from("fees").select("paid_amount, updated_at").eq("status", "paid").gte("updated_at", sevenAgo),
      ]);

      setStats({ students: s.count ?? 0, teachers: t.count ?? 0, classes: c.count ?? 0, notices: n.count ?? 0 });

      const rows = att.data ?? [];
      setAttendance({
        present: rows.filter(r => r.status === "present").length,
        absent: rows.filter(r => r.status === "absent").length,
        late: rows.filter(r => r.status === "leave").length,
        total: rows.length,
      });

      const unpaidRows = unpaid.data ?? [];
      setFees({
        unpaidCount: unpaidRows.length,
        dueAmount: unpaidRows.reduce((a, r: any) => a + (Number(r.amount) - Number(r.paid_amount || 0)), 0),
        collectedThisMonth: (paidMonth.data ?? []).reduce((a, r: any) => a + Number(r.paid_amount || 0), 0),
      });

      setPendingLeaves(leaves.count ?? 0);
      setRecentStudents(rs.data ?? []);
      setRecentTeachers(rt.data ?? []);
      setRecentNotices(rn.data ?? []);

      // Build 7-day trends
      const days: string[] = Array.from({ length: 7 }, (_, i) => {
        const d = new Date(Date.now() - (6 - i) * 86400000);
        return d.toISOString().slice(0, 10);
      });
      const attMap = new Map(days.map(d => [d, { present: 0, absent: 0 }]));
      (att7.data ?? []).forEach((r: any) => {
        const e = attMap.get(r.date);
        if (!e) return;
        if (r.status === "present") e.present++;
        else if (r.status === "absent") e.absent++;
      });
      setTrend(days.map(d => ({ day: d.slice(5), ...attMap.get(d)! })));

      const colMap = new Map(days.map(d => [d, 0]));
      (paid7.data ?? []).forEach((r: any) => {
        const d = (r.updated_at || "").slice(0, 10);
        if (colMap.has(d)) colMap.set(d, (colMap.get(d) || 0) + Number(r.paid_amount || 0));
      });
      setCollectionTrend(days.map(d => ({ day: d.slice(5), amount: colMap.get(d) || 0 })));
    })();
  }, []);

  const attRate = attendance.total ? Math.round((attendance.present / attendance.total) * 100) : 0;
  const greeting = useMemo(() => {
    const h = new Date().getHours();
    if (h < 12) return "Good morning";
    if (h < 17) return "Good afternoon";
    return "Good evening";
  }, []);

  const ringData = [
    { name: "Present", value: attendance.present || 0 },
    { name: "Remaining", value: Math.max((attendance.total || 100) - (attendance.present || 0), attendance.total ? 0 : 100) },
  ];

  const SectionLabel = ({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) => (
    <div className="flex items-center justify-between mb-3 mt-2">
      <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{children}</span>
      {action}
    </div>
  );

  return (
    <div className="space-y-8">
      {/* Hero / greeting */}
      <Card className="relative overflow-hidden border-0 bg-gradient-hero text-primary-foreground p-6 sm:p-8 rounded-3xl shadow-elevated animate-fade-in">
        <div className="absolute -top-12 -right-12 w-56 h-56 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-16 -left-10 w-72 h-72 rounded-full bg-white/5 blur-3xl" />
        <div className="relative flex flex-col md:flex-row md:items-center md:justify-between gap-5">
          <div className="min-w-0">
            <div className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider bg-white/15 backdrop-blur px-2.5 py-1 rounded-full mb-3">
              <Sparkles className="w-3 h-3" /> Today · {new Date().toLocaleDateString("en-IN", { weekday: "long", day: "numeric", month: "short" })}
            </div>
            <h1 className="text-2xl sm:text-3xl md:text-4xl font-bold tracking-tight">{greeting}, Admin</h1>
            <p className="text-primary-foreground/85 mt-1.5 text-sm sm:text-base max-w-xl">
              {stats.students} students · {stats.teachers} teachers · {fees.unpaidCount} unpaid invoices need attention.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild size="sm" variant="secondary" className="bg-white text-primary hover:bg-white/90 rounded-full px-4 shadow-card">
              <Link to="/admin/notices"><Send className="w-3.5 h-3.5 mr-1.5" /> Send notice</Link>
            </Button>
            <Button asChild size="sm" variant="outline" className="bg-white/10 border-white/30 text-white hover:bg-white/20 rounded-full px-4">
              <Link to="/admin/reports"><Activity className="w-3.5 h-3.5 mr-1.5" /> View reports</Link>
            </Button>
          </div>
        </div>
      </Card>

      {/* Key institutional stats */}
      <section>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 stagger">
          <StatCard icon={<Users className="w-5 h-5" />} label="Students" value={stats.students} hint="Enrolled" />
          <StatCard icon={<GraduationCap className="w-5 h-5" />} label="Teachers" value={stats.teachers} tone="secondary" hint="On staff" />
          <StatCard icon={<BookOpen className="w-5 h-5" />} label="Classes" value={stats.classes} tone="accent" hint="Active batches" />
          <StatCard icon={<Bell className="w-5 h-5" />} label="Active Notices" value={stats.notices} tone="warning" hint="Live now" />
        </div>
      </section>

      {/* Live operational widgets — charts + ring */}
      <section>
        <SectionLabel action={<Link to="/admin/reports" className="text-xs text-primary hover:underline">Open Reports →</Link>}>Live Operations</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Attendance ring */}
          <Card className="p-5 rounded-2xl shadow-card hover:shadow-elevated transition-all animate-fade-in">
            <div className="flex items-center justify-between mb-2">
              <h3 className="font-semibold text-sm">Today's Attendance</h3>
              <Link to="/admin/attendance" className="text-muted-foreground hover:text-primary"><ArrowRight className="w-4 h-4" /></Link>
            </div>
            <div className="relative h-44">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie data={ringData} dataKey="value" innerRadius="72%" outerRadius="100%" startAngle={90} endAngle={-270} stroke="none">
                    <Cell fill="hsl(var(--primary))" />
                    <Cell fill="hsl(var(--muted))" />
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
              <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                <div className="text-3xl font-bold tabular-nums">{attRate}<span className="text-base text-muted-foreground">%</span></div>
                <div className="text-[10px] uppercase tracking-wider text-muted-foreground">present</div>
              </div>
            </div>
            <div className="grid grid-cols-3 gap-2 mt-2 text-center text-xs">
              <div className="rounded-lg bg-primary/10 text-primary py-1.5"><div className="font-bold tabular-nums">{attendance.present}</div><div className="text-[10px] opacity-80">Present</div></div>
              <div className="rounded-lg bg-destructive/10 text-destructive py-1.5"><div className="font-bold tabular-nums">{attendance.absent}</div><div className="text-[10px] opacity-80">Absent</div></div>
              <div className="rounded-lg bg-warning/10 text-warning py-1.5"><div className="font-bold tabular-nums">{attendance.late}</div><div className="text-[10px] opacity-80">Leave</div></div>
            </div>
          </Card>

          {/* Fees collection trend */}
          <Card className="p-5 rounded-2xl shadow-card hover:shadow-elevated transition-all animate-fade-in">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><IndianRupee className="w-4 h-4 text-accent" /> Collections · 7d</h3>
              <Link to="/admin/fees" className="text-muted-foreground hover:text-primary"><ArrowRight className="w-4 h-4" /></Link>
            </div>
            <div className="text-2xl font-bold tabular-nums">{fmtMoney(fees.collectedThisMonth)}</div>
            <div className="text-[11px] text-muted-foreground mb-2">collected this month</div>
            <div className="h-28 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={collectionTrend} margin={{ top: 5, right: 8, left: 8, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colAmt" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="hsl(var(--accent))" stopOpacity={0.5} />
                      <stop offset="100%" stopColor="hsl(var(--accent))" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <Tooltip cursor={{ stroke: "hsl(var(--border))" }} contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }} formatter={(v: any) => fmtMoney(Number(v))} />
                  <Area type="monotone" dataKey="amount" stroke="hsl(var(--accent))" strokeWidth={2} fill="url(#colAmt)" />
                </AreaChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center justify-between text-xs mt-1">
              <span className="text-muted-foreground">Due: <span className="font-semibold text-destructive">{fmtMoney(fees.dueAmount)}</span></span>
              <span className="text-muted-foreground">{fees.unpaidCount} unpaid</span>
            </div>
          </Card>

          {/* Attendance bar trend */}
          <Card className="p-5 rounded-2xl shadow-card hover:shadow-elevated transition-all animate-fade-in">
            <div className="flex items-center justify-between mb-1">
              <h3 className="font-semibold text-sm flex items-center gap-1.5"><Activity className="w-4 h-4 text-primary" /> Attendance · 7d</h3>
              <Link to="/admin/attendance" className="text-muted-foreground hover:text-primary"><ArrowRight className="w-4 h-4" /></Link>
            </div>
            <div className="h-44 -mx-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={trend} margin={{ top: 10, right: 8, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="day" tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} />
                  <YAxis tick={{ fontSize: 10, fill: "hsl(var(--muted-foreground))" }} axisLine={false} tickLine={false} width={28} />
                  <Tooltip cursor={{ fill: "hsl(var(--muted))" }} contentStyle={{ borderRadius: 8, border: "1px solid hsl(var(--border))", fontSize: 12 }} />
                  <Bar dataKey="present" stackId="a" fill="hsl(var(--primary))" radius={[4, 4, 0, 0]} />
                  <Bar dataKey="absent" stackId="a" fill="hsl(var(--destructive) / 0.7)" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </div>
            <div className="flex items-center gap-3 text-[11px] text-muted-foreground mt-1">
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-primary" /> Present</span>
              <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-destructive/70" /> Absent</span>
            </div>
          </Card>
        </div>
      </section>

      {/* Quick Actions */}
      <section>
        <SectionLabel>Quick Actions</SectionLabel>
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { to: "/admin/students", label: "Add Student", icon: <UserPlus className="w-4 h-4" />, tone: "bg-primary/10 text-primary" },
            { to: "/admin/teachers", label: "Add Teacher", icon: <GraduationCap className="w-4 h-4" />, tone: "bg-secondary text-secondary-foreground" },
            { to: "/admin/notices", label: "Send Notice", icon: <Send className="w-4 h-4" />, tone: "bg-warning/10 text-warning" },
            { to: "/admin/exams", label: "Create Exam", icon: <FilePlus className="w-4 h-4" />, tone: "bg-accent/10 text-accent" },
            { to: "/admin/fees", label: "Generate Fees", icon: <Wallet className="w-4 h-4" />, tone: "bg-primary/10 text-primary" },
            { to: "/admin/attendance", label: "Open Attendance", icon: <ClipboardCheck className="w-4 h-4" />, tone: "bg-accent/10 text-accent" },
          ].map(a => (
            <Link key={a.to + a.label} to={a.to}
              className="group flex flex-col items-center justify-center gap-2 p-4 rounded-2xl bg-card border border-border hover:border-primary/40 hover:-translate-y-0.5 hover:shadow-elevated transition-all">
              <div className={`w-11 h-11 rounded-xl flex items-center justify-center ${a.tone} group-hover:scale-110 group-hover:rotate-3 transition-transform`}>{a.icon}</div>
              <span className="text-xs font-medium text-center leading-tight">{a.label}</span>
            </Link>
          ))}
        </div>
      </section>

      {/* Operational alerts */}
      <section>
        <SectionLabel>Action Required</SectionLabel>
        <Card className="p-5 rounded-2xl shadow-card divide-y divide-border">
          {[
            { label: "Pending leave requests", value: pendingLeaves, to: "/admin/leave-requests", tone: pendingLeaves > 0 ? "warning" : "ok" },
            { label: "Unpaid fee invoices", value: fees.unpaidCount, to: "/admin/fees", tone: fees.unpaidCount > 0 ? "warning" : "ok" },
            { label: "Attendance pending today", value: attendance.total === 0 ? "Not marked" : "Marked", to: "/admin/attendance", tone: attendance.total === 0 ? "danger" : "ok" },
          ].map((r, i) => (
            <Link key={i} to={r.to} className="flex items-center justify-between py-3 first:pt-0 last:pb-0 -mx-2 px-2 rounded-lg hover:bg-muted/40 transition-colors group">
              <div className="flex items-center gap-3">
                <div className={`w-2 h-2 rounded-full ${r.tone === "danger" ? "bg-destructive animate-pulse" : r.tone === "warning" ? "bg-warning" : "bg-accent"}`} />
                <span className="text-sm font-medium">{r.label}</span>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={r.tone === "ok" ? "outline" : "default"} className={r.tone === "danger" ? "bg-destructive text-destructive-foreground" : r.tone === "warning" ? "bg-warning text-warning-foreground" : ""}>{r.value}</Badge>
                <ArrowRight className="w-3.5 h-3.5 text-muted-foreground group-hover:translate-x-0.5 group-hover:text-primary transition-all" />
              </div>
            </Link>
          ))}
        </Card>
      </section>

      {/* Activity feeds */}
      <section>
        <SectionLabel>Recent Activity</SectionLabel>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          <Card className="p-5 rounded-2xl shadow-card hover:shadow-elevated transition-all">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <UserPlus className="w-4 h-4 text-primary" /> Recent Admissions
              </h3>
              <Link to="/admin/students" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {recentStudents.length === 0 && <p className="text-xs text-muted-foreground">No students yet.</p>}
              {recentStudents.map(s => (
                <div key={s.id} className="flex items-center gap-3 text-sm group">
                  <div className="w-8 h-8 rounded-full bg-primary/10 text-primary flex items-center justify-center text-xs font-semibold shrink-0">
                    {s.full_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{s.full_name}</div>
                    <div className="text-xs text-muted-foreground truncate">
                      Adm# {s.admission_number}{s.classes ? ` · ${s.classes.name}-${s.classes.section}` : ""}
                    </div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(s.created_at)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 rounded-2xl shadow-card hover:shadow-elevated transition-all">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <GraduationCap className="w-4 h-4 text-accent" /> New Teachers
              </h3>
              <Link to="/admin/teachers" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {recentTeachers.length === 0 && <p className="text-xs text-muted-foreground">No teachers yet.</p>}
              {recentTeachers.map(t => (
                <div key={t.id} className="flex items-center gap-3 text-sm">
                  <div className="w-8 h-8 rounded-full bg-accent/10 text-accent flex items-center justify-center text-xs font-semibold shrink-0">
                    {t.full_name?.[0]?.toUpperCase() ?? "?"}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{t.full_name}</div>
                    <div className="text-xs text-muted-foreground truncate">{t.subject || "Subject not set"}</div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(t.created_at)}</span>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-5 rounded-2xl shadow-card hover:shadow-elevated transition-all">
            <div className="flex items-center justify-between mb-4">
              <h3 className="font-semibold text-sm flex items-center gap-2">
                <Bell className="w-4 h-4 text-warning" /> Latest Notices
              </h3>
              <Link to="/admin/notices" className="text-xs text-primary hover:underline">View all</Link>
            </div>
            <div className="space-y-3">
              {recentNotices.length === 0 && <p className="text-xs text-muted-foreground">No notices posted.</p>}
              {recentNotices.map(n => (
                <div key={n.id} className="flex items-start gap-3 text-sm">
                  <div className="w-8 h-8 rounded-lg bg-warning/10 text-warning flex items-center justify-center shrink-0">
                    <Bell className="w-3.5 h-3.5" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="font-medium truncate">{n.title}</div>
                    <div className="text-xs text-muted-foreground capitalize">{n.audience}</div>
                  </div>
                  <span className="text-xs text-muted-foreground shrink-0">{timeAgo(n.created_at)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>
      </section>
    </div>
  );
};

export default function AdminDashboard() {
  return (
    <AppLayout nav={nav} title="Admin Panel">
      <Routes>
        <Route index element={<Overview />} />
        <Route path="users" element={<UsersDirectory />} />
        <Route path="students" element={<StudentsAdmin />} />
        <Route path="teachers" element={<TeachersAdmin />} />
        <Route path="teachers/:id" element={<TeacherProfile />} />
        <Route path="classes" element={<ClassesAdmin />} />
        <Route path="classes/:id" element={<ClassDetail />} />
        <Route path="fees" element={<FeesAdmin />} />
        <Route path="attendance" element={<AttendanceOverview />} />
        <Route path="leave-requests" element={<LeaveRequestsPage canReview />} />
        <Route path="reports" element={<ReportsAdmin />} />
        <Route path="financial-reports" element={<Navigate to="/admin/reports" replace />} />
        <Route path="timetable" element={<TimetablePage title="Timetable" />} />
        <Route path="question-bank" element={<QuestionBankPage />} />
        <Route path="exams" element={<ExamsPage isAdmin />} />
        <Route path="notices" element={<NoticesPage canPost />} />
        <Route path="settings" element={<AppSettingsPage />} />
        <Route path="profile" element={<ProfilePage />} />
        <Route path="roles" element={<RolesAdmin />} />
        <Route path="*" element={<Navigate to="/admin" replace />} />
      </Routes>
    </AppLayout>
  );
}
